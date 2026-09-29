"use client";
import { useEffect, useState } from "react";
import { getRepo, type Repo } from "../repo";

export function useRepo(): Repo | null {
  const [repo, setRepo] = useState<Repo | null>(null);
  useEffect(() => {
    let alive = true;
    void getRepo().then((r) => alive && setRepo(r));
    return () => { alive = false; };
  }, []);
  return repo;
}
