import { signedInEmail, type AccessData } from './boardAccess'
import { fileJson } from '../assetFiles'

/** Identity comes only from the verified Access middleware, never a client header. */
export const onRequestGet: PagesFunction<unknown, string, AccessData> = ({ data }) => {
  const email = signedInEmail(data)
  return email ? fileJson({ email }) : fileJson({ error: 'Private sign-in required.' }, 403)
}
