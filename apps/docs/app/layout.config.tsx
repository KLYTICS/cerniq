import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <span className="font-semibold tracking-tight">
        AEGIS <span className="text-[var(--aegis-fog)] font-normal">Docs</span>
      </span>
    ),
    url: '/',
  },
  links: [
    { text: 'Quickstart', url: '/docs', active: 'nested-url' },
    { text: 'Concepts', url: '/docs/concepts/denial-precedence', active: 'nested-url' },
    { text: 'API', url: '/docs/api/agents', active: 'nested-url' },
    { text: 'GitHub', url: 'https://github.com/klytics/aegis', external: true },
  ],
};
