import {
  addAddress,
  blockedByMixedContent,
  guessKind,
  moveAddress,
  orderFor,
  pickAddress,
  type ProbeFn,
  probeOne,
  sameServerId,
  type ServerAddress,
} from '../addresses';
import { connectionLine, UNKNOWN_CONNECTION } from '../status';
import { wifiPreference } from '../wifi-rule';

const SERVER_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const LAN: ServerAddress = { url: 'http://192.0.2.10:8096', kind: 'internal' };
const PUBLIC: ServerAddress = { url: 'https://jellyfin.example.com', kind: 'external' };
const DEAD: ServerAddress = { url: 'http://10.255.255.1:8096', kind: 'internal' };

type Plan = Record<string, { after: number; id?: string | null; fail?: boolean }>;

/** A fake probe: each URL answers (or fails) after a set delay. */
function fakeProbe(plan: Plan): ProbeFn & { calls: string[] } {
  const calls: string[] = [];
  const fn = ((url: string) => {
    calls.push(url);
    const p = plan[url];
    return new Promise((resolve, reject) => {
      if (!p) return; // Never answers.
      setTimeout(() => (p.fail ? reject(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' })) : resolve({ id: p.id === undefined ? SERVER_ID : p.id })), p.after);
    });
  }) as unknown as ProbeFn & { calls: string[] };
  fn.calls = calls;
  return fn;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('guessKind', () => {
  it('calls private addresses and local names internal', () => {
    expect(guessKind('http://172.16.1.20:8096')).toBe('internal');
    expect(guessKind('http://10.0.0.5')).toBe('internal');
    expect(guessKind('http://172.20.1.1')).toBe('internal');
    expect(guessKind('http://jellyfin.local:8096')).toBe('internal');
    expect(guessKind('http://media.home.arpa')).toBe('internal');
    expect(guessKind('http://nas:8096')).toBe('internal');
    expect(guessKind('http://localhost:8096')).toBe('internal');
  });
  it('calls public names and addresses external', () => {
    expect(guessKind('https://jellyfin.example.com')).toBe('external');
    expect(guessKind('http://203.0.113.7:8096')).toBe('external');
    expect(guessKind('http://172.32.0.1')).toBe('external');
  });
});

describe('sameServerId', () => {
  it('ignores dashes and case', () => {
    expect(sameServerId('A1B2C3D4-E5F6-0718-293A-4B5C6D7E8F90', SERVER_ID)).toBe(true);
    expect(sameServerId('other', SERVER_ID)).toBe(false);
    expect(sameServerId(null, SERVER_ID)).toBe(false);
  });
});

describe('orderFor', () => {
  const list = [PUBLIC, LAN, DEAD];
  it('keeps the user order in Automatic mode', () => {
    expect(orderFor(list, 'auto', null)).toEqual([PUBLIC, LAN, DEAD]);
  });
  it('keeps only one kind in the Always modes', () => {
    expect(orderFor(list, 'internal', null)).toEqual([LAN, DEAD]);
    expect(orderFor(list, 'external', 'internal')).toEqual([PUBLIC]);
  });
  it('puts the preferred kind first and keeps the rest as a fallback', () => {
    expect(orderFor(list, 'auto', 'internal')).toEqual([LAN, DEAD, PUBLIC]);
  });
});

describe('probeOne', () => {
  it('rejects an address where a different server answers', async () => {
    const probe = fakeProbe({ [LAN.url]: { after: 10, id: 'another-server' } });
    const p = probeOne(LAN.url, SERVER_ID, probe, 1500);
    jest.advanceTimersByTime(10);
    await expect(p).resolves.toEqual({ url: LAN.url, ok: false, reason: 'wrong-server' });
  });
  it('rejects an answer with no Id', async () => {
    const probe = fakeProbe({ [LAN.url]: { after: 10, id: null } });
    const p = probeOne(LAN.url, SERVER_ID, probe, 1500);
    jest.advanceTimersByTime(10);
    await expect(p).resolves.toMatchObject({ ok: false, reason: 'not-jellyfin' });
  });
  it('times out by itself when the probe never answers', async () => {
    const p = probeOne(DEAD.url, SERVER_ID, fakeProbe({}), 1500);
    jest.advanceTimersByTime(1500);
    await expect(p).resolves.toEqual({ url: DEAD.url, ok: false, reason: 'timeout' });
  });
  it('reports a refused connection as unreachable', async () => {
    const p = probeOne(LAN.url, SERVER_ID, fakeProbe({ [LAN.url]: { after: 5, fail: true } }), 1500);
    jest.advanceTimersByTime(5);
    await expect(p).resolves.toMatchObject({ ok: false, reason: 'unreachable' });
  });
});

describe('pickAddress', () => {
  it('probes all addresses at the same time', () => {
    const probe = fakeProbe({});
    void pickAddress([LAN, PUBLIC, DEAD], SERVER_ID, probe);
    expect(probe.calls).toEqual([LAN.url, PUBLIC.url, DEAD.url]);
  });

  it('prefers the first address in order that answers, even when a later one is faster', async () => {
    const probe = fakeProbe({ [LAN.url]: { after: 300 }, [PUBLIC.url]: { after: 20 } });
    const p = pickAddress([LAN, PUBLIC], SERVER_ID, probe);
    jest.advanceTimersByTime(300);
    const r = await p;
    expect(r.address).toEqual(LAN);
  });

  it('falls back to the next address when the first one times out', async () => {
    const probe = fakeProbe({ [PUBLIC.url]: { after: 50 } });
    let done = false;
    const p = pickAddress([DEAD, PUBLIC], SERVER_ID, probe, { timeoutMs: 1500 }).then((r) => {
      done = true;
      return r;
    });
    await jest.advanceTimersByTimeAsync(1000);
    expect(done).toBe(false); // The first address can still answer.
    await jest.advanceTimersByTimeAsync(500);
    const r = await p;
    expect(r.address).toEqual(PUBLIC);
    expect(r.results.find((x) => x.url === DEAD.url)).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('returns at once when the first address answers, without waiting for slow ones', async () => {
    const probe = fakeProbe({ [LAN.url]: { after: 30 } });
    let done = false;
    const p = pickAddress([LAN, DEAD], SERVER_ID, probe).then((r) => {
      done = true;
      return r;
    });
    await jest.advanceTimersByTimeAsync(30);
    expect(done).toBe(true);
    expect((await p).address).toEqual(LAN);
  });

  it('never picks an address where a different server answers', async () => {
    const probe = fakeProbe({ [LAN.url]: { after: 10, id: 'another-server' }, [PUBLIC.url]: { after: 40 } });
    const p = pickAddress([LAN, PUBLIC], SERVER_ID, probe);
    await jest.advanceTimersByTimeAsync(40);
    expect((await p).address).toEqual(PUBLIC);
  });

  it('returns no address when nothing answers', async () => {
    const p = pickAddress([LAN, DEAD], SERVER_ID, fakeProbe({ [LAN.url]: { after: 5, fail: true } }));
    await jest.advanceTimersByTimeAsync(1500);
    const r = await p;
    expect(r.address).toBeNull();
    expect(r.results).toHaveLength(2);
  });

  it('skips http addresses on an https page (mixed content)', async () => {
    const probe = fakeProbe({ [LAN.url]: { after: 5 }, [PUBLIC.url]: { after: 50 } });
    const p = pickAddress([LAN, PUBLIC], SERVER_ID, probe, { pageIsHttps: true });
    await jest.advanceTimersByTimeAsync(50);
    const r = await p;
    expect(r.address).toEqual(PUBLIC);
    expect(probe.calls).toEqual([PUBLIC.url]);
    expect(r.results[0]).toEqual({ url: LAN.url, ok: false, reason: 'mixed-content' });
  });

  it('follows the mode: Always external never uses the internal address', async () => {
    const probe = fakeProbe({ [LAN.url]: { after: 5 }, [PUBLIC.url]: { after: 50 } });
    const p = pickAddress(orderFor([LAN, PUBLIC], 'external', null), SERVER_ID, probe);
    await jest.advanceTimersByTimeAsync(50);
    expect((await p).address).toEqual(PUBLIC);
    expect(probe.calls).toEqual([PUBLIC.url]);
  });

  it('follows the mode: Always internal reports no address when the internal one is down', async () => {
    const probe = fakeProbe({ [PUBLIC.url]: { after: 5 } });
    const p = pickAddress(orderFor([PUBLIC, DEAD], 'internal', null), SERVER_ID, probe);
    await jest.advanceTimersByTimeAsync(1500);
    expect((await p).address).toBeNull();
  });

  it('with the Wi-Fi rule, uses the internal address at home and the external one elsewhere', async () => {
    const rule = { enabled: true, ssids: ['Home'] };
    const list = [PUBLIC, LAN];
    const probe = fakeProbe({ [LAN.url]: { after: 5 }, [PUBLIC.url]: { after: 5 } });
    const home = pickAddress(orderFor(list, 'auto', wifiPreference(rule, { type: 'wifi', ssid: 'Home' })), SERVER_ID, probe);
    await jest.advanceTimersByTimeAsync(5);
    expect((await home).address).toEqual(LAN);
    const away = pickAddress(orderFor([LAN, PUBLIC], 'auto', wifiPreference(rule, { type: 'cellular', ssid: null })), SERVER_ID, probe);
    await jest.advanceTimersByTimeAsync(5);
    expect((await away).address).toEqual(PUBLIC);
  });

  it('with the Wi-Fi rule, falls back to the probe when the internal address does not answer', async () => {
    const rule = { enabled: true, ssids: ['Home'] };
    const wanted = wifiPreference(rule, { type: 'wifi', ssid: 'Home' });
    const probe = fakeProbe({ [PUBLIC.url]: { after: 5 } });
    const p = pickAddress(orderFor([PUBLIC, DEAD], 'auto', wanted), SERVER_ID, probe);
    await jest.advanceTimersByTimeAsync(1500);
    const r = await p;
    expect(r.address).toEqual(PUBLIC);
    const line = connectionLine({ ...UNKNOWN_CONNECTION, status: 'connected', url: PUBLIC.url, kind: 'external', wanted });
    expect(line.text).toBe('Connected through Internet (external)');
    expect(line.detail).toContain('Wi-Fi rule');
    expect(line.tone).toBe('warning');
  });
});

describe('address list edits', () => {
  it('adds an address once, with a guessed kind', () => {
    const list = addAddress([PUBLIC], 'http://192.0.2.10:8096');
    expect(list).toEqual([PUBLIC, { url: 'http://192.0.2.10:8096', kind: 'external' }]);
    expect(addAddress(list, PUBLIC.url)).toHaveLength(2);
    expect(addAddress([], 'http://10.0.0.2', 'internal')[0].kind).toBe('internal');
  });
  it('moves an address', () => {
    expect(moveAddress([LAN, PUBLIC, DEAD], 2, 0)).toEqual([DEAD, LAN, PUBLIC]);
    expect(moveAddress([LAN, PUBLIC], 0, 5)).toEqual([LAN, PUBLIC]);
  });
  it('knows mixed content', () => {
    expect(blockedByMixedContent('http://192.0.2.10', true)).toBe(true);
    expect(blockedByMixedContent('https://jellyfin.example.com', true)).toBe(false);
    expect(blockedByMixedContent('http://192.0.2.10', false)).toBe(false);
  });
});

describe('connectionLine', () => {
  it('names the internal address', () => {
    expect(connectionLine({ ...UNKNOWN_CONNECTION, status: 'connected', url: LAN.url, kind: 'internal' }).text).toBe('Connected through Home network (internal)');
  });
  it('explains mixed content when it blocks every address', () => {
    const line = connectionLine({ ...UNKNOWN_CONNECTION, status: 'unreachable', results: { [LAN.url]: { url: LAN.url, ok: false, reason: 'mixed-content' } } });
    expect(line.text).toBe('No address answers');
    expect(line.detail).toContain('mixed content');
  });
});
