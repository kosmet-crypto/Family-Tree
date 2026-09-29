// Test family used by the unit tests.
//
//   Staro(1900)            Old(1900)
//    ├─ Milan(1930) ═ Mira(1932) ─┤─ Stevan(1934)
//    └─ Rade(1933)   │            Dragan(1935)
//          ┌─────────┴───────┐        │
//      Jovan(1960)       Vesna(1963) ═ Petar(1961)
//   ═ Jelena(1962, divorced)  │
//   ═ Sanja(1965, active)    Ana(1988)
//     │         │
//   Marko(1990) Nikola(2000, Jovan+Sanja)   Luka(1995, Sanja only)
//     │
//   Maja(2020)
//   Loner (not connected)

import type { Gender, ParentChild, ParentRelation, Partnership, PartnershipStatus, Person } from "../types/db";
import { FamilyGraph } from "../graph/family-graph";

export const TREE = "00000000-0000-4000-8000-000000000001";

let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

export function makePerson(first: string, gender: Gender, birth: string | null, extra: Partial<Person> = {}): Person {
  return {
    id: uid(), tree_id: TREE, first_name: first, middle_name: null, last_name: "Petrović", birth_name: null,
    nickname: null, gender, birth_date: birth, birth_date_precision: "exact", birth_place: null,
    is_living: true, death_date: null, death_date_precision: "exact", death_place: null, occupation: null,
    bio: null, notes: null, avatar_media_id: null, extra: {}, ...extra,
  };
}

export function edge(parent: Person, child: Person, relation: ParentRelation = "biological"): ParentChild {
  return { id: uid(), tree_id: TREE, parent_id: parent.id, child_id: child.id, relation, start_date: null, notes: null };
}

export function marriage(a: Person, b: Person, status: PartnershipStatus = "active", start: string | null = null): Partnership {
  return {
    id: uid(), tree_id: TREE, person1_id: a.id, person2_id: b.id, kind: "marriage", status,
    start_date: start, start_place: null, end_date: null, sort_order: 0, notes: null,
  };
}

export function family() {
  const p = {
    staro: makePerson("Staro", "male", "1900-01-01", { is_living: false, death_date: "1970-01-01" }),
    old: makePerson("Old", "male", "1900-01-01", { is_living: false, death_date: "1975-01-01" }),
    milan: makePerson("Milan", "male", "1930-01-01", { is_living: false, death_date: "2001-05-05" }),
    rade: makePerson("Rade", "male", "1933-01-01"),
    mira: makePerson("Mira", "female", "1932-01-01"),
    stevan: makePerson("Stevan", "male", "1934-01-01"),
    dragan: makePerson("Dragan", "male", "1935-01-01"),
    jovan: makePerson("Jovan", "male", "1960-05-05"),
    vesna: makePerson("Vesna", "female", "1963-01-01"),
    petar: makePerson("Petar", "male", "1961-01-01", { last_name: "Ilić" }),
    jelena: makePerson("Jelena", "female", "1962-02-02"),
    sanja: makePerson("Sanja", "female", "1965-07-07", { last_name: "Ilić" }),
    marko: makePerson("Marko", "male", "1990-03-03"),
    nikola: makePerson("Nikola", "male", "2000-09-09"),
    luka: makePerson("Luka", "male", "1995-01-01", { last_name: "Ilić" }),
    ana: makePerson("Ana", "female", "1988-01-01", { last_name: "Ilić" }),
    maja: makePerson("Maja", "female", "2020-01-01"),
    loner: makePerson("Loner", "unknown", null, { last_name: "Nobody" }),
  };
  const edges = [
    edge(p.staro, p.milan), edge(p.staro, p.rade),
    edge(p.old, p.mira), edge(p.old, p.stevan),
    edge(p.milan, p.jovan), edge(p.mira, p.jovan),
    edge(p.milan, p.vesna), edge(p.mira, p.vesna),
    edge(p.dragan, p.jelena),
    edge(p.jovan, p.marko), edge(p.jelena, p.marko),
    edge(p.jovan, p.nikola), edge(p.sanja, p.nikola),
    edge(p.sanja, p.luka),
    edge(p.vesna, p.ana), edge(p.petar, p.ana),
    edge(p.marko, p.maja),
  ];
  const partnerships = [
    marriage(p.milan, p.mira, "widowed"),
    marriage(p.jovan, p.jelena, "divorced", "1988-06-01"),
    marriage(p.jovan, p.sanja, "active", "1998-06-01"),
    marriage(p.vesna, p.petar, "active"),
  ];
  const graph = new FamilyGraph(Object.values(p), edges, partnerships);
  return { p, edges, partnerships, graph };
}
