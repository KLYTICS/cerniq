// Fastify integration. Two surfaces:
//
//   1. `attachCerniqGuard(fastify, opts)` — wires a preHandler hook on the
//      passed instance. Use this from your bootstrap code; it bypasses
//      Fastify's plugin encapsulation, so the hook applies to every route
//      registered on that instance.
//
//   2. `cerniqFastifyPlugin` — a plain async plugin you can pass to
//      `fastify.register`. We don't depend on `fastify-plugin`; that means
//      registering at the root scope works as expected, but if you nest the
//      plugin inside `register(...)` you must wrap it with `fastify-plugin`
//      yourself to break encapsulation. For most users `attachCerniqGuard`
//      is the simpler path and works without that footgun.

import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import type { VerifyContext, VerifyOptions, VerifyOutcomeSuccess } from '../types.js';
import type { CerniqVerifier } from '../verifier.js';

const DEFAULT_HEADER = 'x-cerniq-token';

export interface FastifyGuardOptions {
  verifier: CerniqVerifier;
  headerName?: string;
  attachTo?: string;
  requiredScope?: string;
  contextFrom?: (req: FastifyRequest) => VerifyContext;
  onDenied?: (reply: FastifyReply, reason: string, detail?: string) => Promise<unknown> | unknown;
}

function buildHandler(opts: FastifyGuardOptions) {
  const headerName = (opts.headerName ?? DEFAULT_HEADER).toLowerCase();
  const attachTo = opts.attachTo ?? 'cerniq';

  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const raw = req.headers[headerName];
    const token = Array.isArray(raw) ? raw[0] : raw;
    if (!token) {
      await sendDenied(reply, 'INVALID_SIGNATURE', 'missing token', opts);
      return;
    }
    const ctx: VerifyContext = opts.contextFrom ? opts.contextFrom(req) : {};
    const verifyOpts: VerifyOptions = opts.requiredScope
      ? { requiredScope: opts.requiredScope }
      : {};
    const outcome = await opts.verifier.verify(token, ctx, verifyOpts);
    if (!outcome.valid) {
      await sendDenied(reply, outcome.reason, outcome.detail, opts);
      return;
    }
    // type-rationale: Fastify's request typings are extended via module
    // augmentation by user code; we permit a dynamic attach name here.
    (req as unknown as Record<string, VerifyOutcomeSuccess>)[attachTo] = outcome;
  };
}

/**
 * Attach the CERNIQ preHandler to a Fastify instance. Use this in your
 * bootstrap; it does not introduce a sub-scope so the hook applies to every
 * route registered on `fastify`.
 */
export function attachCerniqGuard(fastify: FastifyInstance, opts: FastifyGuardOptions): void {
  if (!opts?.verifier) {
    throw new TypeError('attachCerniqGuard: options.verifier is required');
  }
  fastify.addHook('preHandler', buildHandler(opts));
}

/**
 * Plain plugin for `fastify.register`. Note that Fastify's encapsulation
 * means the hook only applies inside the plugin's scope unless you wrap it
 * with `fastify-plugin`. For most users `attachCerniqGuard` is simpler.
 */
export const cerniqFastifyPlugin: FastifyPluginAsync<FastifyGuardOptions> = async (
  fastify: FastifyInstance,
  opts: FastifyGuardOptions,
) => {
  if (!opts?.verifier) {
    throw new TypeError('cerniqFastifyPlugin: options.verifier is required');
  }
  fastify.addHook('preHandler', buildHandler(opts));
};

async function sendDenied(
  reply: FastifyReply,
  reason: string,
  detail: string | undefined,
  opts: FastifyGuardOptions,
): Promise<void> {
  if (opts.onDenied) {
    await opts.onDenied(reply, reason, detail);
    return;
  }
  await reply
    .code(401)
    .send({ error: 'CERNIQ_VERIFICATION_FAILED', reason, ...(detail ? { detail } : {}) });
}

export const fastifyPlugin = cerniqFastifyPlugin;
