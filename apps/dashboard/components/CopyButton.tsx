'use client';

// Wrap any string in a click-to-copy affordance. Triple-purpose:
//   - <CopyButton value="agt_…" /> renders a [copy] mini-button next to text.
//   - <Copyable value="agt_…">{children}</Copyable> wraps inline content,
//     turning the whole region into a click target.
//   - Both fire a toast on success / failure.

import { useState, useTransition } from 'react';

import { copyToClipboard } from '../lib/clipboard';

import { useToast } from './ToastProvider';

interface CopyButtonProps {
  value: string;
  label?: string;
}

export function CopyButton({ value, label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();
  const toast = useToast();

  function onCopy(): void {
    startTransition(async () => {
      const ok = await copyToClipboard(value);
      if (ok) {
        setCopied(true);
        toast.push({
          title: 'Copied to clipboard',
          body: label ? `${label} copied.` : trimMid(value, 32),
          tone: 'ok',
          ttl: 1_800,
        });
        setTimeout(() => { setCopied(false); }, 1_400);
      } else {
        toast.push({ title: 'Copy failed', body: 'Browser denied clipboard access.', tone: 'crit' });
      }
    });
  }

  return (
    <button
      type="button"
      className="mini-btn"
      onClick={onCopy}
      aria-label={`Copy ${label ?? 'value'} to clipboard`}
      title={`Copy ${label ?? 'value'}`}
    >
      {copied ? '✓ copied' : 'copy'}
    </button>
  );
}

interface CopyableProps {
  value: string;
  label?: string;
  children: React.ReactNode;
  className?: string;
}

export function Copyable({ value, label, children, className }: CopyableProps) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  async function onClick(): Promise<void> {
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopied(true);
      toast.push({
        title: 'Copied',
        body: label ? `${label} copied.` : trimMid(value, 32),
        tone: 'ok',
        ttl: 1_400,
      });
      setTimeout(() => { setCopied(false); }, 1_200);
    } else {
      toast.push({ title: 'Copy failed', tone: 'crit' });
    }
  }

  function onKey(e: React.KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void onClick();
    }
  }

  return (
    <span
      className={`copyable${className ? ` ${className}` : ''}`}
      data-copied={copied || undefined}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKey}
      aria-label={`Copy ${label ?? value}`}
      title={`Click to copy${label ? ` ${label}` : ''}`}
    >
      {children}
      <span className="copy-icon" aria-hidden="true">{copied ? '✓' : '⧉'}</span>
    </span>
  );
}

function trimMid(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = Math.floor((max - 1) / 2);
  const tail = max - 1 - head;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
