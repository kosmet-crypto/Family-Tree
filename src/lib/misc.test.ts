import { parseBackup, backupFileName } from "./backup/schema";
import { ageRange, formatPartialDate, isDefinitelyBefore, lifespanLabel, toDayRange } from "./dates";
import { fitWithin, extensionFor } from "./media/compress";
import { checkPhotoUpload, computePhotoQuota, isNearLimit, mediaStoragePath, parsePhotoQuota } from "./media/quota";
import { cyrillicToLatin, personDisplayName, searchKey, searchPersons } from "./search";
import { makePerson } from "./test/fixtures";

describe("dates", () => {
  it("builds ranges for partial dates", () => {
    const feb = toDayRange({ date: "2024-02-01", precision: "month" })!;
    expect(feb.max - feb.min).toBe(28); // leap year: 29 days
    const year = toDayRange({ date: "1930-01-01", precision: "year" })!;
    expect(year.max - year.min).toBe(364);
    expect(toDayRange({ date: "1930-01-01", precision: "before" })!.min).toBe(-Infinity);
    expect(toDayRange({ date: "0999-01-01" })).not.toBeNull();
  });

  it("compares with uncertainty", () => {
    expect(isDefinitelyBefore({ date: "1930-01-01", precision: "year" }, { date: "1931-01-01" })).toBe(true);
    expect(isDefinitelyBefore({ date: "1930-01-01", precision: "about" }, { date: "1931-01-01" })).toBe(false);
  });

  it("computes ages", () => {
    expect(ageRange({ date: "1990-03-03" }, { date: "2020-03-02" })).toEqual([29, 29]);
    expect(ageRange({ date: "1990-01-01", precision: "year" }, { date: "2020-06-01" })).toEqual([29, 30]);
    expect(ageRange({ date: null }, new Date())).toBeNull();
  });

  it("formats dates and lifespans", () => {
    expect(formatPartialDate({ date: "1930-03-05" })).toBe("05.03.1930.");
    expect(formatPartialDate({ date: "1930-03-05", precision: "about" })).toBe("око 1930.");
    expect(formatPartialDate({ date: "1930-03-05", precision: "before" }, "sr-Latn")).toBe("pre 1930.");
    expect(formatPartialDate({ date: "1930-03-05", precision: "month" }, "en")).toBe("Mar 1930");
    expect(lifespanLabel({ date: "1930-01-01" }, { date: "2001-05-05" }, false)).toBe("1930 – 2001");
    expect(lifespanLabel({ date: "1930-01-01", precision: "about" }, { date: null }, true)).toBe("~1930 –");
    expect(lifespanLabel({ date: null }, { date: "1944-01-01" }, false)).toBe("† 1944");
  });
});

describe("search", () => {
  it("normalises Cyrillic, Latin and ASCII to the same key", () => {
    expect(searchKey("Ђорђе Петровић")).toBe("djordje petrovic");
    expect(searchKey("Đorđe Petrović")).toBe("djordje petrovic");
    expect(searchKey("  Šćepan  ŽIVKOVIĆ ")).toBe("scepan zivkovic");
    expect(cyrillicToLatin("Љубица Џаја")).toBe("Ljubica Džaja");
  });

  it("finds people across scripts and ranks prefix matches first", () => {
    const people = [
      makePerson("Марко", "male", null, { last_name: "Петровић" }),
      makePerson("Petra", "female", null, { last_name: "Marković" }),
      makePerson("Jovan", "male", null, { last_name: "Petrović" }),
    ];
    expect(searchPersons(people, "petrovic").map((h) => h.person.first_name)).toEqual(["Jovan", "Марко"]);
    expect(searchPersons(people, "mar").map((h) => h.person.first_name).sort()).toEqual(["Petra", "Марко"]);
    expect(searchPersons(people, "марко петрови")).toHaveLength(1);
    expect(searchPersons(people, "xyz")).toHaveLength(0);
    expect(personDisplayName({ first_name: "", middle_name: null, last_name: null, nickname: "Deda" })).toBe("Deda");
  });
});

describe("photo quota", () => {
  it("is unlimited while the limit is off or for premium", () => {
    expect(checkPhotoUpload(computePhotoQuota(100, false, null), 5)).toEqual({ allowed: 5, blocked: 0, unlimited: true, remaining: null });
    expect(computePhotoQuota(100, true, 30).limit).toBeNull();
  });

  it("splits a batch at the limit", () => {
    const q = computePhotoQuota(28, false, 30);
    expect(checkPhotoUpload(q, 5)).toEqual({ allowed: 2, blocked: 3, unlimited: false, remaining: 2 });
    expect(isNearLimit(q)).toBe(true);
    expect(isNearLimit(computePhotoQuota(3, false, 30))).toBe(false);
  });

  it("parses the database answer", () => {
    expect(parsePhotoQuota({ used: 3, limit: null, remaining: null, premium: false })).toEqual({ used: 3, limit: null, remaining: null, premium: false });
    expect(parsePhotoQuota(null).used).toBe(0);
  });

  it("builds storage paths matching the bucket policy", () => {
    expect(mediaStoragePath("t1", "photo", "f1", ".WEBP")).toBe("t1/photos/f1.webp");
    expect(mediaStoragePath("t1", "document", "f2", "p/d/f")).toBe("t1/documents/f2.pdf");
  });
});

describe("compression helpers", () => {
  it("fits dimensions without upscaling", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(extensionFor("image/webp")).toBe("webp");
  });
});

describe("backup files", () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const valid = {
    format: "roots-branches", version: 1, exported_at: "2026-09-29T10:00:00Z",
    tree: { id: id(1), name: "Петровић", root_person_id: id(2) },
    persons: [{ id: id(2), first_name: "Milan" }, { id: id(3), first_name: "Jovan" }],
    parent_child: [{ id: id(4), parent_id: id(2), child_id: id(3), relation: "biological" }],
    partnerships: [],
    media: [],
  };

  it("accepts an export_tree() document", () => {
    const r = parseBackup(JSON.stringify(valid));
    expect(r.ok && r.summary).toEqual({ treeName: "Петровић", exportedAt: valid.exported_at, persons: 2, relations: 1, partnerships: 0, media: 0 });
  });

  it("rejects broken files with a reason", () => {
    expect(parseBackup("{nope").ok).toBe(false);
    const wrong = parseBackup({ ...valid, format: "gedcom" });
    expect(!wrong.ok && wrong.problem.code).toBe("wrong_format");
    const dangling = parseBackup({ ...valid, parent_child: [{ id: id(4), parent_id: id(9), child_id: id(3) }] });
    expect(!dangling.ok && dangling.problem.code).toBe("dangling_reference");
  });

  it("names backup files", () => {
    expect(backupFileName("Породица Петровић", new Date("2026-09-29T00:00:00Z"))).toBe("porodicno-stablo-porodica-petrovic-2026-09-29.json");
  });
});

describe("typed date input", () => {
  it("masks, parses and formats by precision", async () => {
    const d = await import("./dates");
    expect(d.maskDateInput("05031930", "exact")).toBe("05.03.1930");
    expect(d.maskDateInput("0319", "month")).toBe("03.19");
    expect(d.maskDateInput("19ab305", "year")).toBe("1930");
    expect(d.dateInputToIso("05.03.1930", "exact")).toBe("1930-03-05");
    expect(d.dateInputToIso("31.02.1930", "exact")).toBe("");
    expect(d.dateInputToIso("03.1930", "month")).toBe("1930-03-01");
    expect(d.dateInputToIso("1930", "about")).toBe("1930-01-01");
    expect(d.isoToDateInput("1930-03-05", "month")).toBe("03.1930");
    expect(d.isoToDateInput("1930-03-05", "exact")).toBe("05.03.1930");
  });
});

describe("gedcom import", () => {
  const ged = `0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Jovan /Petrović/
1 SEX M
1 BIRT
2 DATE 5 MAR 1930
2 PLAC Niš
1 DEAT Y
0 @I2@ INDI
1 NAME Jelena /Ilić/
1 SEX F
1 BIRT
2 DATE ABT 1932
0 @I3@ INDI
1 NAME Marko /Petrović/
1 SEX M
1 BIRT
2 DATE MAR 1960
1 NOTE Prva linija
2 CONT druga
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 MARR
2 DATE 1955
2 PLAC Niš
0 TRLR`;
  it("converts people, parents and marriage", async () => {
    const { gedcomToBackup } = await import("./gedcom/import");
    let n = 0;
    const res = gedcomToBackup(ged, "Test", () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`)!;
    expect(res.people).toBe(3);
    const [jovan, jelena, marko] = res.backup.persons as unknown as Record<string, unknown>[];
    expect(jovan).toMatchObject({ first_name: "Jovan", last_name: "Petrović", gender: "male", birth_date: "1930-03-05", birth_date_precision: "exact", birth_place: "Niš", is_living: false });
    expect(jelena).toMatchObject({ birth_date: "1932-01-01", birth_date_precision: "about" });
    expect(marko).toMatchObject({ birth_date_precision: "month", notes: "Prva linija\ndruga" });
    expect(res.backup.parent_child).toHaveLength(2);
    expect(res.backup.partnerships[0]).toMatchObject({ kind: "marriage", status: "active", start_date: "1955-01-01" });
    expect(gedcomToBackup("0 HEAD\n0 TRLR", "x")).toBeNull();
  });
  it("parses date phrases", async () => {
    const { parseGedcomDate } = await import("./gedcom/import");
    expect(parseGedcomDate("BEF 1900")).toEqual({ date: "1900-01-01", precision: "before" });
    expect(parseGedcomDate("BET 1900 AND 1910")).toEqual({ date: "1900-01-01", precision: "about" });
    expect(parseGedcomDate("31 FEB 1900").date).toBeNull();
    expect(parseGedcomDate("unknown").date).toBeNull();
  });
});

describe("pdf writer", () => {
  it("writes a valid single-page PDF with a correct xref", async () => {
    const { pdfFromJpeg } = await import("./export/pdf");
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = pdfFromJpeg(jpeg, 2000, 1000, "A3", "Test");
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/MediaBox [0 0 1190.55 841.89]"); // wide image -> landscape A3
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const offs = [...text.slice(xrefAt).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    offs.forEach((o, i) => expect(text.slice(o, o + 7)).toBe(`${i + 1} 0 obj`));
  });
});
