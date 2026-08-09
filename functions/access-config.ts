/**
 * These values come from the Cloudflare Zero Trust Access application which
 * protects osa.juliaaurorahart.com. They are public identifiers, not secrets.
 * Until they are replaced, every database request is deliberately denied.
 */
export const accessConfig = {
  domain: 'https://winter-bush-800e.cloudflareaccess.com',
  aud: '8f84943dec23e364c7345e94644dc4ca39332532272399ee8bb7ada77115621b',
}
