import { z } from "zod";
import { json, route, uuidParam, type Params } from "@/server/http";
import { createSnapshot, listSnapshots } from "@/server/services/backup";
import { requireUser } from "@/server/supabase";

type P = Params<{ treeId: string }>;

export const GET = route<P>(async (req, { params }) => {
  const treeId = uuidParam((await params).treeId, "treeId");
  const { supabase } = await requireUser(req);
  return json({ snapshots: await listSnapshots(supabase, treeId) });
});

const bodySchema = z.object({ label: z.string().trim().max(120).nullable().optional() }).default({});

/** Manual backup stored in the database. */
export const POST = route<P>(async (req, { params }) => {
  const treeId = uuidParam((await params).treeId, "treeId");
  const { supabase } = await requireUser(req);
  const text = await req.text();
  const body = bodySchema.parse(text ? JSON.parse(text) : {});
  return json(await createSnapshot(supabase, treeId, body.label), 201);
});
