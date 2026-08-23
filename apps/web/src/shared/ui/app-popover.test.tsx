/**
 * Every popover paints ABOVE the sticky grid header, and the layer is stated in ONE place.
 *
 * `DataTableHeader` is `sticky top-0 z-10`. A portalled popover with no z-index of its own loses to
 * it in paint order, which is how both Manage Filters menus came to open UNDER the header they hang
 * over — mounted, focused and keyboard-operable, with their top rows painted behind it. Five other
 * popovers had each hardcoded `z-50` at their own call site, so the two that had not copied that
 * line were exactly the two that broke.
 */
import { render, screen } from '@testing-library/react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { AppPopoverContent } from './app-popover'

function openPopover(props: { className?: string } = {}) {
  return render(
    <PopoverPrimitive.Root open>
      <PopoverPrimitive.Trigger>open</PopoverPrimitive.Trigger>
      <AppPopoverContent {...props}>
        <span>panel</span>
      </AppPopoverContent>
    </PopoverPrimitive.Root>,
  )
}

describe('AppPopoverContent', () => {
  it('carries the z-50 floor with no caller opt-in', () => {
    openPopover()
    // The defect, in one assertion: a popover that declares nothing must still outrank `z-10`.
    expect(screen.getByText('panel').closest('[data-radix-popper-content-wrapper]')).not.toBeNull()
    const content = screen.getByText('panel').parentElement
    expect(content?.className).toContain('z-50')
  })

  it('keeps a caller’s own classes alongside it', () => {
    openPopover({ className: 'w-64 rounded' })
    const content = screen.getByText('panel').parentElement
    expect(content?.className).toContain('z-50')
    expect(content?.className).toContain('w-64')
    expect(content?.className).toContain('rounded')
  })
})

describe('the layer is stated once', () => {
  const ui = (f: string) => readFileSync(join(import.meta.dirname, f), 'utf8')

  it('no popover call site re-declares z-50', () => {
    // Source text, deliberately: this is an ABSENCE across files, and rendering each popover to
    // prove it would pass just as happily when a mock kept the panel from mounting at all. Five
    // copies of one decision is what let two call sites miss it.
    for (const file of [
      'action-menu.tsx',
      'date-field.tsx',
      'searchable-select.tsx',
      'column-fields-menu.tsx',
    ]) {
      expect(ui(file), `${file} must inherit the floor, not restate it`).not.toMatch(
        /z-50|zIndex:\s*50/,
      )
    }
  })

  it('the floor itself is still where the rule says it is', () => {
    // The control. Without this, deleting the floor would make every assertion above pass.
    expect(ui('app-popover.tsx')).toMatch(/'z-50'/)
  })
})
