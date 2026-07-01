/**
 * IEmailProvider — provider-agnostic transport interface.
 *
 * Swap AWS SES ↔ Brevo ↔ Resend ↔ SMTP by changing the registered provider
 * in PlatformModule without touching any business logic.
 */

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

/**
 * Email category controls which RFC-compliance headers are added by the
 * transport layer:
 *
 * - 'transactional' — password-reset, invitation, account-verification, etc.
 *   These are 1:1 messages triggered by user action.  Do NOT add
 *   List-Unsubscribe headers — they look like bulk spam to spam filters and
 *   are not required by Google/Yahoo 2024 rules for transactional mail.
 *
 * - 'marketing' — newsletters, digests, campaigns.  Google/Yahoo 2024 rules
 *   REQUIRE `List-Unsubscribe` + `List-Unsubscribe-Post` for bulk senders
 *   (>5 000 messages/day to Gmail).  Add `Precedence: bulk` here.
 *
 * - 'notification' — system alerts, activity digests.  Add List-Unsubscribe
 *   if the user can opt-out of them in settings.
 */
export type EmailCategory = 'transactional' | 'notification' | 'marketing';

export interface EmailPayload {
  to: string;
  /** Formatted "Display Name <address@domain.com>" sender. Providers should
   *  build this from MAIL_FROM_NAME + MAIL_FROM_EMAIL env vars; callers can
   *  override for special cases (e.g. a team-specific sender). */
  from?: string;
  /** Reply-To address. Defaults to MAIL_REPLY_TO config value. */
  replyTo?: string;
  subject: string;
  /** Full HTML body. Falls back to text if not rendered by template. */
  html: string;
  /** Plain-text fallback — always required for accessibility + spam score. */
  text: string;
  /**
   * Controls transport-level headers:
   * - 'transactional' (default) — no List-Unsubscribe, no Precedence header.
   * - 'notification' — adds List-Unsubscribe for user opt-out.
   * - 'marketing' — adds List-Unsubscribe, Precedence: bulk.
   */
  category?: EmailCategory;
  /** Stable idempotency key — providers use this to deduplicate retries.
   *  Defaults to a random UUID if not supplied. */
  idempotencyKey?: string;
}

export interface IEmailProvider {
  send(payload: EmailPayload): Promise<void>;
}
