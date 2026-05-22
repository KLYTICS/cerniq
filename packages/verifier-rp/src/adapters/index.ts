// Re-export of all adapter middleware. End users typically import from the
// runtime-specific subpath instead (e.g. `@okoro/verifier-rp/express`).

export { okoroGuard, expressMiddleware } from './express.js';
export type { ExpressGuardOptions } from './express.js';

export { okoroFastifyPlugin, attachOkoroGuard, fastifyPlugin } from './fastify.js';
export type { FastifyGuardOptions } from './fastify.js';

export { okoroHonoMiddleware, honoMiddleware } from './hono.js';
export type { HonoGuardOptions } from './hono.js';
