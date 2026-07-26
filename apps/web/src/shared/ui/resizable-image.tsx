/**
 * ResizableImage — the Tiptap Image node with a selection affordance and
 * mouse-drag resize, for the RichTextEditor.
 *
 * - Adds a `width` attribute (rendered as the plain `width` HTML attribute so it
 *   survives the editor's DOMPurify sanitize — see ALLOWED_ATTR there).
 * - Renders through a React node view: hovering or selecting the image outlines
 *   it (CSS in globals.css), and a bottom-right handle drag-resizes it live.
 */
import Image from '@tiptap/extension-image'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useRef } from 'react'

function ResizableImageView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const width = node.attrs.width as number | string | null

  function startResize(e: React.PointerEvent) {
    // Don't let the drag start a text selection / node drag.
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = imgRef.current?.offsetWidth ?? 0

    const onMove = (ev: PointerEvent) => {
      const next = Math.round(Math.max(40, startWidth + (ev.clientX - startX)))
      updateAttributes({ width: next })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <NodeViewWrapper
      as="span"
      className="rte-img-wrap"
      data-selected={selected ? 'true' : undefined}
    >
      <img
        ref={imgRef}
        src={node.attrs.src as string}
        alt={(node.attrs.alt as string) ?? ''}
        width={width ?? undefined}
        draggable={false}
      />
      {editor.isEditable && (
        <span
          className="rte-img-handle"
          contentEditable={false}
          onPointerDown={startResize}
          aria-hidden="true"
        />
      )}
    </NodeViewWrapper>
  )
}

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => el.getAttribute('width'),
        renderHTML: (attrs) => (attrs.width ? { width: String(attrs.width) } : {}),
      },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView)
  },
})
