"use client";
import { Mail, TreeDeciduous } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { isCloud } from "@/client/config";
import { Button } from "@/components/ui/button";
import { Field, Input, Segmented } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const toast = useToast();
  const [tab, setTab] = useState<"signin" | "signup" | "magic">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => { if (!isCloud()) router.replace("/"); }, [router]);

  const go = async () => {
    setBusy(true);
    try {
      const { supabase } = await import("@/client/repo/cloud");
      const auth = supabase().auth;
      const redirect = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${next}`;
      if (tab === "magic") {
        const { error } = await auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
        if (error) throw error;
        setSent(true);
      } else if (tab === "signup") {
        const { data, error } = await auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: redirect } });
        if (error) throw error;
        if (data.session) router.replace(next); else setSent(true);
      } else {
        const { error } = await auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Пријава није успела.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="safe-top mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-5 px-5">
      <div className="flex flex-col items-center gap-2 text-center">
        <TreeDeciduous size={48} className="text-primary" />
        <h1 className="text-2xl font-semibold">Roots &amp; Branches</h1>
        <p className="text-sm text-muted">Ваше породично стабло, сачувано и доступно целој породици.</p>
      </div>
      {sent ? (
        <p className="rounded-xl bg-surface-2 p-4 text-center"><Mail className="mx-auto mb-2 text-primary" /> Проверите email и отворите линк за пријаву.</p>
      ) : (
        <>
          <Segmented value={tab} onChange={setTab} options={[{ value: "signin", label: "Пријава" }, { value: "signup", label: "Регистрација" }, { value: "magic", label: "Линк" }]} />
          {tab === "signup" && <Field label="Име"><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>}
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></Field>
          {tab !== "magic" && <Field label="Лозинка"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={tab === "signup" ? "new-password" : "current-password"} /></Field>}
          <Button className="justify-center" onClick={() => void go()} disabled={busy || !email || (tab !== "magic" && password.length < 6)}>
            {tab === "signin" ? "Пријави се" : tab === "signup" ? "Направи налог" : "Пошаљи линк"}
          </Button>
        </>
      )}
    </main>
  );
}

export default function LoginPage() {
  return <Suspense><Login /></Suspense>;
}
