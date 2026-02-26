// pb.js
import PocketBase from 'https://cdn.jsdelivr.net/gh/pocketbase/js-sdk@master/dist/pocketbase.es.mjs';

// Use the Cloudflare Tunnel URL from your PowerShell window
export const pb = new PocketBase('https://max-ocean-wifi-bedrooms.trycloudflare.com');