// Re-export of all adapter middleware. End users typically import from the
// runtime-specific subpath instead (e.g. `@aegis/verifier-rp/express`).

export { aegisGuard, expressMiddleware } from './express.js';
export type { ExpressGuardOptions } from './express.js';

export { aegisFastifyPlugin, attachAegisGuard, fastifyPlugin } from './fastify.js';
export type { FastifyGuardOptions } from './fastify.js';

export { aegisHonoMiddleware, honoMiddleware } from './hono.js';
export type { HonoGuardOptions } from './hono.js';
