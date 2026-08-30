/** These two HTTPS hosts serve the same OSA deployment and private file store. */
export const OSA_ORIGIN = 'https://osa.juliaaurorahart.com'
export const LAB_ORIGIN = 'https://lab.juliaaurorahart.com'

/** An alias changes the address, never the owning board or access permissions. */
export function isSameOsaDeploymentOrigin(sourceOrigin: string, currentOrigin: string) {
  if (sourceOrigin === currentOrigin) return true
  const known = (origin: string) => origin === OSA_ORIGIN || origin === LAB_ORIGIN
  return known(sourceOrigin) && known(currentOrigin)
}
