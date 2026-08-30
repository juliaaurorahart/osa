import { useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { LabWorkbenchChromeContext } from './LabWorkbenchChromeContext'

/** Standalone tools keep their controls; Lab tools share the File disclosure. */
export function LabFileActions({ children }: { children: ReactNode }) {
  const chrome = useContext(LabWorkbenchChromeContext)
  return chrome?.fileTarget ? createPortal(<div className="lab-menu__file-actions" inert={chrome.readOnly || undefined}>{children}</div>, chrome.fileTarget) : children
}
