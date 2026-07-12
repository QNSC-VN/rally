import React from 'react'

interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void
  ariaLabel?: string
}

/**
 * Shared ResizeHandle component for table headers.
 * Renders a resize region on the right edge of a column cell.
 * The handle is positioned entirely within the column (`right: 0`)
 * to prevent overlap with adjacent columns.
 *
 * When the parent header cell (with "group" class) is hovered, the boundary
 * line becomes a subtle grey-blue. When hovered directly or dragged,
 * it highlights to active blue.
 */
export function ResizeHandle({ onMouseDown, ariaLabel = 'Resize column' }: ResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      className="absolute top-0 bottom-0 z-20 cursor-col-resize select-none"
      style={{
        right: 0,
        width: 6,
      }}
      onMouseDown={(e) => {
        e.stopPropagation()
        onMouseDown(e)
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="h-full w-[1.5px] bg-transparent group-hover:bg-slate-300 hover:!bg-[#0078d4] active:!bg-[#0078d4] transition-colors duration-150"
        style={{ marginLeft: 4.5 }}
      />
    </div>
  )
}