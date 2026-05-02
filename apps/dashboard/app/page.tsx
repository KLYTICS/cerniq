export default function HomePage() {
  return (
    <section className="aegis-overview">
      <h1>AEGIS — Agent Gateway &amp; Identity Stack</h1>
      <p className="lede">
        Verified cryptographic identity, scoped authorization, and behavioral attestation for every AI agent.
      </p>

      <div className="metric-strip">
        <Metric label="Agents" value="—" />
        <Metric label="Policies (active)" value="—" />
        <Metric label="Verifications / 24h" value="—" />
        <Metric label="BATE p50" value="—" />
        <Metric label="Verify p99" value="—" />
      </div>

      <div className="block">
        <h2>What lives here</h2>
        <ul>
          <li>
            <code>/agents</code> — register, inspect, and revoke agent identities.
          </li>
          <li>
            <code>/policies</code> — issue scoped, time-bounded permissions.
          </li>
          <li>
            <a href="http://localhost:4000/docs" target="_blank" rel="noreferrer">
              API docs
            </a>{' '}
            — interactive OpenAPI spec served from the API.
          </li>
        </ul>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </div>
  );
}
