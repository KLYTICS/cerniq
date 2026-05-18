import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'AEGIS Everywhere - AI Infrastructure Operating Manual',
  description:
    'The AEGIS Everywhere operating manual for becoming the neutral verification, policy, and audit layer that integrates across the age of AI.',
};

const REPO = 'https://github.com/klytics/aegis/blob/main';

const sources = [
  ['Integration patterns', `${REPO}/docs/INTEGRATION_PATTERNS.md`],
  ['Integration roadmap', `${REPO}/docs/INTEGRATION_ROADMAP.md`],
  ['AEGIS as backbone', `${REPO}/docs/AEGIS_AS_BACKBONE.md`],
  ['MCP integration guide', `${REPO}/docs/INTEGRATION_GUIDE_MCP.md`],
  ['Fintech guide', `${REPO}/docs/INTEGRATION_GUIDE_FINTECH.md`],
  ['Execution OS', `${REPO}/docs/execution/00_OPERATING_SYSTEM.md`],
  ['Department charters', `${REPO}/docs/execution/01_DEPARTMENT_CHARTERS.md`],
  ['Agent role briefs', `${REPO}/docs/execution/02_AGENT_ROLES.md`],
  ['Launch runbook', `${REPO}/docs/LAUNCH_RUNBOOK.md`],
];

const externalSignals = [
  ['Model Context Protocol', 'https://modelcontextprotocol.io/'],
  ['OpenAI Apps SDK', 'https://developers.openai.com/apps-sdk/'],
  ['Vercel AI SDK', 'https://ai-sdk.dev/'],
  ['Stripe Agentic Commerce', 'https://docs.stripe.com/agentic-commerce'],
  ['Google Agent Payments Protocol', 'https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol'],
  ['NIST AI Agent Standards Initiative', 'https://www.nist.gov/'],
];

const architectureLayers = [
  {
    name: 'Layer A - Universal verify API',
    owner: 'Engineering + Product',
    summary:
      'One low-friction verification call that any app, agent runtime, MCP server, workflow engine, or payment surface can place before action.',
    contracts: [
      'The core question is always the same: is this agent allowed to do this action now?',
      'Adapters stay thin; identity, policy, trust, and audit semantics stay centralized.',
      'Every integration gets typed denials instead of bespoke allow/deny strings.',
      'The verify hot path remains portable and framework-neutral.',
    ],
  },
  {
    name: 'Layer B - Integration fabric',
    owner: 'Partnerships + Platform',
    summary:
      'Stripe became default infrastructure by making every payment surface feel native. AEGIS follows that pattern for agent trust.',
    contracts: [
      'Integrate where developers already work: SDKs, middleware, MCP wrappers, workflow nodes, cloud edges, and audit sinks.',
      'Each adapter maps local concepts into one AEGIS action envelope.',
      'Every integration has a runnable quickstart and one production checklist.',
      'Customers can adopt in shadow mode before enforcement.',
    ],
  },
  {
    name: 'Layer C - Evidence network',
    owner: 'Security + Compliance',
    summary:
      'The moat is not only being easy to call. It is becoming the neutral evidence trail across every consequential AI action.',
    contracts: [
      'Every approved or denied action appends signed audit evidence.',
      'Downstream systems store AEGIS audit identifiers beside their native event IDs.',
      'Evidence exports are independent of any one model, vendor, protocol, or cloud.',
      'No silent failures; failed downstream calls are visible in response and audit paths.',
    ],
  },
];

const infrastructureRows = [
  ['Agent frameworks', 'LangChain, CrewAI, AutoGen, Vercel AI SDK, custom runtimes', 'Drop-in middleware that verifies tool calls, workflow steps, and agent-issued intents.', 'Signed action envelope, min trust floor, denial mapping, auditEventId return.'],
  ['MCP servers', 'Claude Desktop, Cursor, internal MCP gateways, hosted MCP platforms', 'Wrap sensitive tools so every tool call has cryptographic identity and policy context.', '`wrap(server, { aegis })`, per-tool scopes, fail-closed tool invocation.'],
  ['Cloud and edge', 'Cloudflare Workers, Vercel, AWS, Azure, GCP, Kubernetes ingress', 'Verify close to the action boundary while keeping hot-path logic portable.', 'Edge-compatible verify algorithm, JWKS cache, shadow-mode divergence checks.'],
  ['Browsers and operators', 'Browser agents, desktop copilots, RPA, internal operator consoles', 'Gate high-impact browser actions, admin clicks, data exports, and approvals.', 'User/agent binding, domain allow-list, replay defense, audit-linked session trace.'],
  ['Enterprise SaaS', 'Salesforce, ServiceNow, Slack, Linear, GitHub, Notion, Gmail', 'Verify agent actions before they mutate customer records, tickets, code, docs, or messages.', 'Resource scopes, tenant isolation, webhook feedback, local denial translation.'],
  ['Data systems', 'Postgres, Snowflake, BigQuery, vector DBs, BI tools, data warehouses', 'Protect reads, writes, exports, embeddings, and high-risk analytical actions.', 'Data-access action shape, purpose binding, row/tenant scope, export audit evidence.'],
  ['Payments and commerce', 'Stripe, PSPs, card issuing, banking rails, marketplace payouts', 'Verify the agent leg before money movement or payment authorization occurs.', 'AEGIS first; payment rail second; shared idempotency and reconciliation keys.'],
  ['Security and IAM', 'Auth0, Clerk, WorkOS, Okta-adjacent flows, SIEMs, policy engines', 'Complement human identity with agent identity that survives model and runtime changes.', 'Principal federation, policy issuance, signed audit chain, SIEM-ready events.'],
  ['Observability and audit', 'Sentry, Datadog, OpenTelemetry, audit warehouses, evidence bundles', 'Make every consequential AI action observable, explainable, and exportable.', 'Trace IDs, auditEventId, trust-band deltas, failure events, offline verification.'],
  ['Standards and protocols', 'FAPI, RAR, JAR, MCP, ACP/AP2, OAuth, DPoP roadmap', 'Stay protocol-neutral while mapping to standards security teams already understand.', 'Implemented-vs-roadmap labels, ADRs, compatibility tests, external reference watch.'],
];

const departments = [
  ['Engineering', 'Owns SDKs, adapters, middleware, edge ports, examples, and the verify API contract.', 'Every adapter has a runnable example, typed errors, and narrow tests.'],
  ['Product', 'Owns the integration wedge, prioritization, ICP mapping, and what each ecosystem needs first.', 'Each integration has a buyer, use case, activation metric, and explicit non-goals.'],
  ['Developer Experience', 'Owns the Stripe-like feel: docs, snippets, CLI flows, copy/paste starts, and fast time-to-first-verdict.', 'A developer gets to a valid verify call in minutes, not a sales cycle.'],
  ['Security', 'Owns threat models for every integration class, denial precedence, replay defense, and abuse response.', 'No adapter bypasses central policy, identity, or audit semantics.'],
  ['Compliance', 'Owns evidence exports, retention posture, control mapping, and auditor-facing explanations.', 'Every public compliance claim maps to source docs or generated evidence.'],
  ['Finance', 'Owns commercial packaging, usage metering, plan gates, and ecosystem-level unit economics.', 'Pricing and metering match ADR-0014 until superseded by a new ADR.'],
  ['GTM', 'Owns the category narrative: neutral verification layer for AI agents everywhere.', 'Collateral sells adoption paths, not vague platform breadth.'],
  ['Customer Success', 'Owns pilot onboarding and integration-specific runbooks for first customer wins.', 'One agent, one action, one relying-party endpoint, one signed audit trail.'],
  ['SRE', 'Owns reliability, queues, webhook delivery, latency SLOs, edge divergence, and incident runbooks.', 'Every integration has readiness, alerting, rollback, and failure visibility.'],
  ['Legal', 'Owns vendor-neutral language, partner terms, regulated-market boundaries, and data-processing posture.', 'No ecosystem claim creates hidden liability or vendor dependency.'],
  ['Partnerships', 'Owns ecosystem motion with platforms, frameworks, clouds, and protocol communities.', 'Partner claims map to tested adapters and named maintainers.'],
  ['Standards', 'Owns protocol watch, implemented-vs-roadmap labels, and standards-compatible vocabulary.', 'Standards claims never outrun implemented code or explicit roadmap labels.'],
];

const agentLanes = [
  ['Architect', 'Defines the adapter pattern and decides what belongs in core versus integration-specific glue.', 'ADR, interface sketch, source map, rollback plan.'],
  ['Implementer', 'Builds SDK, middleware, route, wrapper, example, or docs inside a claimed integration lane.', 'Small diff, typecheck, runnable example, handoff.'],
  ['Reviewer', 'Checks claim accuracy, adoption friction, test coverage, source links, and public-facing language.', 'Findings first; approval only with evidence.'],
  ['Security', 'Threat-models trust boundaries and proves the integration cannot bypass identity or audit.', 'Abuse cases, controls, fail-closed tests.'],
  ['Verifier', 'Runs examples, browser QA, typecheck/build, link checks, and content consistency checks.', 'Commands, outputs, screenshots when needed, residual risk.'],
  ['Documenter', 'Turns integration truth into a quickstart, checklist, and operator manual.', 'HTML docs, snippets, source ledger, no fabricated metrics.'],
  ['Team / Swarm leader', 'Splits large ecosystem pushes into independent adapter lanes and integrates final proof.', 'Task state, ownership map, conflict log, final verification.'],
  ['Worker lane', 'Executes one bounded adapter or evidence slice without changing the global plan.', 'Changed files, tests run, blockers, recommended follow-up.'],
];

const tasks = [
  ['P0', 'Rename the doctrine', 'Product + Docs', 'Stop centering Stripe as the product mode; use Stripe as an analogy for integration ubiquity.', 'Public page, sitemap, and homepage link use AEGIS Everywhere language.'],
  ['P0', 'One universal action envelope', 'Engineering + Security', 'Document the common shape every adapter maps into: actor, action, resource, amount, domain, jti, trust floor.', 'Types and examples agree across SDK, MCP, fintech, and workflow samples.'],
  ['P0', 'MCP bridge proof', 'Engineering + DX', 'Make the one-line MCP wrapper real enough to demonstrate sensitive tool gating.', 'Example MCP server denies and allows with typed AEGIS verdicts.'],
  ['P0', 'First ecosystem quickstart', 'DX + GTM', 'Pick one wedge and make integration feel inevitable: MCP, Vercel AI SDK, LangChain, or fintech payments.', 'A new developer reaches first verdict in under 10 minutes.'],
  ['P1', 'Adapter certification matrix', 'Platform', 'Grade integrations by available, beta, planned, and blocked; name owners and proof artifacts.', 'Integration page and docs share one status model.'],
  ['P1', 'Shadow-mode adoption path', 'SRE + Security', 'Let customers run AEGIS beside existing auth before enforcement.', 'Shadow logs, divergence metrics, and go/no-go checklist.'],
  ['P1', 'Evidence bundle per ecosystem', 'Compliance', 'Create auditor-ready evidence patterns for SaaS, payments, data systems, and MCP tools.', 'Export includes audit chain, downstream IDs, policy, and verification manifest.'],
  ['P1', 'Partner motion', 'Partnerships + GTM', 'Define how platforms can ship AEGIS as a default trust toggle.', 'Partner brief, technical checklist, support model.'],
  ['P2', 'Static HTML mirror', 'Documentation', 'Optionally generate a standalone `docs/everywhere/index.html` from the same content.', 'Generated artifact diff reviewed; no divergent source of truth.'],
];

const envRows = [
  ['AEGIS_API_BASE_URL', 'All adapters', 'Canonical API host for management and verify calls.', 'Examples and docs point to the same environment variable.'],
  ['AEGIS_VERIFY_KEY', 'Relying-party services', 'Verify-scoped key for action gates; never use a management key on an edge.', 'Adapter rejects missing or management-scoped key where detectable.'],
  ['AEGIS_API_KEY', 'Management tooling', 'Agent, policy, webhook, and admin setup where full scope is required.', 'Never shipped in browser bundles or customer-side examples.'],
  ['AEGIS_DASHBOARD_API_KEY', 'Dashboard', 'Server-side dashboard API access where configured.', 'Scoped to dashboard service, not exposed client-side.'],
  ['NEXT_PUBLIC_API_BASE_URL', 'Marketing/demo pages', 'Public demo host for non-secret browser examples.', 'Only public endpoints are called from browser code.'],
  ['NEXT_PUBLIC_DASHBOARD_URL', 'Marketing', 'Routes login and conversion traffic to the dashboard.', 'Links preserve intended funnel destination.'],
  ['STRIPE_SECRET_KEY', 'Billing only', 'AEGIS revenue engine; not required for non-payment trust integrations.', 'Billing readiness reports enabled or disabled explicitly.'],
  ['STRIPE_WEBHOOK_SECRET', 'Billing only', 'Verifies Stripe webhook payloads before subscription mutation.', 'Unsigned payloads fail closed.'],
  ['STRIPE_PRICE_DEVELOPER / GROWTH / OVERAGE', 'Billing only', 'Plan pricing and metered usage for AEGIS itself.', 'Matches ADR-0014 until superseded by new ADR.'],
  ['INTEGRATION_*', 'Adapter-specific', 'Framework or partner credentials for demo adapters, never core AEGIS secrets.', 'Each adapter documents its own envs beside its example.'],
];

const metadataKeys = [
  ['aegisAuditEventId', 'Every downstream system that mutates state', 'Cross-links local action to signed AEGIS evidence.'],
  ['aegisAgentId', 'Tool calls, workflow runs, payments, data exports', 'Names the agent whose request caused the action.'],
  ['aegisPolicyId', 'Audit logs, workflow state, payment metadata', 'Names the policy that allowed or denied the action.'],
  ['aegisJti', 'Idempotency, replay defense, downstream event IDs', 'Binds one action attempt across retries and systems.'],
  ['principalId', 'Tenant-owned service records', 'Maintains multi-tenant isolation across all integrations.'],
  ['endToEndId', 'Cross-system workflows and financial/data rails', 'Shared trace id across AEGIS and downstream infrastructure.'],
  ['denialReason', 'UX, audit, support, customer logs', 'Keeps refusal behavior typed and stable.'],
  ['trustBand', 'Dashboards and risk workflows', 'Lets customers tune enforcement without inventing their own scoring terms.'],
];

const risks = [
  ['Platform sprawl', 'Every adapter invents its own semantics and AEGIS becomes inconsistent.', 'One action envelope, one denial taxonomy, adapter certification.'],
  ['Vendor capture', 'AEGIS appears tied to one LLM, cloud, payment provider, or protocol.', 'Neutral wording, multi-provider examples, standards ledger.'],
  ['Integration theater', 'Docs list many logos but few working paths.', 'Every claimed integration has status, owner, runnable proof, and source link.'],
  ['Silent bypass', 'An adapter lets high-impact actions skip verify under error or timeout.', 'Fail-closed defaults, shadow-mode labels, incident alerts.'],
  ['Developer friction', 'Adoption takes too long and developers never reach the first verdict.', 'Copy/paste quickstarts, tiny wrappers, CLI setup, no required sales call for demos.'],
  ['Audit gaps', 'Downstream systems cannot join their events to AEGIS evidence.', 'Require auditEventId metadata for production mutation paths.'],
  ['Preview protocol drift', 'Emerging AI and payment protocols change underneath the adapter.', 'Pin version posture, label preview, isolate compatibility code.'],
  ['Overbroad public claims', 'Marketing promises integrations or standards that are not implemented.', 'Implemented/beta/planned labels and reviewer gate before publish.'],
];

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export default function EverywherePage() {
  return (
    <div className={styles.manual}>
      <section className={styles.hero}>
        <div className="container">
          <div className={styles.heroGrid}>
            <div>
              <p className={styles.kicker}>Enterprise integration doctrine</p>
              <h1>AEGIS Everywhere</h1>
              <p className={styles.lede}>
                The goal is not to become a payment product. The goal is to become Stripe-like infrastructure
                for AI: easy to integrate, present in every stack, neutral across vendors, and trusted whenever
                an agent touches a real system.
              </p>
              <div className={styles.heroActions}>
                <a className="btn btn-primary" href="#task-matrix">Open task matrix</a>
                <a className="btn btn-ghost" href="#infrastructure">Integration map</a>
              </div>
            </div>
            <aside className={styles.statusPanel} aria-label="AEGIS Everywhere status">
              <div>
                <span>Pattern</span>
                <strong>Stripe-like ubiquity for agent verification, not Stripe-specific billing doctrine.</strong>
              </div>
              <div>
                <span>Core promise</span>
                <strong>One verify call before any consequential AI action.</strong>
              </div>
              <div>
                <span>Distribution</span>
                <strong>SDKs, MCP wrappers, workflow nodes, edge middleware, partner adapters.</strong>
              </div>
              <div>
                <span>Boundary</span>
                <strong>AEGIS holds public keys only and signs only what it observed.</strong>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <nav className={styles.anchorNav} aria-label="AEGIS Everywhere sections">
        <div className="container">
          <a href="#doctrine">Doctrine</a>
          <a href="#architecture">Architecture</a>
          <a href="#infrastructure">Infrastructure</a>
          <a href="#departments">Departments</a>
          <a href="#swarm">Agent swarm</a>
          <a href="#task-matrix">Tasks</a>
          <a href="#runbook">Runbook</a>
          <a href="#risks">Risks</a>
          <a href="#sources">Sources</a>
        </div>
      </nav>

      <section id="doctrine" className={styles.section}>
        <div className="container">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>01 / Doctrine</p>
            <h2>Be the integration layer everyone reaches for when AI agents act.</h2>
            <p>
              Stripe won by making payments feel native in every application. AEGIS uses the same integration
              posture for trust: small APIs, copyable quickstarts, excellent adapters, clear errors, and evidence
              that survives across every system an agent touches.
            </p>
          </div>
          <div className={styles.doctrineGrid}>
            <article>
              <h3>Easy by default</h3>
              <p>
                A developer should be able to register an agent, issue a policy, call verify, and see a typed
                verdict without needing to understand the whole platform.
              </p>
            </article>
            <article>
              <h3>Everywhere by design</h3>
              <p>
                AEGIS belongs in MCP tools, SaaS actions, workflows, browser agents, payment calls, data exports,
                cloud edges, and internal admin systems.
              </p>
            </article>
            <article>
              <h3>Neutral by contract</h3>
              <p>
                The product remains model-neutral, vendor-neutral, protocol-neutral, and cloud-neutral. Adapters
                are distribution; the signed evidence layer is the product.
              </p>
            </article>
          </div>
          <div className={styles.callout}>
            <strong>Execution rule:</strong> every adapter must reduce local complexity while preserving AEGIS
            invariants: public keys only, portable verify path, append-only signed audit, typed denials, and
            tenant isolation by principal.
          </div>
        </div>
      </section>

      <section id="architecture" className={styles.sectionAlt}>
        <div className="container">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>02 / Architecture</p>
            <h2>Core stays small. Integrations make it feel native everywhere.</h2>
            <p>
              Do not push ecosystem-specific behavior into the verify core. Keep the center stable and let thin
              adapters translate framework, protocol, cloud, workflow, and payment concepts into one AEGIS action
              envelope.
            </p>
          </div>
          <div className={styles.layerGrid}>
            {architectureLayers.map((layer) => (
              <article key={layer.name} className={styles.layerCard}>
                <div className={styles.cardTopline}>{layer.owner}</div>
                <h3>{layer.name}</h3>
                <p>{layer.summary}</p>
                <ul>
                  {layer.contracts.map((contract) => (
                    <li key={contract}>{contract}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <div className={styles.flow} aria-label="Universal verify flow">
            <div>Agent intent</div>
            <span>{'->'}</span>
            <div>Local adapter</div>
            <span>{'->'}</span>
            <div>AEGIS verify</div>
            <span>{'->'}</span>
            <div>System action</div>
            <span>{'->'}</span>
            <div>Signed evidence</div>
          </div>
        </div>
      </section>

      <section id="infrastructure" className={styles.section}>
        <div className="container">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>03 / AI infrastructure map</p>
            <h2>Integrate across the stack where agents already work.</h2>
            <p>
              Payments are one important lane, not the doctrine. AEGIS Everywhere covers frameworks, protocols,
              clouds, browsers, SaaS, databases, security tools, observability, and standards.
            </p>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Surface</th>
                  <th>Examples</th>
                  <th>Use in AEGIS Everywhere</th>
                  <th>AEGIS control</th>
                </tr>
              </thead>
              <tbody>
                {infrastructureRows.map(([surface, examples, use, control]) => (
                  <tr key={surface}>
                    <th>{surface}</th>
                    <td>{examples}</td>
                    <td>{use}</td>
                    <td>{control}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="departments" className={styles.sectionAlt}>
        <div className="container">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>04 / Department command center</p>
            <h2>Ubiquity is an operating model, not a tagline.</h2>
            <p>
              Each department owns a slice of the integration flywheel: technical surface area, developer
              experience, partner adoption, source-backed claims, reliability, and proof.
            </p>
          </div>
          <div className={styles.departmentGrid}>
            {departments.map(([name, charter, gate]) => (
              <article key={name} className={styles.departmentCard}>
                <h3>{name}</h3>
                <p>{charter}</p>
                <div><span>Gate</span>{gate}</div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="swarm" className={styles.section}>
        <div className="container">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>05 / Agent and swarm execution</p>
            <h2>Many adapter lanes, one coherent trust layer.</h2>
            <p>
              Large AEGIS Everywhere pushes should split by ecosystem and proof artifact: MCP, agent framework,
              workflow engine, cloud edge, SaaS connector, payment rail, evidence export, and docs.
            </p>
          </div>
          <div className={styles.agentGrid}>
            {agentLanes.map(([role, mission, output]) => (
              <article key={role}>
                <h3>{role}</h3>
                <p>{mission}</p>
                <strong>{output}</strong>
              </article>
            ))}
          </div>
          <pre className={styles.codeBlock}>{`team-plan -> team-prd -> team-exec -> team-verify -> team-fix

Lane split for AEGIS Everywhere:
1. Universal action envelope and adapter contract
2. MCP bridge and sensitive-tool quickstart
3. Framework middleware: Vercel AI SDK / LangChain / CrewAI
4. Cloud and edge verify deployment
5. SaaS/data/payment reference adapters
6. Evidence exports, docs, and browser QA`}</pre>
        </div>
      </section>

      <section id="task-matrix" className={styles.sectionAlt}>
        <div className="container">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>06 / Task matrix</p>
            <h2>P0 means no credible ubiquity. P1 means no scale. P2 means known debt.</h2>
            <p>
              The matrix is designed for parallel execution. Every row has one owner group, one action, and one
              proof path. Close tasks with evidence, not aspiration.
            </p>
          </div>
          <div className={styles.taskList}>
            {tasks.map(([priority, title, owner, action, proof]) => (
              <article key={title} className={styles.taskCard} data-priority={priority}>
                <div className={styles.priority}>{priority}</div>
                <div>
                  <h3>{title}</h3>
                  <p>{action}</p>
                </div>
                <div>
                  <span>Owner</span>
                  <strong>{owner}</strong>
                </div>
                <div>
                  <span>Proof</span>
                  <strong>{proof}</strong>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="runbook" className={styles.section}>
        <div className="container">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>07 / Environment and adapter runbook</p>
            <h2>Core AEGIS envs are universal. Adapter envs stay local.</h2>
            <p>
              AEGIS Everywhere should not require every customer to configure every ecosystem. Keep the core
              contract small, then let each adapter document only the credentials it needs.
            </p>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>Variable</th>
                  <th>Surface</th>
                  <th>Purpose</th>
                  <th>Proof</th>
                </tr>
              </thead>
              <tbody>
                {envRows.map(([variable, surface, purpose, proof]) => (
                  <tr key={variable}>
                    <th><code>{variable}</code></th>
                    <td>{surface}</td>
                    <td>{purpose}</td>
                    <td>{proof}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.split}>
            <article>
              <h3>Metadata contract</h3>
              <div className={styles.tableWrap}>
                <table className={styles.compactTable}>
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Where</th>
                      <th>Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metadataKeys.map(([key, where, why]) => (
                      <tr key={key}>
                        <th><code>{key}</code></th>
                        <td>{where}</td>
                        <td>{why}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
            <article className={styles.sequenceCard}>
              <h3>Adapter launch sequence</h3>
              <ol>
                <li>Pick the ecosystem and name the high-impact action AEGIS will gate.</li>
                <li>Map local concepts into the universal action envelope.</li>
                <li>Implement shadow mode first when the customer already has auth.</li>
                <li>Return typed denials and preserve downstream error detail.</li>
                <li>Store `aegisAuditEventId` beside the downstream event ID.</li>
                <li>Run happy path, denial path, replay path, and downstream failure path.</li>
                <li>Publish a quickstart, production checklist, and source ledger.</li>
              </ol>
            </article>
          </div>
        </div>
      </section>

      <section id="risks" className={styles.sectionAlt}>
        <div className="container">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>08 / Risk register</p>
            <h2>Ubiquity fails if the integration surface becomes sloppy.</h2>
            <p>
              Stripe-like reach only works if the primitives stay coherent. AEGIS must be easy to adopt without
              becoming vague, vendor-captured, or impossible to verify.
            </p>
          </div>
          <div className={styles.riskGrid}>
            {risks.map(([risk, failure, control]) => (
              <article key={risk}>
                <h3>{risk}</h3>
                <p>{failure}</p>
                <strong>{control}</strong>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="sources" className={styles.section}>
        <div className="container">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>09 / Source ledger</p>
            <h2>Claims on this page stay traceable.</h2>
            <p>
              AEGIS sources are the internal source of truth. External signals show the integration surface area
              where AI agents are already moving, but implementation claims still require local proof.
            </p>
          </div>
          <div className={styles.sourceGrid}>
            <article>
              <h3>AEGIS sources</h3>
              <ul>
                {sources.map(([label, href]) => (
                  <li key={href}><ExternalLink href={href}>{label}</ExternalLink></li>
                ))}
              </ul>
            </article>
            <article>
              <h3>External signals</h3>
              <ul>
                {externalSignals.map(([label, href]) => (
                  <li key={href}><ExternalLink href={href}>{label}</ExternalLink></li>
                ))}
              </ul>
            </article>
          </div>
        </div>
      </section>
    </div>
  );
}
