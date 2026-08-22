import { useEffect, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

export type PointerToolAction = {
  id: string
  label: string
  accent: string
  onSelect: () => void
}

type PointerToolPaletteProps = {
  x: number
  y: number
  label: string
  actions: PointerToolAction[]
  onClose: () => void
}

const PALETTE_RADIUS = 82
const PALETTE_MARGIN = 118

export function PointerToolPalette({
  x,
  y,
  label,
  actions,
  onClose,
}: PointerToolPaletteProps) {
  const centerX = Math.min(Math.max(x, PALETTE_MARGIN), window.innerWidth - PALETTE_MARGIN)
  const centerY = Math.min(Math.max(y, PALETTE_MARGIN), window.innerHeight - PALETTE_MARGIN)

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return createPortal(
    <div
      className="pointer-tool-palette__backdrop"
      onPointerDown={onClose}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        className="pointer-tool-palette"
        role="menu"
        aria-label={label}
        style={{ left: centerX, top: centerY }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="pointer-tool-palette__label">{label}</span>
        {actions.map((action, index) => {
          const angle = -Math.PI / 2 + (Math.PI * 2 * index / actions.length)
          const actionStyle = {
            left: `calc(50% + ${Math.cos(angle) * PALETTE_RADIUS}px)`,
            top: `calc(50% + ${Math.sin(angle) * PALETTE_RADIUS}px)`,
            '--pointer-tool-accent': action.accent,
          } as CSSProperties

          return (
            <button
              className="pointer-tool-palette__action"
              type="button"
              role="menuitem"
              key={action.id}
              style={actionStyle}
              onClick={action.onSelect}
            >
              {action.label}
            </button>
          )
        })}
        <button
          className="pointer-tool-palette__close"
          type="button"
          aria-label="Close pointer tools"
          onClick={onClose}
        >
          ×
        </button>
      </div>
    </div>,
    document.body,
  )
}
