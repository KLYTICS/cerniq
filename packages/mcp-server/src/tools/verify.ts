import type { Cerniq } from '@cerniq/sdk';

import type { ToolDefinition } from './registry.js';

export function registerVerifyTool(cerniq: Cerniq, registry: Map<string, ToolDefinition>): void {
  registry.set('cerniq.verify', {
    name: 'cerniq.verify',
    description:
      'Verify an CERNIQ agent token against the agent identity, policy, and trust score. Returns ' +
      'an APPROVED or DENIED decision with denial reason. Mirrors POST /v1/verify.',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'CERNIQ-issued agent token (compact JWT).' },
        action: {
          type: 'string',
          description: 'Action being attempted, e.g. "commerce.purchase".',
        },
        merchant_domain: {
          type: 'string',
          description: 'Optional merchant domain for scope match.',
        },
        amount: { type: 'number', description: 'Optional requested amount.' },
        currency: { type: 'string', description: 'ISO 4217 currency, e.g. "USD".' },
      },
      required: ['token'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const token = typeof args.token === 'string' ? args.token : '';
      return await cerniq.verify(token, {
        action: typeof args.action === 'string' ? args.action : undefined,
        merchantDomain: typeof args.merchant_domain === 'string' ? args.merchant_domain : undefined,
        amount: typeof args.amount === 'number' ? args.amount : undefined,
        currency: typeof args.currency === 'string' ? args.currency : undefined,
      });
    },
  });
}
