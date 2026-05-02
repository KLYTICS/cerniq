export default function AgentsPage() {
  return (
    <section className="aegis-page">
      <h1>Agents</h1>
      <p className="muted">Wire to <code>GET /v1/agents</code> in the next iteration.</p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Agent ID</th>
            <th>Runtime</th>
            <th>Model</th>
            <th>Status</th>
            <th>Trust</th>
            <th>Last seen</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={6} className="muted center">
              No data yet. Register an agent via the SDK or <code>/v1/agents/register</code>.
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
