// Public surface of @aegis/types — re-exports schemas and inferred types so
// consumers can import from a single entry point.
//
// Stability: every schema in `./schemas` is part of the public AEGIS API
// contract. Breaking changes require a coordinated SDK version bump and a
// `BREAKING` entry in CHANGELOG.

export * from './schemas.js';
export * from './constants.js';
export * from './errors.js';
export * from './error-catalog.js';
export * from './webhooks.js';
