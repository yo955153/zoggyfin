import type { ProbeFn } from '@/servers/addresses';

import { reachInvite } from '../join';

const SID = 'ef7d53c1de134487b2ca335f2b390702';
const addresses = [
  { url: 'https://media.example.com', label: 'internet' as const },
  { url: 'http://100.101.2.3:8096', label: 'tailscale' as const },
];

function probeWith(answers: Record<string, string | Error>): ProbeFn {
  return async (url) => {
    const a = answers[url];
    if (a === undefined || a instanceof Error) throw a ?? new Error('no answer');
    return { id: a };
  };
}

describe('reachInvite', () => {
  it('uses the first address that answers as the same server', async () => {
    const r = await reachInvite({ serverId: SID, addresses }, probeWith({ 'http://100.101.2.3:8096': SID.toUpperCase() }));
    expect(r).toEqual({ state: 'ok', url: 'http://100.101.2.3:8096' });
  });

  it('refuses an address where a different server answers', async () => {
    const r = await reachInvite({ serverId: SID, addresses }, probeWith({ 'https://media.example.com': 'other' }));
    expect(r).toEqual({ state: 'wrong-server' });
  });

  it('reports unreachable when no address answers (Tailscale off)', async () => {
    const r = await reachInvite({ serverId: SID, addresses }, probeWith({}), { timeoutMs: 50 });
    expect(r).toEqual({ state: 'unreachable' });
  });

  it('does not probe http addresses from an https page', async () => {
    const probe = jest.fn(probeWith({ 'http://100.101.2.3:8096': SID }));
    const r = await reachInvite({ serverId: SID, addresses: [addresses[1]] }, probe, { pageIsHttps: true });
    expect(r).toEqual({ state: 'unreachable' });
    expect(probe).not.toHaveBeenCalled();
  });
});
