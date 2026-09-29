"use client";
import type { User } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isCloud } from "../config";

/**
 * Cloud mode: returns the signed-in user and redirects to /login when there is none.
 * Local mode: always "ready" without a user.
 */
export function useAuth(required = true) {
  const router = useRouter();
  const pathname = usePathname();
  const cloud = isCloud();
  const [state, setState] = useState<{ ready: boolean; user: User | null }>({ ready: !cloud, user: null });

  useEffect(() => {
    if (!cloud) return;
    let alive = true;
    void import("../repo/cloud").then(async ({ supabase }) => {
      const { data } = await supabase().auth.getUser();
      if (!alive) return;
      if (!data.user && required) {
        const next = typeof window !== "undefined" ? window.location.pathname + window.location.search : pathname;
        router.replace(`/login?next=${encodeURIComponent(next)}`);
        return;
      }
      setState({ ready: true, user: data.user });
    });
    return () => { alive = false; };
  }, [cloud, required, router, pathname]);

  return { ...state, cloud };
}
