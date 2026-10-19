import { linkedSignal, scanHosts, type FetchJson } from '../scan';

const info = (id: string) => ({ ProductName: 'Jellyfin Server', Id: id, ServerName: id, Version: '10.11.0' });

/** A fetch that answers for some hosts and waits for the timeout (or abort) on the others. */
function fakeFetch(servers: Record<string, unknown>, calls: string[] = []): FetchJson {
  return (url, timeoutMs, signal) =>
    new Promise((resolve, reject) => {
      calls.push(url);
      const host = /^http:\/\/([^:]+):/.exec(url)![1];
      if (host in servers) {
        setTimeout(() => resolve(servers[host]), 5);
        return;
      }
      const t = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      });
    });
}

describe('scanHosts', () => {
  it('finds the servers and ignores other answers', async () => {
    const found: string[] = [];
    const answered: string[] = [];
    const r = await scanHosts({
      hosts: ['192.0.2.1', '192.0.2.2', '192.0.2.3', '192.0.2.4'],
      fetchJson: fakeFetch({ '192.0.2.2': info('a'), '192.0.2.4': { ProductName: 'Other' } }),
      onFound: (s) => found.push(`${s.id}@${s.address}`),
      onAnswer: (h) => answered.push(h),
      signal: new AbortController().signal,
      timeoutMs: 20,
      concurrency: 2,
    });
    expect(found).toEqual(['a@http://192.0.2.2:8096']);
    expect(answered.sort()).toEqual(['192.0.2.2', '192.0.2.4']);
    expect(r).toEqual({ asked: 4, timedOut: false, aborted: false });
  });

  it('stops at the deadline', async () => {
    const hosts = Array.from({ length: 200 }, (_, i) => `192.0.2.${i}`);
    const calls: string[] = [];
    const t0 = Date.now();
    const r = await scanHosts({ hosts, fetchJson: fakeFetch({}, calls), onFound: () => undefined, signal: new AbortController().signal, timeoutMs: 30, deadlineMs: 70, concurrency: 4 });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(r.timedOut).toBe(true);
    expect(calls.length).toBeLessThan(200);
  });

  it('stops at once on cancel and reports nothing more', async () => {
    const ctl = new AbortController();
    const found: string[] = [];
    const hosts = Array.from({ length: 100 }, (_, i) => `192.0.2.${i}`);
    const p = scanHosts({ hosts, fetchJson: fakeFetch({ '192.0.2.99': info('late') }), onFound: (s) => found.push(s.id), signal: ctl.signal, timeoutMs: 1000, deadlineMs: 5000, concurrency: 4 });
    setTimeout(() => ctl.abort(), 10);
    const t0 = Date.now();
    const r = await p;
    expect(Date.now() - t0).toBeLessThan(200);
    expect(r.aborted).toBe(true);
    expect(found).toEqual([]);
  });

  it('does nothing with an aborted signal', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const calls: string[] = [];
    const r = await scanHosts({ hosts: ['192.0.2.1'], fetchJson: fakeFetch({}, calls), onFound: () => undefined, signal: ctl.signal });
    expect(calls).toEqual([]);
    expect(r.asked).toBe(0);
  });
});

describe('linkedSignal', () => {
  it('aborts after the time and with the parent', async () => {
    const parent = new AbortController();
    const a = linkedSignal(parent.signal, 10);
    await new Promise((r) => setTimeout(r, 20));
    expect(a.signal.aborted).toBe(true);
    expect(a.expired()).toBe(true);
    const b = linkedSignal(parent.signal, 1000);
    parent.abort();
    expect(b.signal.aborted).toBe(true);
    expect(b.expired()).toBe(false);
    b.done();
  });
});
