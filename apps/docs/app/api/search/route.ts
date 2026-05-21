// Orama-backed full-text search over the MDX content tree. No vendor
// dependency (no Algolia, no DocSearch, no third-party indexer). Fumadocs
// RootProvider auto-detects this route — the search UI in the top bar
// queries here without explicit wiring.
import { createFromSource } from 'fumadocs-core/search/server';

import { source } from '@/lib/source';

export const { GET } = createFromSource(source);
