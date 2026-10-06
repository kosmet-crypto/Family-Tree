"use client";
import { Crown, FileArchive, Heart, Info, LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { EntryMode, PhotoQuotaRow } from "@/lib/types/db";
import { clientConfig, credit } from "@/client/config";
import { useAuth } from "@/client/hooks/use-auth";
import { useRepo } from "@/client/hooks/use-repo";
import { errorText } from "@/client/repo";
import { purchasePremium, restorePurchases, billingAvailable } from "@/client/billing";
import { AppBar } from "@/components/app/app-bar";
import { apkVersionName } from "@/client/update";
import { UpdateNotice } from "@/components/app/update-notice";
import { BottomNav } from "@/components/app/bottom-nav";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

type Billing = { plan: "free" | "premium"; planExpiresAt: string | null; premium: boolean; photos: PhotoQuotaRow };

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">{icon}{title}</h2>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const auth = useAuth();
  const repo = useRepo();
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<EntryMode>("simple");
  const [apkVersion, setApkVersion] = useState("");
  useEffect(() => { void apkVersionName().then(setApkVersion); }, []);
  const [billing, setBilling] = useState<Billing | null>(null);

  useEffect(() => {
    if (!repo || !auth.ready) return;
    void repo.getEntryMode().then(setMode).catch(() => {});
    if (repo.mode === "cloud") {
      void import("@/client/repo/cloud").then(({ api }) => api<Billing>("/api/billing")).then(setBilling).catch(() => {});
    }
  }, [repo, auth.ready]);

  const changeMode = (m: EntryMode) => { setMode(m); void repo?.setEntryMode(m).then(() => toast("Сачувано.")).catch((e) => toast(errorText(e), "error")); };

  const buy = async () => {
    try {
      await purchasePremium(auth.user?.id ?? null);
      const { api } = await import("@/client/repo/cloud");
      setBilling(await api<Billing>("/api/billing"));
      toast("Хвала! Premium је активан.");
    } catch (e) { toast(errorText(e), "error"); }
  };

  return (
    <div className="min-h-dvh pb-24">
      <AppBar title="Подешавања" />
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-4">
        <Section title="Унос података" icon={<Info size={18} className="text-primary" />}>
          <Segmented<EntryMode> testId="settings-mode" value={mode} onChange={changeMode}
            options={[{ value: "simple", label: "Једноставан модел" }, { value: "complex", label: "Сложен модел" }]} />
          <p className="mt-2 text-sm text-muted">
            {mode === "simple"
              ? "Основни подаци: име, презиме, пол, рођење и смрт."
              : "Додатно: биолошки и усвојени родитељи, очух/маћеха, више бракова са датумима, рођено презиме, надимак, биографија и белешке."}
          </p>
        </Section>

        <Section title="Подаци" icon={<FileArchive size={18} className="text-primary" />}>
          <p className="mb-3 text-sm text-muted">Backup, враћање, увоз из Family Tree Maker-а и ажурирање апликације.</p>
          <Link href="/data" className="inline-flex"><Button variant="outline"><FileArchive size={18} /> Отвори „Подаци и ажурирање“</Button></Link>
        </Section>

        <Section title="Пакет" icon={<Crown size={18} className="text-primary" />}>
          {repo?.mode !== "cloud" ? (
            <p className="text-sm text-muted">У локалном режиму нема ограничења. Premium (неограничен простор у облаку) доступан је када се апликација повеже са налогом.</p>
          ) : billing ? (
            <div className="flex flex-col gap-2 text-sm">
              <p data-testid="plan">Пакет: <b>{billing.premium ? "Premium" : "Бесплатни"}</b>{billing.planExpiresAt ? ` (до ${new Date(billing.planExpiresAt).toLocaleDateString("sr-RS")})` : ""}</p>
              <p>Слике: {billing.photos.used}{billing.photos.limit !== null ? ` / ${billing.photos.limit}` : " (без ограничења)"}</p>
              {!billing.premium && billingAvailable() && <Button onClick={() => void buy()}><Crown size={18} /> Откључај Premium</Button>}
              {billingAvailable() && <Button variant="ghost" size="sm" onClick={() => void restorePurchases(auth.user?.id ?? null).then(() => toast("Куповине су обновљене.")).catch((e) => toast(errorText(e), "error"))}>Обнови куповине</Button>}
            </div>
          ) : <p className="text-sm text-muted">Учитавање…</p>}
        </Section>

        {repo?.mode === "cloud" && (
          <Section title="Налог" icon={<LogOut size={18} className="text-primary" />}>
            <p className="mb-2 text-sm text-muted">{auth.user?.email}</p>
            <Button variant="outline" onClick={() => void import("@/client/repo/cloud").then(({ supabase }) => supabase().auth.signOut()).then(() => router.replace("/login"))}><LogOut size={18} /> Одјава</Button>
          </Section>
        )}

        <section id="about" data-testid="about" className="rounded-2xl border border-border bg-surface p-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold"><Heart size={18} className="text-primary" />О апликацији</h2>
          <p className="text-[15px] font-medium">Roots &amp; Branches — Породично стабло</p>
          <div className="mt-2"><UpdateNotice /></div>
          <p className="text-sm text-muted">{apkVersion ? `Апликација ${apkVersion} · веб ` : "Верзија "}{clientConfig.appVersion} · {repo?.mode === "cloud" ? "облак" : "локални режим"}</p>
          <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-[15px]" data-testid="credit">{credit}</p>
        </section>
      </main>
      <BottomNav />
    </div>
  );
}
