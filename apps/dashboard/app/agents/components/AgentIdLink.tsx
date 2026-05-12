'use client';

import type { ReactNode } from 'react';

interface Props {
  agentId: string;
  children: ReactNode;
}

export function AgentIdLink({ agentId, children }: Props) {
  return (
    <a
      href={`/agents/${encodeURIComponent(agentId)}`}
      title={agentId}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </a>
  );
}
