// `okoro mcp install` — writes an `okoro-mcp` entry into the host's MCP
// config. Supports Claude Desktop and Cursor.

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

import { resolveCredentials } from '../credentials.js';
import { info, ok, warn, err } from '../output.js';

type Host = 'claude-desktop' | 'cursor';

interface McpConfig {
  mcpServers?: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

function configPath(host: Host): string {
  const home = homedir();
  const mac = platform() === 'darwin';
  if (host === 'claude-desktop') {
    return mac
      ? join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      : join(home, '.config', 'Claude', 'claude_desktop_config.json');
  }
  // Cursor stores its MCP config alongside settings.json
  return mac
    ? join(home, 'Library', 'Application Support', 'Cursor', 'User', 'mcp.json')
    : join(home, '.config', 'Cursor', 'User', 'mcp.json');
}

export async function mcpInstall(opts: { host?: Host; serverName?: string; force?: boolean }): Promise<void> {
  const host = opts.host ?? 'claude-desktop';
  const name = opts.serverName ?? 'okoro';
  const path = configPath(host);
  const creds = await resolveCredentials();
  if (!creds) {
    err('not logged in — run `okoro bootstrap` first.');
    process.exit(1);
  }

  let cfg: McpConfig = {};
  if (existsSync(path)) {
    try {
      cfg = JSON.parse(await readFile(path, 'utf8')) as McpConfig;
    } catch {
      warn(`existing ${path} is not valid JSON; backing up and starting fresh.`);
      await writeFile(`${path}.okoro-backup.${Date.now()}`, await readFile(path, 'utf8'));
    }
  } else {
    await mkdir(join(path, '..'), { recursive: true });
  }

  cfg.mcpServers = cfg.mcpServers ?? {};
  if (cfg.mcpServers[name] && !opts.force) {
    warn(`${name} already configured in ${path}. Use --force to overwrite.`);
    return;
  }

  cfg.mcpServers[name] = {
    command: 'npx',
    args: ['-y', '@okoro/mcp-server'],
    env: { OKORO_API_KEY: creds.apiKey, OKORO_BASE_URL: creds.baseUrl },
  };

  await writeFile(path, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  ok(`installed @okoro/mcp-server into ${host} at ${path}`);
  info(`Restart ${host} to pick up the change.`);
}
