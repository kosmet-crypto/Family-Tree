import { json } from "@/server/http";

export function GET() {
  return json({ ok: true, time: new Date().toISOString() });
}
