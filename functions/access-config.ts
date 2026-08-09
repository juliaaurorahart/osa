/**
 * These values come from the Cloudflare Zero Trust Access application which
 * protects osa.juliaaurorahart.com. They are public identifiers, not secrets.
 * Until they are replaced, every database request is deliberately denied.
 */
export const accessConfig = {
  domain: 'https://YOUR-TEAM.cloudflareaccess.com',
  aud: 'YOUR-ACCESS-APPLICATION-AUDIENCE',
}
