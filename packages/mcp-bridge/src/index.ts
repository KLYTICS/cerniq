// `@aegis/mcp-bridge` — verification middleware for MCP servers.
//
// **Why this package exists:**
// MCP (Model Context Protocol) is the universal tool-call protocol for
// LLMs in 2026. Every Claude / GPT / Gemini agent that calls a tool
// goes through MCP. None of those tool calls today carry a verified
// agent identity — relying parties (databases, APIs, financial systems)
// have no way to know whether a tool call is from a trusted agent or a
// jailbroken / compromised one.
//
// `@aegis/mcp-bridge` wraps any MCP server transport with AEGIS
// verification. The result: every tool call carries an AEGIS-signed
// token, the MCP server verifies the token before executing the tool,
// and policy enforcement (spend limits, scope restrictions, trust band)
// applies at the tool-call level.
//
// **Distribution wedge** (per docs/standards/0001-mcp-bridge-positioning.md):
// Every MCP server in the wild becomes a potential AEGIS customer with
// one `import` and one `wrap()` call.
//
// **Status**: skeleton. The bridge interface is finalized; the
// MCP-SDK-version-specific glue is wired stub-shaped pending the 1.0
// MCP transport API.

import type { Aegis, VerifyResult as VerifyResponse } from '@aegis/sdk';
import { AEGIS_HEADER_TOKEN, type DenialReason } from '@aegis/types';

export interface BridgeConfig {
  /** AEGIS client configured with a verify-only key. */
  aegis: Aegis;
  /**
   * Required minimum trust band. Tool calls from agents below this band
   * are rejected. Defaults to `VERIFIED` (≥500). Set `'WATCH'` to also
   * accept WATCH-band agents (with extra scrutiny).
   */
  minTrustBand?: 'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED';
  /**
   * Action prefix for the MCP server, e.g. `'mcp.fs.'`. For `tools/call`,
   * the prefix is concatenated with the MCP tool name to form the AEGIS
   * `action` claim — e.g. `mcp.fs.read_file`. Other MCP methods fall back
   * to the method name, such as `mcp.fs.resources/read`.
   */
  actionPrefix: string;
  /**
   * Called when verification denies a tool call. Default: throw a
   * structured `BridgeDenialError`.
   */
  onDenial?: (reason: DenialReason, ctx: BridgeContext) => never | Promise<never>;
}

export interface BridgeContext {
  /** The MCP method name being invoked (e.g. `tools/call`, `resources/read`). */
  method: string;
  /** The tool / resource identifier. */
  target: string;
  /** Arguments the LLM is calling with. */
  args: unknown;
  /**
   * Request headers extracted from the transport.
   *
   * **Contract**: keys are guaranteed lowercased. Look up headers as
   * `ctx.headers['x-aegis-token']`, not `ctx.headers['X-AEGIS-Token']`.
   * HTTP header names are case-insensitive (RFC 9110 §5.1) and MCP
   * transports vary (stdio, SSE, WebSocket) in the case they deliver;
   * normalizing to lowercase here means consumers don't have to repeat
   * the dance. Non-string header values are dropped on the way in.
   */
  headers: Record<string, string>;
}

export class BridgeDenialError extends Error {
  constructor(
    public readonly reason: DenialReason,
    public readonly verifyResponse: VerifyResponse,
  ) {
    super(`AEGIS denied tool call: ${reason}`);
    this.name = 'BridgeDenialError';
  }
}

/**
 * Wrap an MCP server's `handle` function with AEGIS verification.
 *
 * The wrapped function inspects every incoming MCP request for the
 * `X-AEGIS-Token` header (or `aegis_token` arg in the JSON-RPC params),
 * verifies it against the AEGIS API, and only invokes the underlying
 * handler if the verification passes.
 *
 * Typical usage:
 *
 * ```ts
 * import { Server } from '@modelcontextprotocol/sdk/server/index.js';
 * import { wrapMcpHandler } from '@aegis/mcp-bridge';
 * import { Aegis } from '@aegis/sdk';
 *
 * const aegis = new Aegis({ verifyKey: process.env.AEGIS_VERIFY_KEY });
 * const server = new Server({ name: 'my-mcp-server', version: '1.0.0' });
 *
 * server.setRequestHandler(myToolSchema, wrapMcpHandler({
 *   aegis,
 *   actionPrefix: 'mcp.fs.',
 *   minTrustBand: 'VERIFIED',
 * }, async (req, ctx) => {
 *   // ctx.aegisVerify carries trust score, scope, principal — use it.
 *   return await readFile(req.params.path);
 * }));
 * ```
 */
export function wrapMcpHandler<TReq extends McpRequest, TRes>(
  config: BridgeConfig,
  handler: (req: TReq, ctx: BridgeContextWithVerification) => Promise<TRes>,
): (req: TReq) => Promise<TRes> {
  const minBand = config.minTrustBand ?? 'VERIFIED';
  return async (req: TReq) => {
    const rawCtx: BridgeContext = {
      method: req.method,
      target: extractTarget(req),
      args: req.params,
      headers: extractHeaders(req),
    };

    const token = extractToken(req, rawCtx);
    const sanitizedReq = stripBridgeParams(req);
    const ctx: BridgeContext = {
      ...rawCtx,
      args: sanitizedReq.params,
    };

    if (!token) {
      const reason: DenialReason = 'AGENT_NOT_FOUND';
      const denial = denialResponse(reason);
      if (config.onDenial) await config.onDenial(reason, ctx);
      throw new BridgeDenialError(reason, denial);
    }

    // SDK's VerifyResult shape doesn't carry a free-form `context` field
    // today — when the verify-call shape gains one, thread mcpMethod/mcpTarget
    // through here. For now the action string carries the discriminator.
    const result = await config.aegis.verify(token, {
      action: buildVerifyAction(config.actionPrefix, ctx),
    });

    if (!result.valid) {
      const reason: DenialReason = (result.denialReason ?? 'AGENT_NOT_FOUND') as DenialReason;
      if (config.onDenial) await config.onDenial(reason, ctx);
      throw new BridgeDenialError(reason, result);
    }

    if (!meetsTrustBar(result.trustBand, minBand)) {
      const reason: DenialReason = 'TRUST_SCORE_TOO_LOW';
      if (config.onDenial) await config.onDenial(reason, ctx);
      throw new BridgeDenialError(reason, result);
    }

    return handler(sanitizedReq, { ...ctx, aegisVerify: result });
  };
}

export interface BridgeContextWithVerification extends BridgeContext {
  aegisVerify: VerifyResponse;
}

interface McpRequest {
  method: string;
  params?: Record<string, unknown>;
}

function extractTarget(req: McpRequest): string {
  const params = req.params ?? {};
  if (typeof params['name'] === 'string') return params['name'];
  if (typeof params['uri'] === 'string') return params['uri'];
  if (typeof params['path'] === 'string') return params['path'];
  return '';
}

function extractHeaders(req: McpRequest): Record<string, string> {
  // MCP transports vary (stdio, sse, websocket). For stdio, headers are
  // smuggled in the params. For sse/ws, the transport adapter populates
  // them. This extractor handles both.
  const params = req.params ?? {};
  const headers = params['_aegis_headers'];
  if (typeof headers !== 'object' || headers === null) return {};

  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      normalized[name.toLowerCase()] = value;
    }
  }
  return normalized;
}

function extractToken(req: McpRequest, ctx: BridgeContext): string | null {
  const headerToken = ctx.headers[AEGIS_HEADER_TOKEN.toLowerCase()];
  if (headerToken) return headerToken;
  const argToken = (req.params ?? {})['_aegis_token'];
  return typeof argToken === 'string' ? argToken : null;
}

function stripBridgeParams<TReq extends McpRequest>(req: TReq): TReq {
  if (!req.params) return req;

  const params = Object.fromEntries(
    Object.entries(req.params).filter(([key]) => key !== '_aegis_token' && key !== '_aegis_headers'),
  );
  if (Object.keys(params).length === Object.keys(req.params).length) return req;

  return { ...req, params } as TReq;
}

/**
 * MCP methods that scope to a specific named target. For these, the
 * action claim is constructed per-target so policies can grant
 * per-tool, per-resource, or per-prompt access — denying everything
 * else behind the same JSON-RPC method.
 *
 * `tools/call` uses a flat target namespace (`${prefix}${target}`)
 * because tool names are unique within an MCP server (MCP spec §3.2):
 * a policy on `mcp.fs.read_file` cannot accidentally match a resource
 * URI that happens to spell `read_file`.
 *
 * `resources/*` and `prompts/get` namespace the target under the
 * method (`${prefix}${method}.${target}`) because resource URIs and
 * prompt names live in separate, attacker-influenced namespaces — a
 * resource URI of `read_file` must NOT match a tool-scoped policy.
 *
 * List methods (`tools/list`, `resources/list`, `prompts/list`) have
 * no target and fall back to `${prefix}${method}`.
 */
function buildVerifyAction(prefix: string, ctx: BridgeContext): string {
  if (ctx.target) {
    if (ctx.method === 'tools/call') {
      return `${prefix}${ctx.target}`;
    }
    if (
      ctx.method === 'resources/read' ||
      ctx.method === 'resources/subscribe' ||
      ctx.method === 'resources/unsubscribe' ||
      ctx.method === 'prompts/get'
    ) {
      return `${prefix}${ctx.method}.${ctx.target}`;
    }
  }
  return `${prefix}${ctx.method}`;
}

const BAND_ORDER: Record<NonNullable<BridgeConfig['minTrustBand']>, number> = {
  FLAGGED: 0,
  WATCH: 1,
  VERIFIED: 2,
  PLATINUM: 3,
};

function meetsTrustBar(
  actual: VerifyResponse['trustBand'],
  min: NonNullable<BridgeConfig['minTrustBand']>,
): boolean {
  if (!actual) return false;
  return (BAND_ORDER[actual] ?? -1) >= BAND_ORDER[min];
}

function denialResponse(reason: DenialReason): VerifyResponse {
  return {
    valid: false,
    agentId: null,
    principalId: null,
    trustScore: 0,
    trustBand: null,
    scopesGranted: [],
    denialReason: reason,
    verifiedAt: new Date().toISOString(),
    ttl: 0,
  };
}
