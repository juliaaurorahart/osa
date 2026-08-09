import cloudflareAccessPlugin from '@cloudflare/pages-plugin-cloudflare-access'
import { accessConfig } from '../access-config'

// Invalid or missing identities are rejected before requests reach the board API.
export const onRequest = cloudflareAccessPlugin(accessConfig)
