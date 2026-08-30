import { useEffect, useRef, type ReactNode } from 'react'

/** Native disclosure with outside-click and Escape dismissal, not an ARIA menu. */
export function LabMenu({ label, children, className = '' }: { label: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const menu = ref.current
    const outside = (event: PointerEvent) => {
      if (event.target instanceof window.Node && !ref.current?.contains(event.target) && ref.current) ref.current.open = false
    }
    // Portalled editor actions have different React ancestry, but still bubble
    // through this DOM disclosure. Listen here instead of on the React panel.
    const action = (event: MouseEvent) => {
      if (event.target instanceof window.Element && event.target.closest('button') && menu) menu.open = false
    }
    document.addEventListener('pointerdown', outside)
    menu?.addEventListener('click', action)
    return () => { document.removeEventListener('pointerdown', outside); menu?.removeEventListener('click', action) }
  }, [])
  return <details className={`lab-menu ${className}`} ref={ref} onKeyDown={(event) => {
    if (event.key === 'Escape' && ref.current?.open) {
      event.preventDefault(); ref.current.open = false; ref.current.querySelector('summary')?.focus()
    }
  }}>
    <summary>{label}</summary>
    <div className="lab-menu__panel">{children}</div>
  </details>
}
