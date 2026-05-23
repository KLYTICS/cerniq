// Re-export of all adapter middleware. End users typically import from the
// runtime-specific subpath instead (e.g. `@cerniq/verifier-rp/express`).

export { cerniqGuard, expressMiddleware } from './express.js';
export type { ExpressGuardOptions } from './express.js';

export { cerniqFastifyPlugin, attachCerniqGuard, fastifyPlugin } from './fastify.js';
export type { FastifyGuardOptions } from './fastify.js';

export { cerniqHonoMiddleware, honoMiddleware } from './hono.js';
export type { HonoGuardOptions } from './hono.js';
