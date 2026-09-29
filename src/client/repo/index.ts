import { isCloud } from "../config";
import type { Repo } from "./types";

let repo: Repo | null = null;

/** The data layer for this build: Supabase when configured, otherwise this browser. */
export async function getRepo(): Promise<Repo> {
  if (!repo) {
    if (isCloud()) {
      const { CloudRepo } = await import("./cloud");
      repo = new CloudRepo();
    } else {
      const { LocalRepo } = await import("./local");
      repo = new LocalRepo();
    }
  }
  return repo;
}

export type { Repo, TreeData, TreeSummary } from "./types";
export { RepoError, errorText } from "./errors";
