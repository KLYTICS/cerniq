// Browser-safe entry point. Identical surface; @noble/ed25519 already runs
// in the browser, so this re-export exists primarily so bundlers can pick a
// browser-targeted bundle when present.
export * from './index.js';
