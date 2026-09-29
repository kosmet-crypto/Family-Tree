"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FamilyGraph } from "@/lib/graph/family-graph";
import { errorText, type Repo, type TreeData } from "../repo";

/** Loads a tree and keeps it fresh (local edits and, in cloud mode, other members' edits). */
export function useTree(repo: Repo | null, treeId: string | null) {
  const [data, setData] = useState<TreeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!repo || !treeId) return;
    try {
      setData(await repo.loadTree(treeId));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [repo, treeId]);

  useEffect(() => {
    void reload();
    if (!repo || !treeId) return;
    return repo.subscribe(treeId, () => void reload());
  }, [repo, treeId, reload]);

  const graph = useMemo(
    () => (data ? new FamilyGraph(data.persons, data.parentChild, data.partnerships) : null),
    [data],
  );
  return { data, graph, error, reload };
}
