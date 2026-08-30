import { createContext } from 'react'

/** Only an existing, editable cloud board may own newly uploaded graph images. */
export const ImageStorageContext = createContext<string | null>(null)
