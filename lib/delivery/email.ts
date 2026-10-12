import "server-only";
import { Resend } from "resend";
import { EMAIL_TIMEOUT_MS } from "@/lib/config";
import { errorMessage } from "@/lib/log";
import { backoffMs, sleep } from "@/lib/util";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Provider-side dedupe key (Resend keeps it for 24h). */
  idempotencyKey: string;
}

export interface EmailProvider {
  readonly name: string;
  send(msg: EmailMessage): Promise<{ id: string }>;
}

export class EmailNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Email delivery is not configured: missing ${missing.join(", ")}.`);
    this.name = "EmailNotConfiguredError";
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`email provider timed out after ${ms}ms`)), ms))]);
}

export function createResendProvider(apiKey: string | undefined, from: string | undefined): EmailProvider {
  const missing = [!apiKey && "RESEND_API_KEY", !from && "EMAIL_FROM"].filter(Boolean) as string[];
  if (missing.length) throw new EmailNotConfiguredError(missing);
  const resend = new Resend(apiKey);
  return {
    name: "resend",
    async send(msg) {
      const { data, error } = await withTimeout(
        resend.emails.send(
          { from: from!, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, headers: { "X-Entity-Ref-ID": msg.idempotencyKey } },
          { idempotencyKey: msg.idempotencyKey },
        ),
        EMAIL_TIMEOUT_MS,
      );
      if (error || !data) throw new Error(error ? `${error.name}: ${error.message}` : "Resend returned no message id");
      return { id: data.id };
    },
  };
}

export interface DeliveryAttempt {
  recipient: string;
  status: "sent" | "failed";
  providerMessageId: string | null;
  error: string | null;
  attempts: number;
}

/**
 * Sends one email per recipient (recipients never see each other). Each send is
 * retried once on failure. The idempotency key is stable per week + recipient
 * (+ resend generation), so a duplicated invocation cannot double-send.
 */
export async function deliverToAll(
  provider: EmailProvider,
  recipients: string[],
  message: Omit<EmailMessage, "to" | "idempotencyKey">,
  keyPrefix: string,
  sleepImpl: (ms: number) => Promise<void> = sleep,
): Promise<DeliveryAttempt[]> {
  const out: DeliveryAttempt[] = [];
  for (const to of recipients) {
    let attempts = 0;
    let lastError: string | null = null;
    let id: string | null = null;
    while (attempts < 2 && !id) {
      attempts++;
      try {
        id = (await provider.send({ ...message, to, idempotencyKey: `${keyPrefix}:${to}`.slice(0, 256) })).id;
      } catch (err) {
        lastError = errorMessage(err);
        if (attempts < 2) await sleepImpl(backoffMs(1, 1_000, 4_000));
      }
    }
    out.push({ recipient: to, status: id ? "sent" : "failed", providerMessageId: id, error: id ? null : lastError, attempts });
  }
  return out;
}
