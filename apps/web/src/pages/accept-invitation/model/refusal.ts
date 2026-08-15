/**
 * Which refusal the accept page is looking at — resolved from the BE's domain CODE, never its status.
 *
 * `WorkspaceService.acceptInvitation` throws five different exceptions across three HTTP statuses
 * (404 for `INVITATION_NOT_FOUND`, 422 for the three `PreconditionFailed` ones, 409 for
 * `INVITED_ROLE_IS_PROJECT_TIER`), and two of those statuses carry more than one meaning. Branching
 * on the status would therefore collapse "this invitation expired" into "you are signed in as the
 * wrong account" — and those two need OPPOSITE actions from the reader.
 *
 * Seven states, not six. `missingToken` is reached without a request at all (the link was truncated,
 * or someone typed the path), and `unknown` covers a 500 or a dropped connection — which must NOT
 * read as "your invitation is invalid", because nothing about the invitation has been established.
 * That is the same absent-versus-refused distinction `LoadErrorState` exists for.
 */
export const INVITATION_REFUSALS = [
  'missingToken',
  'notFound',
  'alreadyUsed',
  'expired',
  'emailMismatch',
  'roleIsProjectTier',
  'unknown',
] as const

export type InvitationRefusal = (typeof INVITATION_REFUSALS)[number]

/** `code` → refusal. Exhaustive over the codes `acceptInvitation` throws. */
const BY_CODE: Record<string, InvitationRefusal> = {
  INVITATION_NOT_FOUND: 'notFound',
  INVITATION_ALREADY_USED: 'alreadyUsed',
  INVITATION_EXPIRED: 'expired',
  INVITATION_EMAIL_MISMATCH: 'emailMismatch',
  INVITED_ROLE_IS_PROJECT_TIER: 'roleIsProjectTier',
}

export function refusalFor(code: string | undefined): InvitationRefusal {
  return (code && BY_CODE[code]) || 'unknown'
}

/**
 * What the reader can DO about it — one action per state, and the reason each is the right one.
 *
 * `signOut` belongs to `emailMismatch` alone. That refusal is the security control: an invitation is
 * bound to the address it was sent to, so a forwarded link, a shared inbox or a pasted URL cannot be
 * redeemed by whoever holds it. The reader is not at fault and the invitation is not broken — they are
 * simply signed in as somebody else — so the only action that resolves it is signing out and
 * returning to the SAME link as the invited person.
 *
 * `retry` belongs to `unknown` alone, because it is the only state where trying again can change the
 * answer. Offering it on `expired` would be a lie.
 *
 * Everything else gets `none`: the panel still links Home, so nobody is stranded, but the invitation
 * itself is beyond the reader's reach and only an administrator can issue a new one.
 */
export type RefusalAction = 'signOut' | 'retry' | 'none'

const ACTION: Record<InvitationRefusal, RefusalAction> = {
  missingToken: 'none',
  notFound: 'none',
  alreadyUsed: 'none',
  expired: 'none',
  emailMismatch: 'signOut',
  roleIsProjectTier: 'none',
  unknown: 'retry',
}

export function actionFor(refusal: InvitationRefusal): RefusalAction {
  return ACTION[refusal]
}
