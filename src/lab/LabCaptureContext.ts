import { createContext } from 'react'
import type { LabCapture } from './labTypes'

/** An explicit save destination, available only inside the Lab workspace. */
export const LabCaptureContext = createContext<((capture: LabCapture) => Promise<string>) | null>(null)
