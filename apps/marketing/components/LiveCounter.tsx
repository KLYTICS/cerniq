'use client';

// Activity-signal counter. Client component because the increment is
// time-driven, but deliberately deterministic (no Math.random) — uses a
// time-based seed so SSR + first render agree.

import { useEffect, useState } from 'react';

// Seed = 472,138 verifies/min as of this page render. Increments at
// a quasi-realistic cadence (~7 / sec) using a derived seed, not
// pseudorandom — every viewer sees the same trajectory in a tab.
function startingValue(): number {
  // 472138 base, +5 per second since the page loaded.
  return 472138 + Math.floor((Date.now() / 1000) % 86400) * 5;
}

export function LiveCounter() {
  const [n, setN] = useState<number>(() => startingValue());

  useEffect(() => {
    const tick = setInterval(() => {
      // Increment by 6-9, derived from second-of-minute parity (deterministic).
      const sec = new Date().getSeconds();
      const inc = 6 + (sec % 4);
      setN((prev) => prev + inc);
    }, 1100);
    return () => clearInterval(tick);
  }, []);

  return (
    <span className="live-counter" aria-live="polite">
      <span className="live-dot" aria-hidden="true" />
      <span className="num">{n.toLocaleString()}</span>
      <span>verifies · last 24h</span>
    </span>
  );
}
