import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { CutlineDivider } from './cutline-divider'

describe('CutlineDivider', () => {
  it('announces itself as a named separator, not just a coloured line', () => {
    // A red rule means nothing to a screen reader, and nothing at all to someone reading the
    // DOM — the boundary is the information.
    render(<CutlineDivider label="Capacity cutline" />)
    expect(screen.getByRole('separator', { name: 'Capacity cutline' })).toBeTruthy()
  })

  it('shows the label as text as well', () => {
    // Colour alone would leave the meaning to be guessed.
    render(<CutlineDivider label="Capacity cutline" />)
    expect(screen.getByText('Capacity cutline')).toBeTruthy()
  })

  it('takes its copy from the caller, so shared/ui holds no feature strings', () => {
    render(<CutlineDivider label="Something else entirely" />)
    expect(screen.getByRole('separator', { name: 'Something else entirely' })).toBeTruthy()
  })
})
