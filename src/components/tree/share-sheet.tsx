"use client";
// Sharing (cloud mode): invitation links and members.
import { Copy, Link2, Share2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { TreeRole } from "@/lib/types/db";
import { errorText } from "@/client/repo";
import { Button } from "../ui/button";
import { Field, Input, Select } from "../ui/field";
import { Sheet } from "../ui/sheet";
import { useToast } from "../ui/toast";

type Invite = { id: string; email: string | null; role: TreeRole; status: string; expires_at: string; url: string | null };
type Member = { user_id: string; role: TreeRole; display_name: string | null };

export function ShareSheet({ open, onClose, treeId, treeName, role, userId }: {
  open: boolean; onClose: () => void; treeId: string; treeName: string; role: TreeRole; userId: string | null;
}) {
  const toast = useToast();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"viewer" | "editor">("viewer");
  const [link, setLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { api } = await import("@/client/repo/cloud");
    try {
      setMembers((await api<{ members: Member[] }>(`/api/trees/${treeId}/members`)).members);
      if (role !== "viewer") setInvites((await api<{ invites: Invite[] }>(`/api/trees/${treeId}/invites`)).invites);
    } catch (e) { toast(errorText(e), "error"); }
  }, [treeId, role, toast]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const create = async () => {
    const { api } = await import("@/client/repo/cloud");
    try {
      const r = await api<{ invite: Invite }>(`/api/trees/${treeId}/invites`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() || null, role: inviteRole }),
      });
      setLink(r.invite.url);
      setEmail("");
      void load();
    } catch (e) { toast(errorText(e), "error"); }
  };

  const share = async (url: string) => {
    const text = `Позивам те у породично стабло „${treeName}“`;
    if (navigator.share) { await navigator.share({ title: treeName, text, url }).catch(() => {}); return; }
    await navigator.clipboard.writeText(url);
    toast("Линк је копиран.");
  };

  const revoke = async (id: string) => {
    const { api } = await import("@/client/repo/cloud");
    try { await api(`/api/trees/${treeId}/invites/${id}`, { method: "DELETE" }); void load(); } catch (e) { toast(errorText(e), "error"); }
  };

  const remove = async (uid: string) => {
    const { api } = await import("@/client/repo/cloud");
    if (!confirm(uid === userId ? "Напустити ово стабло?" : "Уклонити члана?")) return;
    try { await api(`/api/trees/${treeId}/members/${uid}`, { method: "DELETE" }); void load(); } catch (e) { toast(errorText(e), "error"); }
  };

  const ROLE: Record<TreeRole, string> = { owner: "власник", editor: "уредник", viewer: "читалац" };

  return (
    <Sheet open={open} onClose={onClose} title="Дељење стабла" testId="share-sheet">
      <div className="flex flex-col gap-5">
        {role !== "viewer" && (
          <section className="flex flex-col gap-3">
            <p className="text-sm text-muted">Пошаљите линк члану породице. Када се пријави, видеће ово стабло; уредник може и да га допуњује. Своје стабло касније може да споји са овим.</p>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Field label="Email (опционо)"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="само за ту адресу" /></Field>
              <Field label="Улога">
                <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "viewer" | "editor")} disabled={role !== "owner"}>
                  <option value="viewer">читалац</option>
                  {role === "owner" && <option value="editor">уредник</option>}
                </Select>
              </Field>
            </div>
            <Button onClick={() => void create()}><Link2 size={18} /> Направи позивницу</Button>
            {link && (
              <div className="flex items-center gap-2 rounded-xl bg-surface-2 p-2">
                <code className="min-w-0 flex-1 truncate text-xs">{link}</code>
                <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(link).then(() => toast("Копирано."))}><Copy size={16} /></Button>
                <Button size="sm" onClick={() => void share(link)}><Share2 size={16} /></Button>
              </div>
            )}
          </section>
        )}
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase text-muted">Чланови</h4>
          <ul className="flex flex-col gap-1">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5">
                <span>{m.display_name ?? "—"} <span className="text-xs text-muted">{ROLE[m.role]}{m.user_id === userId ? " · ви" : ""}</span></span>
                {m.role !== "owner" && (role === "owner" || m.user_id === userId) && (
                  <button type="button" aria-label="Уклони" onClick={() => void remove(m.user_id)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2"><Trash2 size={16} /></button>
                )}
              </li>
            ))}
          </ul>
        </section>
        {invites.filter((i) => i.status === "pending").length > 0 && (
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase text-muted">Активне позивнице</h4>
            <ul className="flex flex-col gap-1">
              {invites.filter((i) => i.status === "pending").map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-sm">
                  <span className="truncate">{i.email ?? "свако са линком"} · {ROLE[i.role]}</span>
                  <span className="flex gap-1">
                    {i.url && <button type="button" aria-label="Подели" onClick={() => void share(i.url!)} className="rounded-lg p-1.5 hover:bg-surface-2"><Share2 size={16} /></button>}
                    <button type="button" aria-label="Опозови" onClick={() => void revoke(i.id)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2"><Trash2 size={16} /></button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  );
}
