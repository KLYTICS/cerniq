'use client';

// Typewriter effect on viewport entry. Uses IntersectionObserver so the
// animation only fires once, on first scroll into view. Honors reduced
// motion by rendering the full text immediately.

import { useEffect, useRef, useState } from 'react';

interface Segment { c?: string; k?: string; s?: string; fn?: string; t?: string }

const SEGMENTS: Segment[] = [
  { k: 'import' }, { t: ' { Aegis } ' }, { k: 'from' }, { s: " '@aegis/sdk'" }, { t: ';\n\n' },
  { k: 'const' }, { t: ' aegis = ' }, { k: 'new' }, { t: ' ' }, { fn: 'Aegis' }, { t: '({' }, { t: '\n  apiKey: process.env.AEGIS_KEY,\n});\n\n' },
  { c: '// Verify an agent action before allowing it\n' },
  { k: 'const' }, { t: ' result = ' }, { k: 'await' }, { t: ' aegis.' }, { fn: 'verify' }, { t: '(agentToken, {\n  action: ' }, { s: "'orders.create'" }, { t: ',\n  amount: ' }, { s: '99.00' }, { t: ',\n});\n\n' },
  { k: 'if' }, { t: ' (!result.valid) ' }, { k: 'throw new' }, { t: ' ' }, { fn: 'Error' }, { t: '(result.reason);' },
];

const TOTAL_CHARS = SEGMENTS.reduce((sum, seg) => {
  return sum + (seg.c ?? seg.k ?? seg.s ?? seg.fn ?? seg.t ?? '').length;
}, 0);

// Reveal speed: ~50 chars per second feels natural without dragging.
const CHARS_PER_TICK = 6;
const TICK_MS = 30;

export function CodeTypewriter() {
  const ref = useRef<HTMLPreElement>(null);
  const [revealed, setRevealed] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      setRevealed(TOTAL_CHARS);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !started) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    const interval = setInterval(() => {
      setRevealed((r) => {
        const next = r + CHARS_PER_TICK;
        if (next >= TOTAL_CHARS) {
          clearInterval(interval);
          return TOTAL_CHARS;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [started]);

  // Walk segments, take only the first `revealed` characters cumulatively.
  let remaining = revealed;
  const rendered: React.ReactNode[] = [];
  for (let i = 0; i < SEGMENTS.length; i++) {
    const seg = SEGMENTS[i]!;
    const text = seg.c ?? seg.k ?? seg.s ?? seg.fn ?? seg.t ?? '';
    if (text.length === 0) continue;
    const take = Math.min(text.length, Math.max(0, remaining));
    if (take === 0) break;
    const slice = text.slice(0, take);
    if (seg.c !== undefined) rendered.push(<span key={i} className="c">{slice}</span>);
    else if (seg.k !== undefined) rendered.push(<span key={i} className="k">{slice}</span>);
    else if (seg.s !== undefined) rendered.push(<span key={i} className="s">{slice}</span>);
    else if (seg.fn !== undefined) rendered.push(<span key={i} className="fn">{slice}</span>);
    else rendered.push(<span key={i}>{slice}</span>);
    remaining -= take;
  }

  const done = revealed >= TOTAL_CHARS;

  return (
    <pre className="code-block" ref={ref} aria-label="AEGIS verify quickstart code">
      <code>
        {rendered}
        {!done && <span className="typewriter-caret" aria-hidden="true" />}
      </code>
    </pre>
  );
}
