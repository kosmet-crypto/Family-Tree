import { issueMessage, type IssueCode } from "@/lib/validation/issues";

const EXTRA: Record<string, string> = {
  tree_not_found: "Стабло није пронађено.",
  unauthorized: "Пријавите се поново.",
  forbidden: "Немате дозволу за ову радњу.",
  photo_quota_exceeded: "Достигнут је лимит слика за бесплатни пакет.",
  offline: "Нема интернет везе.",
  unsupported_format: "Овај формат слике прегледач не може да обради. Пробајте JPG или PNG.",
  bad_backup_format: "Фајл није исправан backup.",
  invalid_json: "Фајл није исправан JSON.",
  bad_zip: "ZIP фајл није исправан.",
  backup_too_large: "Backup је превелик.",
  invite_not_found: "Позивница не постоји.",
  invite_not_pending: "Позивница је већ искоришћена или опозвана.",
  invite_expired: "Позивница је истекла.",
  invite_email_mismatch: "Позивница је послата на другу email адресу.",
};

/** Error with a code the UI can translate (IssueCode or API error code). */
export class RepoError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "RepoError";
  }
}

export function errorText(err: unknown): string {
  const code = err instanceof RepoError ? err.code : (err as { code?: string })?.code;
  if (code && EXTRA[code]) return EXTRA[code];
  if (code) {
    try {
      const msg = issueMessage({ code: code as IssueCode, severity: "error" });
      if (msg && !msg.includes("undefined")) return msg;
    } catch {
      /* not an issue code */
    }
  }
  return err instanceof Error ? err.message : "Дошло је до грешке.";
}
