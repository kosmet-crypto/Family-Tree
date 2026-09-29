"use client";
import { TreeDeciduous, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { isCloud } from "@/client/config";
import { errorText } from "@/client/repo";
import { Button } from "@/components/ui/button";

type Preview = { tree_name: string; inviter_name: string | null; role: string; status: string; expires_at: string; email_locked: boolean };

function Invite() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isCloud()) { setError("Позивнице раде када је апликација повезана са облаком."); return; }
    void (async () => {
      const { api, supabase } = await import("@/client/repo/cloud");
      setSignedIn(!!(await supabase().auth.getUser()).data.user);
      try { setPreview((await api<{ invite: Preview }>(`/api/invites/${token}`)).invite); } catch (e) { setError(errorText(e)); }
    })();
  }, [token]);

  const accept = async () => {
    setBusy(true);
    try {
      const { api } = await import("@/client/repo/cloud");
      const r = await api<{ treeId: string }>(`/api/invites/${token}/accept`, { method: "POST" });
      router.replace(`/tree?id=${r.treeId}`);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <main className="safe-top mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-5 px-5 text-center">
      <TreeDeciduous size={48} className="mx-auto text-primary" />
      {error ? <p className="text-danger">{error}</p> : !preview ? <p className="text-muted">Учитавање…</p> : (
        <>
          <h1 className="text-xl font-semibold">{preview.inviter_name ?? "Члан породице"} вас позива у стабло „{preview.tree_name}“</h1>
          <p className="flex items-center justify-center gap-2 text-sm text-muted"><Users size={16} /> Улога: {preview.role === "editor" ? "уредник" : "читалац"}</p>
          {preview.status !== "pending" ? <p className="text-danger">Позивница више не важи.</p> : signedIn ? (
            <Button className="justify-center" onClick={() => void accept()} disabled={busy}>Прихвати позивницу</Button>
          ) : (
            <Button className="justify-center" onClick={() => router.push(`/login?next=${encodeURIComponent(`/invite?token=${token}`)}`)}>Пријави се да прихватиш</Button>
          )}
        </>
      )}
    </main>
  );
}

export default function InvitePage() {
  return <Suspense><Invite /></Suspense>;
}
