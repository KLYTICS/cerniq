// AEGIS Relying-Party Compliance Dashboard — runnable demo.
//
// The "audit our audit" proof. This is what a relying party can deploy
// to independently verify AEGIS's audit chain in real time, with NO
// AEGIS-side cooperation beyond the public discovery endpoints.
//
// Flow:
//   1. Operator boots: AEGIS_API_BASE=https://api.aegislabs.io \
//                       VERIFY_API_KEY=<verify-only key> \
//                       PORT=8080 \
//                       pnpm start
//   2. Server polls GET /.well-known/audit-signing-key (JWKS) on a
//      slow cache (1h SWR — public key rotation is the only churn).
//   3. Server polls GET /v1/audit/events?principalId=<rp>&order=asc
//      on a fast cache (30s — new events arrive continuously).
//   4. For each poll, verifyChain() walks the events offline using
//      ONLY the public JWKS and the canonicalize/prevHash construction
//      that @aegis/audit-verifier implements independently of AEGIS.
//   5. GET /  → renders the latest report as HTML.
//      GET /api/report → returns the structured JSON ChainReport
//                        (for programmatic consumers / CI integration).
//
// Why this demo matters:
//   docs/SECURITY.md § "Audit chain integrity" promises that any third
//   party can independently audit the chain. This server is that
//   promise made real. A customer can fork this in 30s and have a live
//   compliance dashboard. No AEGIS-side trust required beyond the
//   published Ed25519 audit signing key — and that key's identity is
//   verifiable against the JWKS thumbprint published in the docs site.

import { setTimeout as sleep } from 'node:timers/promises';
import express from 'express';
import {
  verifyChain,
  parseAuditNdjson,
  validateJwks,
  type AuditEventRow,
  type ChainReport,
  type JwksDocument,
} from '@aegis/audit-verifier';

const API_BASE = (process.env.AEGIS_API_BASE ?? '').replace(/\/$/, '');
const VERIFY_API_KEY = process.env.VERIFY_API_KEY ?? '';
const PRINCIPAL_FILTER = process.env.PRINCIPAL_FILTER ?? ''; // optional scope
const PORT = Number(process.env.PORT ?? 8080);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 30_000);
const MAX_EVENTS = Number(process.env.MAX_EVENTS ?? 1000);

if (!API_BASE) {
  console.error(
    'AEGIS_API_BASE is required. Example:\n' +
      '  AEGIS_API_BASE=https://api.aegislabs.io \\\n' +
      '  VERIFY_API_KEY=ak_verify_... pnpm start',
  );
  process.exit(2);
}

interface State {
  startedAt: string;
  lastPollAt: string | null;
  lastReport: ChainReport | null;
  lastError: { at: string; message: string } | null;
  jwksLoadedAt: string | null;
  jwksKidCount: number;
}

const state: State = {
  startedAt: new Date().toISOString(),
  lastPollAt: null,
  lastReport: null,
  lastError: null,
  jwksLoadedAt: null,
  jwksKidCount: 0,
};

let jwksCache: { doc: JwksDocument; loadedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000; // 1h — public-key rotation is rare

async function fetchJwks(): Promise<JwksDocument> {
  if (jwksCache && Date.now() - jwksCache.loadedAt < JWKS_TTL_MS) {
    return jwksCache.doc;
  }
  const res = await fetch(`${API_BASE}/.well-known/audit-signing-key`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`JWKS fetch ${res.status} ${res.statusText}`);
  }
  const raw = (await res.json()) as unknown;
  const doc = validateJwks(raw, `${API_BASE}/.well-known/audit-signing-key`);
  jwksCache = { doc, loadedAt: Date.now() };
  state.jwksLoadedAt = new Date().toISOString();
  state.jwksKidCount = doc.keys.length;
  return doc;
}

async function fetchEvents(): Promise<AuditEventRow[]> {
  // The audit export endpoint returns NDJSON — one row per line, in
  // chronological order. We accept both `application/x-ndjson` and a
  // JSON `{events: [...]}` shape so this demo works against staging
  // even if the export endpoint hasn't been finalised.
  const url = new URL(`${API_BASE}/v1/audit/events`);
  url.searchParams.set('order', 'asc');
  url.searchParams.set('limit', String(MAX_EVENTS));
  if (PRINCIPAL_FILTER) url.searchParams.set('principalId', PRINCIPAL_FILTER);

  const res = await fetch(url, {
    headers: {
      Accept: 'application/x-ndjson, application/json',
      ...(VERIFY_API_KEY ? { 'X-AEGIS-Verify-Key': VERIFY_API_KEY } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`audit events fetch ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('ndjson')) {
    return parseAuditNdjson(await res.text());
  }
  const body = (await res.json()) as { events?: AuditEventRow[] };
  return body.events ?? [];
}

async function pollOnce(): Promise<void> {
  const startedAt = Date.now();
  try {
    const jwks = await fetchJwks();
    const events = await fetchEvents();
    const report = await verifyChain(events, { jwks, failFast: false, maxRowDetail: 25 });
    state.lastReport = report;
    state.lastError = null;
    state.lastPollAt = new Date(startedAt).toISOString();
    if (!report.valid) {
      // Emit a structured log entry for any external alerting pipeline.
      console.warn(
        '[CHAIN-BREAK]',
        JSON.stringify({
          checkedAt: state.lastPollAt,
          totalRows: report.totalRows,
          firstBreakIndex: report.firstBreak?.index ?? null,
          firstBreakEventId: report.firstBreak?.eventId ?? null,
          firstBreakReason: report.firstBreak?.reason ?? null,
        }),
      );
    }
  } catch (err) {
    state.lastError = {
      at: new Date().toISOString(),
      message: err instanceof Error ? err.message : String(err),
    };
    console.error('[POLL-ERROR]', state.lastError.message);
  }
}

async function pollLoop(): Promise<void> {
  // Stagger first run so the HTTP listener is up before the first fetch.
  await sleep(250);
  while (true) {
    await pollOnce();
    await sleep(POLL_INTERVAL_MS);
  }
}

// ── HTTP server ──────────────────────────────────────────────────────

const app = express();

app.get('/api/report', (_req, res) => {
  res.json({
    apiBase: API_BASE,
    startedAt: state.startedAt,
    lastPollAt: state.lastPollAt,
    jwksLoadedAt: state.jwksLoadedAt,
    jwksKidCount: state.jwksKidCount,
    lastError: state.lastError,
    report: state.lastReport,
  });
});

app.get('/health', (_req, res) => {
  // Returns 200 iff: we've polled at least once AND the most recent
  // result wasn't a chain break. Useful as a Kubernetes liveness/
  // readiness probe for the dashboard itself (NOT for AEGIS).
  if (!state.lastReport) {
    res.status(503).json({ ok: false, reason: 'no-poll-yet' });
    return;
  }
  if (!state.lastReport.valid) {
    res.status(503).json({ ok: false, reason: 'chain-break', report: state.lastReport });
    return;
  }
  res.json({ ok: true, totalRows: state.lastReport.totalRows });
});

app.get('/', (_req, res) => {
  const r = state.lastReport;
  const statusBadge = !r
    ? '<span class="badge pending">Pending first poll…</span>'
    : r.valid
      ? `<span class="badge ok">Chain intact · ${r.totalRows.toLocaleString()} events</span>`
      : `<span class="badge broken">CHAIN BREAK at index ${r.firstBreak?.index ?? '?'} · ${escapeHtml(r.firstBreak?.reason ?? '?')}</span>`;

  const errorPanel = state.lastError
    ? `<div class="error">Last error (${state.lastError.at}): ${escapeHtml(state.lastError.message)}</div>`
    : '';

  const rowDetail = r?.rows
    ? r.rows
        .slice(0, 25)
        .map(
          (row) =>
            `<tr><td>${escapeHtml(row.eventId)}</td><td>${row.signatureValid ? '✓' : '✗'}</td><td>${row.chainLinkValid ? '✓' : '✗'}</td><td>${escapeHtml(row.reason ?? '')}</td></tr>`,
        )
        .join('\n')
    : '';

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>AEGIS Compliance — ${escapeHtml(API_BASE)}</title>
  <meta http-equiv="refresh" content="30" />
  <style>
    :root { --bg:#0b0d10; --fg:#eaeaea; --ok:#3ddc97; --warn:#ffb454; --bad:#ff5d6c; --muted:#6c757d; --accent:#5ecde6; }
    body { background:var(--bg); color:var(--fg); font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; margin:0; padding:32px; }
    h1 { font-weight:600; font-size:18px; margin:0 0 6px; }
    .sub { color:var(--muted); font-size:12px; margin-bottom:24px; }
    .badge { display:inline-block; padding:8px 14px; border-radius:6px; font-weight:600; }
    .ok { background:rgba(61,220,151,0.16); color:var(--ok); border:1px solid var(--ok); }
    .broken { background:rgba(255,93,108,0.16); color:var(--bad); border:1px solid var(--bad); }
    .pending { background:rgba(255,180,84,0.16); color:var(--warn); border:1px solid var(--warn); }
    .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin:28px 0; }
    .card { background:#11161b; border:1px solid #1d242c; border-radius:6px; padding:14px 16px; }
    .card .k { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:0.06em; }
    .card .v { font-size:22px; font-weight:600; margin-top:6px; color:var(--accent); }
    table { width:100%; border-collapse:collapse; margin-top:12px; }
    th,td { text-align:left; padding:6px 10px; border-bottom:1px solid #1d242c; font-size:12px; }
    th { color:var(--muted); font-weight:600; }
    .error { background:rgba(255,93,108,0.08); color:var(--bad); padding:10px 14px; border-radius:6px; margin:16px 0; font-size:12px; }
    a { color:var(--accent); }
    .footer { margin-top:32px; color:var(--muted); font-size:11px; }
  </style>
</head>
<body>
  <h1>AEGIS Audit-Chain Compliance Dashboard</h1>
  <div class="sub">Independent verification — runs offline using only the public JWKS. No AEGIS-side trust required. Source: <a href="${escapeHtml(API_BASE)}">${escapeHtml(API_BASE)}</a></div>

  ${statusBadge}
  ${errorPanel}

  <div class="grid">
    <div class="card"><div class="k">Total events scanned</div><div class="v">${r ? r.totalRows.toLocaleString() : '—'}</div></div>
    <div class="card"><div class="k">Verify duration</div><div class="v">${r ? r.durationMs + 'ms' : '—'}</div></div>
    <div class="card"><div class="k">JWKS keys in scope</div><div class="v">${state.jwksKidCount || '—'}</div></div>
    <div class="card"><div class="k">Last poll</div><div class="v" style="font-size:13px;">${escapeHtml(state.lastPollAt ?? 'pending')}</div></div>
  </div>

  ${rowDetail ? `<h2 style="font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;margin-top:32px;">Recent events</h2><table><tr><th>Event id</th><th>Signature</th><th>Chain link</th><th>Notes</th></tr>${rowDetail}</table>` : ''}

  <div class="footer">
    Auto-refreshes every 30s · JSON: <a href="/api/report">/api/report</a> · Health: <a href="/health">/health</a><br>
    Dashboard process running since ${escapeHtml(state.startedAt)}. Polling every ${POLL_INTERVAL_MS / 1000}s.
  </div>
</body>
</html>`);
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

app.listen(PORT, () => {
  console.log(`[startup] AEGIS RP compliance dashboard listening on :${PORT}`);
  console.log(`[startup] polling ${API_BASE} every ${POLL_INTERVAL_MS / 1000}s`);
  if (PRINCIPAL_FILTER) console.log(`[startup] scoped to principalId=${PRINCIPAL_FILTER}`);
  void pollLoop();
});
