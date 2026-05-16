// CSS-animated audit chain — each block pulses with a staggered delay
// to convey "the chain is live." Server component, zero JS.

const BLOCKS = [
  { seq: 9412, hash: '7a4e' },
  { seq: 9413, hash: 'b08c' },
  { seq: 9414, hash: 'f2d1' },
  { seq: 9415, hash: '4e7a' },
  { seq: 9416, hash: '91bc' },
  { seq: 9417, hash: '3a82' },
];

export function AuditChain() {
  return (
    <div className="audit-chain" aria-label="Live audit chain">
      {BLOCKS.map((b) => (
        <span key={b.seq} className="audit-block">
          <span>#{b.seq}</span>{' '}
          <span className="hash">{b.hash}…</span>
        </span>
      ))}
    </div>
  );
}
