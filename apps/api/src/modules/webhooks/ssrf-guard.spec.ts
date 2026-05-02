import { checkAddressBlocked, checkSsrf } from './ssrf-guard';

describe('checkAddressBlocked (IPv4)', () => {
  it.each([
    ['10.0.0.1', 'RFC 1918 private 10.0.0.0/8'],
    ['10.255.255.255', 'RFC 1918 private 10.0.0.0/8'],
    ['127.0.0.1', 'loopback 127.0.0.0/8'],
    ['127.255.255.255', 'loopback 127.0.0.0/8'],
    ['169.254.169.254', 'link-local 169.254.0.0/16 (incl. cloud metadata)'],
    ['172.16.0.1', 'RFC 1918 private 172.16.0.0/12'],
    ['172.31.255.255', 'RFC 1918 private 172.16.0.0/12'],
    ['192.168.1.1', 'RFC 1918 private 192.168.0.0/16'],
    ['100.64.0.1', 'CGNAT 100.64.0.0/10'],
    ['224.0.0.1', 'multicast 224.0.0.0/4'],
    ['255.255.255.255', 'reserved 240.0.0.0/4'],
    ['0.0.0.0', '"this network" 0.0.0.0/8'],
  ])('blocks %s — %s', (address, expectedReason) => {
    expect(checkAddressBlocked(address, 4)).toContain(expectedReason);
  });

  it.each([
    ['8.8.8.8'],
    ['1.1.1.1'],
    ['52.94.236.248'],
    ['200.0.0.1'],
    ['172.32.0.1'], // outside RFC 1918 /12 by one
    ['100.63.255.255'], // outside CGNAT /10 by one
  ])('allows public address %s', (address) => {
    expect(checkAddressBlocked(address, 4)).toBeNull();
  });

  it('rejects malformed IPv4', () => {
    expect(checkAddressBlocked('999.999.999.999', 4)).toMatch(/malformed/);
    expect(checkAddressBlocked('not-an-ip', 4)).toMatch(/malformed/);
  });
});

describe('checkAddressBlocked (IPv6)', () => {
  it.each([
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fc00::1', 'unique-local'],
    ['fd00::1', 'unique-local'],
    ['fe80::1', 'link-local'],
    ['febf::1', 'link-local'],
    ['ff00::1', 'multicast'],
    ['::ffff:127.0.0.1', 'IPv4-mapped: loopback'],
    ['::ffff:169.254.169.254', 'IPv4-mapped: link-local'],
  ])('blocks %s — %s', (address, expectedReason) => {
    expect(checkAddressBlocked(address, 6)).toContain(expectedReason);
  });

  it.each([['2606:4700:4700::1111'], ['2001:4860:4860::8888']])(
    'allows public IPv6 %s',
    (address) => {
      expect(checkAddressBlocked(address, 6)).toBeNull();
    },
  );
});

describe('checkSsrf', () => {
  it('rejects non-http(s) schemes', async () => {
    const out = await checkSsrf('file:///etc/passwd');
    expect(out.kind).toBe('unsupported_scheme');
  });

  it('rejects malformed URLs', async () => {
    const out = await checkSsrf('not://[::xyz');
    expect(out.kind === 'invalid_url' || out.kind === 'host_resolution_failed').toBe(true);
  });

  it('rejects loopback hostname literal', async () => {
    const out = await checkSsrf('http://127.0.0.1:8080/x');
    expect(out.kind).toBe('blocked_address');
    if (out.kind !== 'blocked_address') throw new Error('unreachable');
    expect(out.reason).toMatch(/loopback/);
  });

  it('rejects AWS metadata literal', async () => {
    const out = await checkSsrf('http://169.254.169.254/latest/meta-data/');
    expect(out.kind).toBe('blocked_address');
  });

  it('rejects IPv6 loopback literal', async () => {
    const out = await checkSsrf('http://[::1]/x');
    expect(out.kind).toBe('blocked_address');
  });

  it('approves public IP literal', async () => {
    const out = await checkSsrf('https://1.1.1.1/x');
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') throw new Error('unreachable');
    expect(out.resolvedAddress).toBe('1.1.1.1');
    expect(out.family).toBe(4);
  });

  it('uses the injected resolver and blocks if it returns a private IP', async () => {
    const out = await checkSsrf('https://example.com/x', {
      resolver: async () => ({ address: '10.0.0.1', family: 4 }),
    });
    expect(out.kind).toBe('blocked_address');
  });

  it('uses the injected resolver and approves if it returns a public IP', async () => {
    const out = await checkSsrf('https://example.com/x', {
      resolver: async () => ({ address: '93.184.216.34', family: 4 }),
    });
    expect(out.kind).toBe('ok');
  });

  it('reports host_resolution_failed when resolver throws', async () => {
    const out = await checkSsrf('https://example.com/x', {
      resolver: async () => {
        throw new Error('NXDOMAIN');
      },
    });
    expect(out.kind).toBe('host_resolution_failed');
    if (out.kind !== 'host_resolution_failed') throw new Error('unreachable');
    expect(out.reason).toMatch(/NXDOMAIN/);
  });

  it('blocks DNS-rebind attempt: hostname resolves to internal address', async () => {
    // Simulates the classic SSRF: attacker controls DNS and points
    // attacker.com → 169.254.169.254. The guard catches it because
    // it inspects the *resolved* address, not the hostname.
    const out = await checkSsrf('https://attacker.example/x', {
      resolver: async () => ({ address: '169.254.169.254', family: 4 }),
    });
    expect(out.kind).toBe('blocked_address');
    if (out.kind !== 'blocked_address') throw new Error('unreachable');
    expect(out.reason).toMatch(/link-local/);
  });
});
