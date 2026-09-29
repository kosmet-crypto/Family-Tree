// Supabase clients for route handlers.
// - Web: session in cookies (@supabase/ssr).
// - Capacitor app / other clients: "Authorization: Bearer <access token>".
// Both run as the signed-in user, so RLS applies to every query.

import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { env } from "./env";
import { ApiError } from "./http";

export type Db = SupabaseClient;

export interface UserContext {
  supabase: Db;
  user: User;
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  const m = h ? /^Bearer\s+(.+)$/i.exec(h) : null;
  return m?.[1]?.trim() || null;
}

/** Client for the caller (anonymous if not signed in). */
export async function clientFor(req: Request): Promise<Db> {
  const token = bearer(req);
  if (token) {
    return createClient(env.supabaseUrl, env.supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  let store: Awaited<ReturnType<typeof import("next/headers").cookies>> | null = null;
  try {
    const { cookies } = await import("next/headers");
    store = await cookies();
  } catch {
    // outside a Next.js request (tests, scripts): anonymous client
  }
  if (!store) {
    return createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  const { createServerClient } = await import("@supabase/ssr");
  const jar = store;
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) jar.set(name, value, options);
        } catch {
          // called from a context where cookies are read-only; middleware refreshes them
        }
      },
    },
  });
}

/** Client + verified user; throws 401 when the caller is not signed in. */
export async function requireUser(req: Request): Promise<UserContext> {
  const supabase = await clientFor(req);
  const token = bearer(req);
  const { data, error } = token ? await supabase.auth.getUser(token) : await supabase.auth.getUser();
  if (error || !data.user) throw new ApiError(401, "unauthorized");
  return { supabase, user: data.user };
}

/** Service-role client (bypasses RLS). Only for webhooks and trusted server jobs. */
export function adminClient(): Db {
  return createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
