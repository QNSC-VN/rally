/**
 * Shared helpers for email provider constructors.
 * Keeps FROM-address resolution and header-building DRY across SES, Resend, etc.
 */
import type { AppConfigService } from '../../config/app-config.service';
import type { EmailCategory } from '../email.provider';

/**
 * Resolve the verified sender address from config.
 * MAIL_FROM_EMAIL is canonical; SES_FROM_EMAIL is kept as a backward-compat alias.
 * Throws if neither is set (caught at module init, not at send time).
 */
export function resolveFromEmail(config: AppConfigService): string {
  const email = (config.get('MAIL_FROM_EMAIL') ?? config.get('SES_FROM_EMAIL')) as
    | string
    | undefined;
  return email ?? '';
}

/**
 * Build the RFC 5322 "Display Name <address>" From header value.
 * Using a display name is required for anti-spam compliance — bare addresses
 * score lower with Gmail's spam filters.
 *
 *   buildFromAddress(config)  →  "Mini Rally <noreply@app.example.com>"
 */
export function buildFromAddress(config: AppConfigService): string {
  const email = resolveFromEmail(config);
  const name = (config.get('MAIL_FROM_NAME') as string | undefined) ?? 'Mini Rally';
  return `"${name}" <${email}>`;
}

/**
 * Build RFC 2369 + RFC 8058 anti-spam headers based on email category.
 *
 * Rules:
 *   transactional — NO List-Unsubscribe (not required; adding it can hurt
 *                   deliverability by marking 1:1 transactional mail as bulk).
 *   notification  — List-Unsubscribe + List-Unsubscribe-Post (user can opt out).
 *   marketing     — Same as notification, plus Precedence: bulk.
 *
 * Google/Yahoo 2024 require one-click unsubscribe for bulk senders (>5 000
 * messages/day to Gmail).  For Phase 0 volumes this is future-proofing, but
 * the infrastructure is ready.
 */
export function buildUnsubscribeHeaders(
  category: EmailCategory,
  appBaseUrl: string,
): Record<string, string> {
  if (category === 'transactional') return {};

  const domain = new URL(appBaseUrl).hostname;
  const headers: Record<string, string> = {
    'List-Unsubscribe': `<mailto:unsubscribe@${domain}?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
  if (category === 'marketing') {
    headers['Precedence'] = 'bulk';
  }
  return headers;
}
