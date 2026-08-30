import { createContext } from 'react'

/** Presentation targets only. Editors retain ownership of capture and saving. */
export const LabWorkbenchChromeContext = createContext<{
  saveTarget: HTMLElement | null
  fileTarget: HTMLElement | null
  readOnly: boolean
} | null>(null)
