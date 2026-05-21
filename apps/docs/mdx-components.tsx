import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';

import { DenialPrecedence } from '@/components/live/denial-precedence';
import { JwksFingerprint } from '@/components/live/jwks-fingerprint';
import { PricingTable } from '@/components/live/pricing-table';
import { SdkVersionBadges } from '@/components/live/sdk-version-badges';
import { StatusBadge } from '@/components/live/status-badge';
import { TrustBandLegend } from '@/components/live/trust-band-legend';
import { WebhookEventCatalog } from '@/components/live/webhook-event-catalog';
import { RunnableExample } from '@/components/runnable-example';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    DenialPrecedence,
    JwksFingerprint,
    PricingTable,
    RunnableExample,
    SdkVersionBadges,
    StatusBadge,
    TrustBandLegend,
    WebhookEventCatalog,
    ...components,
  };
}
