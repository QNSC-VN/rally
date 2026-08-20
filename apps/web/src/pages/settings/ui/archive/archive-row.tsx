/**
 * One row of `Settings > Archive`, with its two confirmations.
 *
 * Generic over the two populations on purpose: an archived Project and an archived Team differ only
 * in which mutations run and which copy sub-namespace the prompts come from, and the part worth
 * getting right — that a Restore is asked once, a Delete is asked harder, and that a SERVER refusal
 * is READ rather than toasted away — is identical. Two copies of it is two chances to fix one and not
 * the other.
 *
 * Three properties are load-bearing:
 *
 *  1. **The confirmation severity is per ACTION, not per row.** Restore destroys nothing (it reverses
 *     an archive), so it is a target-NAMED confirm — the same reasoning `project-teams-tab.tsx`
 *     records for its own restore. Delete is irreversible from the reader's point of view and gets
 *     `confirmText` where the client already knows the write will be attempted (a project), and a
 *     named confirm where the SERVER may refuse it (a team): making someone type a team name before
 *     they are even told the team still holds history is friction that buys nothing, and it teaches
 *     them to type it reflexively for the one that does go through.
 *  2. **A refusal is rendered IN the dialog, not as a toast.** `TEAM_HAS_HISTORY` names what blocks
 *     the delete and how many of them there are, which is the only actionable part of the answer. A
 *     toast is transient and sits far from the decision; the dialog stays open with the server's own
 *     sentence under the question, so the reader can act on it.
 *  3. **Nothing is pre-emptively disabled.** Whether a team is deletable cannot be computed here —
 *     half the referencing columns carry no foreign key, so only the server can count them — and a
 *     button greyed out on a guess is indistinguishable from one greyed out on a fact.
 */
import { useState, type ReactNode } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { errorMessage } from '@/shared/lib/toast'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { IconButton } from '@/shared/ui/icon-button'
import { useDisclosure } from '@/shared/lib/hooks/use-disclosure'

/** The shape both `useUpdate*`/`useDelete*` mutations already expose for a single call. */
export interface RowMutation {
  run: (handlers: { onSuccess: () => void; onError: (error: unknown) => void }) => void
  isPending: boolean
}

export function ArchiveRow({
  kind,
  itemKey,
  name,
  meta,
  typedDelete,
  restore,
  remove,
}: {
  /** The `archive.<kind>.*` copy sub-namespace — `project` or `team`. */
  kind: 'project' | 'team'
  itemKey: string
  name: string
  /** The identity columns after the name (counts, timestamps). */
  meta: ReactNode
  /** See property 1 above: `true` only where the client, not the server, decides the outcome. */
  typedDelete: boolean
  restore: RowMutation
  remove: RowMutation
}) {
  const { t } = useTranslation('settings')
  const restoring = useDisclosure()
  const deleting = useDisclosure()
  /**
   * The server's own sentence, kept across the failed attempt so the dialog can show it.
   *
   * Cleared when the dialog is opened rather than when it closes: a reader who dismisses a refusal
   * and reopens the prompt is asking the question again, and last time's answer is the most useful
   * thing on screen until the new one arrives.
   */
  const [refusal, setRefusal] = useState<string | null>(null)

  function openRestore() {
    setRefusal(null)
    restoring.open()
  }

  function openDelete() {
    setRefusal(null)
    deleting.open()
  }

  function confirmRestore() {
    restore.run({
      onSuccess: () => restoring.close(),
      onError: (error) => setRefusal(errorMessage(error, t(`archive.${kind}.restoreFailed`))),
    })
  }

  function confirmDelete() {
    remove.run({
      onSuccess: () => deleting.close(),
      // Deliberately NOT closing: the reason is the answer, and it belongs beside the question.
      onError: (error) => setRefusal(errorMessage(error, t(`archive.${kind}.deleteFailed`))),
    })
  }

  return (
    <tr className="border-t border-border-inner">
      <td className="px-3 py-2 font-mono text-ui-xs text-foreground-subtle">{itemKey}</td>
      <td className="px-3 py-2 text-ui-md text-foreground" title={name}>
        {name}
      </td>
      {meta}
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <IconButton
          size="sm"
          aria-label={t(`archive.${kind}.restoreAria`, { name })}
          title={t(`archive.${kind}.restoreConfirm`)}
          disabled={restore.isPending}
          onClick={openRestore}
        >
          <RotateCcw size={14} />
        </IconButton>
        <IconButton
          size="sm"
          variant="destructive"
          aria-label={t(`archive.${kind}.deleteAria`, { name })}
          title={t(`archive.${kind}.deleteConfirm`)}
          disabled={remove.isPending}
          onClick={openDelete}
        >
          <Trash2 size={14} />
        </IconButton>

        <ConfirmDialog
          open={restoring.isOpen}
          title={t(`archive.${kind}.restoreTitle`)}
          message={
            <Prompt text={t(`archive.${kind}.restoreMessage`, { name })} refusal={refusal} />
          }
          confirmLabel={t(`archive.${kind}.restoreConfirm`)}
          pending={restore.isPending}
          onConfirm={confirmRestore}
          onCancel={restoring.close}
        />
        <ConfirmDialog
          open={deleting.isOpen}
          title={t(`archive.${kind}.deleteTitle`)}
          message={<Prompt text={t(`archive.${kind}.deleteMessage`, { name })} refusal={refusal} />}
          confirmText={typedDelete ? name : undefined}
          confirmLabel={t(`archive.${kind}.deleteConfirm`)}
          destructive
          pending={remove.isPending}
          onConfirm={confirmDelete}
          onCancel={deleting.close}
        />
      </td>
    </tr>
  )
}

/** The question, plus the server's answer to the last attempt when there was one. */
function Prompt({ text, refusal }: { text: string; refusal: string | null }) {
  return (
    <>
      {text}
      {refusal && (
        <span
          role="alert"
          className="mt-3 block rounded border border-destructive-border bg-destructive-bg px-3 py-2 text-ui-sm text-destructive"
        >
          {refusal}
        </span>
      )}
    </>
  )
}
