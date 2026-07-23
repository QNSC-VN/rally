/**
 * RichTextEditor — Tiptap-based rich text component.
 *
 * Design principles:
 * - Matches the mockup toolbar exactly (Bold/Italic/Underline/Strike,
 *   lists, headings, links, code, undo/redo).
 * - Built on Tiptap/ProseMirror — `document.execCommand`, which this
 *   component used previously, has been dropped by Chrome/Edge for most
 *   rich-editing commands, silently no-op'ing every toolbar action and
 *   typed input. Tiptap owns the DOM directly via ProseMirror's own
 *   transaction model, so it isn't affected by that removal.
 * - Reports edits via onChange on blur (or Ctrl/Cmd+Enter) — it does NOT
 *   persist anything itself. The owning page decides when to actually save
 *   (Broadcom-Rally-style explicit Save/Cancel, not per-field autosave); see
 *   usePendingPatch + SaveCancelBar.
 * - Output is DOMPurify-sanitized before both render and onChange, so a
 *   future extension misconfiguration still can't emit disallowed markup.
 * - readOnly prop disables all editing and shows a flat read view.
 * - Pasting an image inserts it immediately as a local blob-URL preview (no
 *   network call) — the owning page's Save step is responsible for actually
 *   uploading it and rewriting the src to a durable URL before persisting.
 */
import { BRAND } from '@/shared/config/brand'
import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Image from '@tiptap/extension-image'
import DOMPurify from 'dompurify'
import { Tooltip } from './tooltip'
import {
  AlignLeft,
  Bold,
  Code2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Maximize2,
  Minimize2,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from 'lucide-react'

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'del',
      'strike',
      'h2',
      'h3',
      'h4',
      'blockquote',
      'pre',
      'code',
      'ul',
      'ol',
      'li',
      'a',
      'span',
      'div',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'hr',
      'img',
    ],
    // DOMPurify's default ALLOWED_URI_REGEXP does not include blob: (by
    // design — it's normally an XSS vector). This override adds it because
    // that's how a pasted image renders as a local preview before the owning
    // page's Save step uploads it and rewrites src to a durable
    // /attachments/.../content URL. Otherwise identical to DOMPurify's own
    // default (https/ftp/mailto/tel/etc. + relative paths).
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'src', 'alt'],
    ALLOWED_URI_REGEXP:
      /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
    ALLOW_DATA_ATTR: false,
  }) as string
}

/**
 * Tiptap's own getHTML() serializes an empty document as `<p></p>` (its
 * schema always has at least one paragraph node), never `''`. A caller's
 * `value` prop, on the other hand, is `null`/`''`/undefined for "no content
 * yet". Comparing the two directly without this normalization made every
 * field with empty content look "changed" the instant the editor mounted —
 * marking the page dirty before the user touched anything.
 */
function isEmptyHtml(html: string): boolean {
  return html === '' || html === '<p></p>'
}

/** Equal for dirty-checking purposes — treats every empty-content shape as one value. */
function htmlEquals(a: string, b: string): boolean {
  if (isEmptyHtml(a) && isEmptyHtml(b)) return true
  return a === b
}

// ── Toolbar button ────────────────────────────────────────────────────────────
interface ToolButtonProps {
  label: string
  disabled?: boolean
  active?: boolean
  onAction: () => void
  children: React.ReactNode
}

function ToolButton({ label, disabled, active, onAction, children }: ToolButtonProps) {
  return (
    <Tooltip content={label} delayDuration={800}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onMouseDown={(e) => {
          // Prevent editor blur before the command runs
          e.preventDefault()
          if (!disabled) onAction()
        }}
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-sm transition-colors disabled:cursor-not-allowed"
        style={{
          color: active ? BRAND.primaryLight : BRAND.textSecondary,
          backgroundColor: active ? BRAND.primaryLighter : 'transparent',
          opacity: disabled ? 0.35 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
        onMouseEnter={(e) => {
          if (!disabled)
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = active
              ? BRAND.primaryLighter
              : BRAND.pageBg
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = active
            ? BRAND.primaryLighter
            : 'transparent'
        }}
      >
        {children}
      </button>
    </Tooltip>
  )
}

function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-input" />
}

// ── Toolbar ───────────────────────────────────────────────────────────────────
function Toolbar({
  editor,
  expanded,
  onToggleExpand,
}: {
  editor: Editor
  expanded: boolean
  onToggleExpand: () => void
}) {
  const handleLink = useCallback(() => {
    const previousUrl = editor.getAttributes('link')['href'] as string | undefined
    const url = window.prompt('Enter URL:', previousUrl ?? '')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor])

  const formatValue = editor.isActive('heading', { level: 2 })
    ? 'h2'
    : editor.isActive('heading', { level: 3 })
      ? 'h3'
      : editor.isActive('blockquote')
        ? 'blockquote'
        : 'p'

  const handleFormatBlock = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const chain = editor.chain().focus()
      switch (e.target.value) {
        case 'h2':
          chain.setHeading({ level: 2 }).run()
          break
        case 'h3':
          chain.setHeading({ level: 3 }).run()
          break
        case 'blockquote':
          chain.setBlockquote().run()
          break
        default:
          chain.setParagraph().run()
      }
    },
    [editor],
  )

  return (
    <div
      className="flex flex-wrap items-center gap-0.5 overflow-x-auto border-b border-border-strong bg-card px-2 py-1.5"
      style={{ flexShrink: 0 }}
    >
      <ToolButton
        label="Undo"
        disabled={!editor.can().undo()}
        onAction={() => editor.chain().focus().undo().run()}
      >
        <Undo2 size={13} />
      </ToolButton>
      <ToolButton
        label="Redo"
        disabled={!editor.can().redo()}
        onAction={() => editor.chain().focus().redo().run()}
      >
        <Redo2 size={13} />
      </ToolButton>
      <Divider />
      <select
        aria-label="Text style"
        value={formatValue}
        onChange={handleFormatBlock}
        className="h-7 w-28 rounded-sm border border-input bg-card px-2 text-ui-sm text-foreground focus:outline-none"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <option value="p">Paragraph</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="blockquote">Quote</option>
      </select>
      <Divider />
      <ToolButton
        label="Bold"
        active={editor.isActive('bold')}
        onAction={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={14} />
      </ToolButton>
      <ToolButton
        label="Italic"
        active={editor.isActive('italic')}
        onAction={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic size={14} />
      </ToolButton>
      <ToolButton
        label="Underline"
        active={editor.isActive('underline')}
        onAction={() => editor.chain().focus().toggleUnderline().run()}
      >
        <Underline size={14} />
      </ToolButton>
      <ToolButton
        label="Strikethrough"
        active={editor.isActive('strike')}
        onAction={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough size={14} />
      </ToolButton>
      <Divider />
      <ToolButton
        label="Bulleted list"
        active={editor.isActive('bulletList')}
        onAction={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={14} />
      </ToolButton>
      <ToolButton
        label="Numbered list"
        active={editor.isActive('orderedList')}
        onAction={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={14} />
      </ToolButton>
      <ToolButton label="Align left" onAction={() => {}} disabled>
        <AlignLeft size={14} />
      </ToolButton>
      <Divider />
      <ToolButton label="Insert link" active={editor.isActive('link')} onAction={handleLink}>
        <Link2 size={14} />
      </ToolButton>
      <ToolButton
        label="Code block"
        active={editor.isActive('codeBlock')}
        onAction={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <Code2 size={14} />
      </ToolButton>

      {/* Expand / collapse — pinned to the toolbar's right edge (Rally parity). */}
      <div className="ml-auto flex items-center">
        <ToolButton
          label={expanded ? 'Collapse editor' : 'Expand editor'}
          onAction={onToggleExpand}
        >
          {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </ToolButton>
      </div>
    </div>
  )
}

// ── Image paste ───────────────────────────────────────────────────────────────

/**
 * Reads image files off a paste event's clipboard data. Returns [] for a
 * normal text/HTML paste — Tiptap's own paste handling covers that case.
 */
function imageFilesFromClipboard(data: DataTransfer): File[] {
  const files: File[] = []
  for (const item of data.items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  return files
}

// ── Main component ────────────────────────────────────────────────────────────
interface RichTextEditorProps {
  /** Section heading shown in the header bar */
  title: string
  /** Initial HTML value (sanitized before rendering) */
  value?: string | null
  /** Minimum content area height in px */
  minHeight?: number
  /** Disable all editing */
  readOnly?: boolean
  /**
   * Called with the current sanitized HTML whenever content changes
   * (including a pasted-image preview being inserted). Does NOT persist
   * anything — the owning page decides when to actually save. Prefer this
   * over onBlur for pages using usePendingPatch/SaveCancelBar, since it
   * fires immediately (needed to show the dirty-state bar as soon as the
   * user starts typing, not only once they click away).
   */
  onChange?: (html: string) => void
  /**
   * Called with the current sanitized HTML on blur, only when it actually
   * changed since the field was focused. For pages that still save this
   * field immediately (not yet migrated to the Save/Cancel pattern) — do not
   * combine with onChange on the same page, prefer one or the other.
   */
  onBlur?: (html: string) => void
  /** Optional extra CSS class on the outer wrapper */
  className?: string
}

export function RichTextEditor({
  title,
  value,
  minHeight = 80,
  readOnly = false,
  onChange,
  onBlur,
  className = '',
}: RichTextEditorProps) {
  const [expanded, setExpanded] = useState(false)
  const [focused, setFocused] = useState(false)
  // Mirrors the latest callbacks so the paste handler and onBlur (registered
  // once at editor creation) always call the current callback, not a stale
  // closure from the render that created the editor. Updated in an effect
  // (not during render) — mutating a ref while rendering is a React footgun.
  const onChangeRef = useRef(onChange)
  const onBlurRef = useRef(onBlur)
  const valueAtFocusRef = useRef(value)
  // Tracks the latest external `value` prop (distinct from valueAtFocusRef,
  // which freezes at focus time) — used by onUpdate to detect a real edit vs.
  // Tiptap's own mount-time content normalization firing a spurious update.
  const valueRef = useRef(value)
  useEffect(() => {
    onChangeRef.current = onChange
    onBlurRef.current = onBlur
    valueRef.current = value
  }, [onChange, onBlur, value])

  const editor = useEditor({
    editable: !readOnly,
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: `Add ${title.toLowerCase()}…` }),
      Image.configure({ inline: false, allowBase64: false }),
    ],
    content: sanitize(value ?? ''),
    editorProps: {
      attributes: {
        // min-height lives on the editable element itself (not the wrapper) so
        // the ENTIRE box is clickable/typable, not just the top text line.
        class: 'px-4 py-3 text-ui-lg leading-6 text-foreground focus:outline-none',
        style: `min-height:${minHeight}px`,
      },
      handlePaste: (view, event) => {
        const files = event.clipboardData ? imageFilesFromClipboard(event.clipboardData) : []
        if (files.length === 0) return false // let Tiptap handle normal text/HTML paste

        event.preventDefault()
        for (const file of files) {
          // No upload here — just a local preview. The owning page's Save
          // step is responsible for uploading and rewriting src to a durable
          // URL before persisting (see usePendingPatch + the image-paste
          // upload step in work-item-detail-page).
          const src = URL.createObjectURL(file)
          const { schema } = view.state
          const node = schema.nodes['image']?.create({ src, alt: file.name })
          if (!node) continue
          const tr = view.state.tr.replaceSelectionWith(node)
          view.dispatch(tr)
        }
        return true
      },
    },
    onFocus: () => {
      setFocused(true)
      valueAtFocusRef.current = value
    },
    onBlur: ({ editor: ed }) => {
      setFocused(false)
      if (!onBlurRef.current) return
      const html = sanitize(ed.getHTML())
      if (!htmlEquals(html, sanitize(valueAtFocusRef.current ?? ''))) onBlurRef.current(html)
    },
    onUpdate: ({ editor: ed }) => {
      // Tiptap can fire onUpdate during its own initial content normalization
      // on mount, not just from real user edits — compare against the
      // external value (the same guard onBlur uses) so mounting a field with
      // existing content never marks a page dirty before anyone touches it.
      const html = sanitize(ed.getHTML())
      if (!htmlEquals(html, sanitize(valueRef.current ?? ''))) onChangeRef.current?.(html)
    },
  })

  // Sync external value into the editor (only when it changes externally —
  // e.g. after a save round-trips, a Cancel reverts local edits, or another
  // tab/user updates it). Comparing sanitized HTML avoids clobbering the
  // user's cursor on every keystroke.
  useEffect(() => {
    if (!editor) return
    const clean = sanitize(value ?? '')
    if (!htmlEquals(sanitize(editor.getHTML()), clean)) {
      editor.commands.setContent(clean, { emitUpdate: false })
    }
  }, [value, editor])

  // Keep editable state in sync if readOnly changes after mount.
  useEffect(() => {
    editor?.setEditable(!readOnly)
  }, [editor, readOnly])

  const handleKeyDownCapture = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      ;(e.currentTarget.querySelector('.ProseMirror') as HTMLElement | null)?.blur()
    }
  }, [])

  if (!editor) return null

  return (
    <div
      className={`flex flex-col ${className}`}
      style={
        expanded
          ? {
              position: 'fixed',
              inset: '10%',
              zIndex: 50,
              backgroundColor: BRAND.surface,
              boxShadow: '0 20px 60px rgba(0,0,0,.25)',
              borderRadius: 4,
              padding: 12,
            }
          : undefined
      }
    >
      {/* Field label — sits ABOVE the box (Rally parity), not inside it. */}
      <span className="mb-1 text-ui-sm font-semibold text-muted-foreground select-none">
        {title}
      </span>

      {/* Editor box — one border wrapping toolbar + content, no inner divider. */}
      <section
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded bg-card transition-[border-color]"
        style={{ border: focused ? '1px solid var(--ring)' : `1px solid ${BRAND.border}` }}
      >
        {!readOnly && (
          <Toolbar editor={editor} expanded={expanded} onToggleExpand={() => setExpanded((v) => !v)} />
        )}

        {/* Content area */}
        <div
          onKeyDownCapture={handleKeyDownCapture}
          className={`rte-content ${readOnly ? 'bg-surface-hover' : 'bg-card'}`}
          style={{
            overflowY: expanded ? 'auto' : undefined,
            flex: expanded ? '1' : undefined,
          }}
        >
          <EditorContent editor={editor} />
        </div>
      </section>
    </div>
  )
}
