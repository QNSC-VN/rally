/**
 * CommentThread — F5 work-item comments UI for the Work Item Detail page.
 *
 * Lists comments (author, relative time, edited marker), lets any collaborator
 * post a comment, and edit/delete their own. Supports lightweight @mentions:
 * typing "@" opens a project-member picker; the selected members are sent as
 * mentionedUserIds so the backend fires mention notifications (F7).
 * Read-only mode (viewers) hides the composer and edit/delete controls.
 */
import { BRAND } from '@/shared/config/brand'
import { useMemo, useRef, useState } from 'react'
import { MessageSquare, Pencil, Trash2 } from 'lucide-react'
import {
  useComments,
  useCreateComment,
  useUpdateComment,
  useDeleteComment,
  type Comment,
} from '@/features/collaboration/api'
import { useProjectMembers } from '@/features/teams/api'
import { useAuthStore } from '@/shared/lib/stores/auth.store'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

function relativeTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

interface CommentThreadProps {
  workItemId: string | undefined
  projectId: string | undefined
  readOnly?: boolean
}

export function CommentThread({ workItemId, projectId, readOnly = false }: CommentThreadProps) {
  const { data: comments = [], isLoading } = useComments(workItemId)
  const { data: members = [] } = useProjectMembers(projectId)
  const createMutation = useCreateComment(workItemId)
  const updateMutation = useUpdateComment(workItemId)
  const deleteMutation = useDeleteComment(workItemId)
  const currentUserId = useAuthStore((s) => s.user?.id)

  const [draft, setDraft] = useState('')
  const [mentioned, setMentioned] = useState<Record<string, string>>({}) // userId -> displayName
  const [showPicker, setShowPicker] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)

  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const mem of members) m.set(mem.userId, mem.displayName ?? mem.userId.slice(0, 8))
    return m
  }, [members])

  function onDraftChange(v: string) {
    setDraft(v)
    // Open the mention picker when the last token starts with '@'.
    const lastToken =
      v
        .slice(0, taRef.current?.selectionStart ?? v.length)
        .split(/\s/)
        .pop() ?? ''
    setShowPicker(lastToken.startsWith('@'))
  }

  function pickMention(userId: string, name: string) {
    // Replace the trailing '@partial' with '@Name '.
    setDraft((d) => d.replace(/@\S*$/, `@${name} `))
    setMentioned((m) => ({ ...m, [userId]: name }))
    setShowPicker(false)
    taRef.current?.focus()
  }

  async function post() {
    const body = draft.trim()
    if (!body) return
    // Only keep mentions whose @Name still appears in the body.
    const mentionedUserIds = Object.entries(mentioned)
      .filter(([, name]) => body.includes(`@${name}`))
      .map(([id]) => id)
    await createMutation.mutateAsync({ body, mentionedUserIds })
    setDraft('')
    setMentioned({})
  }

  async function saveEdit(id: string) {
    const body = editBody.trim()
    if (body) await updateMutation.mutateAsync({ commentId: id, body })
    setEditingId(null)
  }

  const memberMatches = (() => {
    const lastToken = draft.split(/\s/).pop() ?? ''
    const q = lastToken.replace(/^@/, '').toLowerCase()
    return members.filter((m) => (m.displayName ?? '').toLowerCase().includes(q)).slice(0, 6)
  })()

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
        <MessageSquare size={13} />
        Comments
        {comments.length > 0 && <span className="text-[#9ca3af]">({comments.length})</span>}
      </div>

      {isLoading ? (
        <p className="text-[12px] text-[#9ca3af]">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="text-[12px] text-[#9ca3af]">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {[...comments]
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .map((c: Comment) => {
              const author = nameById.get(c.authorId) ?? c.authorId.slice(0, 8)
              const mine = c.authorId === currentUserId
              return (
                <li key={c.id} className="flex gap-2">
                  <div
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                    style={{ backgroundColor: BRAND.textSecondary }}
                  >
                    {initials(author)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[11px] text-foreground-subtle">
                      <span className="font-medium text-[#3a4252]">{author}</span>
                      <span>{relativeTime(c.createdAt)}</span>
                      {c.isEdited && <span className="italic">(edited)</span>}
                      {mine && !readOnly && editingId !== c.id && (
                        <span className="ml-auto flex gap-1">
                          <button
                            aria-label="Edit comment"
                            onClick={() => {
                              setEditingId(c.id)
                              setEditBody(c.body)
                            }}
                            className="text-[#b0b6c0] hover:text-primary-light"
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            aria-label="Delete comment"
                            onClick={() => void deleteMutation.mutate(c.id)}
                            className="text-[#b0b6c0] hover:text-destructive"
                          >
                            <Trash2 size={11} />
                          </button>
                        </span>
                      )}
                    </div>
                    {editingId === c.id ? (
                      <div className="mt-1">
                        <textarea
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          className="w-full rounded border border-input px-2 py-1 text-[12px]"
                          rows={2}
                        />
                        <div className="mt-1 flex gap-2">
                          <button
                            onClick={() => void saveEdit(c.id)}
                            className="rounded bg-primary-light px-2 py-0.5 text-[11px] text-white"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-[11px] text-foreground-subtle"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-0.5 text-[12px] whitespace-pre-wrap text-[#3a4252]">
                        {c.body}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
        </ul>
      )}

      {!readOnly && (
        <div className="relative mt-3">
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder="Add a comment… use @ to mention a teammate"
            rows={2}
            className="w-full rounded border border-input px-2 py-1.5 text-[12px]"
          />
          {showPicker && memberMatches.length > 0 && (
            <ul className="absolute z-50 mt-0.5 max-h-44 w-64 overflow-y-auto rounded border border-input bg-white shadow-lg">
              {memberMatches.map((m) => (
                <li key={m.userId}>
                  <button
                    onClick={() => pickMention(m.userId, m.displayName ?? m.userId.slice(0, 8))}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-surface-hover"
                  >
                    {m.displayName ?? m.userId.slice(0, 8)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-1 flex justify-end">
            <button
              onClick={() => void post()}
              disabled={!draft.trim() || createMutation.isPending}
              className="rounded bg-primary-light px-3 py-1 text-[12px] text-white disabled:opacity-50"
            >
              Comment
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
