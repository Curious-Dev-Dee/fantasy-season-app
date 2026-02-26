import PocketBase from 'https://cdn.jsdelivr.net/gh/pocketbase/js-sdk@master/dist/pocketbase.es.mjs';

export const pb = new PocketBase('https://max-ocean-wifi-bedrooms.trycloudflare.com');

// FIX: Prevent the SDK from automatically cancelling "long" requests
pb.autoCancellation(false);