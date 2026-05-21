// Static command set for the Cmd-K palette and keyboard-chord router.
// Kept as a plain module so both the palette and the chord handler share
// one source of truth.

export interface Command {
  id: string;
  title: string;
  hint?: string;
  href: string;
  /** Two-key chord, e.g. ['g', 'a']. Lowercase. */
  chord?: [string, string];
  /** Tokens used for substring search (lowercased). */
  keywords?: string[];
  external?: boolean;
}

export const COMMANDS: readonly Command[] = [
  {
    id: 'go-overview',
    title: 'Go to Overview',
    href: '/',
    chord: ['g', 'o'],
    keywords: ['home', 'dashboard', 'metrics'],
    hint: 'g o',
  },
  {
    id: 'go-agents',
    title: 'Go to Agents',
    href: '/agents',
    chord: ['g', 'a'],
    keywords: ['identity', 'register', 'list'],
    hint: 'g a',
  },
  {
    id: 'go-policies',
    title: 'Go to Policies',
    href: '/policies',
    chord: ['g', 'p'],
    keywords: ['scope', 'permissions', 'jwt'],
    hint: 'g p',
  },
  {
    id: 'go-mcp',
    title: 'Go to MCP servers',
    href: '/mcp-servers',
    chord: ['g', 'm'],
    keywords: ['relying party', 'tool call'],
    hint: 'g m',
  },
  {
    id: 'go-webhooks',
    title: 'Go to Webhooks',
    href: '/webhooks',
    chord: ['g', 'w'],
    keywords: ['subscriptions', 'events', 'hmac'],
    hint: 'g w',
  },
  {
    id: 'go-audit',
    title: 'Go to Audit',
    href: '/audit',
    chord: ['g', 'd'],
    keywords: ['log', 'verify', 'decisions'],
    hint: 'g d',
  },
  {
    id: 'go-billing',
    title: 'Go to Billing',
    href: '/billing',
    chord: ['g', 'b'],
    keywords: ['plan', 'stripe', 'usage'],
    hint: 'g b',
  },
  {
    id: 'go-quickstart',
    title: 'Go to Quickstart',
    href: '/quickstart',
    chord: ['g', 'q'],
    keywords: ['onboarding', 'first run', 'getting started', 'install'],
    hint: 'g q',
  },
  {
    id: 'register-agent',
    title: 'New: register agent',
    href: '/agents?action=register',
    keywords: ['create', 'identity', 'new', 'add'],
    hint: 'shortcut: g a · then “+”',
  },
  {
    id: 'subscribe-webhook',
    title: 'New: subscribe webhook',
    href: '/webhooks?action=subscribe',
    keywords: ['create', 'subscription', 'new', 'add'],
  },
  {
    id: 'open-api-docs',
    title: 'Open API docs (OpenAPI / Swagger)',
    href: '/v1/docs',
    keywords: ['swagger', 'openapi', 'reference'],
    external: true,
  },
];

interface ScoredCommand {
  cmd: Command;
  score: number;
  /** Indices in title that matched, used for highlighting. */
  matchSpans: [number, number][];
}

/**
 * Score commands against a search query. Higher is better.
 * Strategy:
 *   - empty query → preserve insertion order
 *   - title prefix match → +1000
 *   - title contains → +500 (with span)
 *   - keyword contains → +200
 *   - subsequence match → +50
 */
export function searchCommands(query: string): ScoredCommand[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    return COMMANDS.map((cmd) => ({ cmd, score: 1, matchSpans: [] }));
  }

  const results: ScoredCommand[] = [];
  for (const cmd of COMMANDS) {
    const title = cmd.title.toLowerCase();
    let score = 0;
    const spans: [number, number][] = [];

    if (title.startsWith(q)) {
      score += 1_000;
      spans.push([0, q.length]);
    } else {
      const idx = title.indexOf(q);
      if (idx >= 0) {
        score += 500;
        spans.push([idx, idx + q.length]);
      }
    }

    if (cmd.keywords) {
      for (const kw of cmd.keywords) {
        if (kw.includes(q)) {
          score += 200;
          break;
        }
      }
    }

    if (score === 0) {
      // Subsequence (each char in q appears in title in order).
      let ti = 0;
      let matched = 0;
      for (const ch of q) {
        const idx = title.indexOf(ch, ti);
        if (idx < 0) {
          matched = 0;
          break;
        }
        matched += 1;
        ti = idx + 1;
      }
      if (matched === q.length) score += 50;
    }

    if (score > 0) results.push({ cmd, score, matchSpans: spans });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
