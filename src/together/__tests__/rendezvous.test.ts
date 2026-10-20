import { generateKeyPair, type Random } from '../rendezvous-crypto';
import {
  type BleInfo,
  type Caps,
  chooseMaker,
  createRendezvous,
  decodeAcceptBody,
  decodeAddrBody,
  decodeInfo,
  decodeRendezvous,
  decodeWifiBody,
  encodeInfo,
  encodeRendezvous,
  type Rendezvous,
  type RendezvousEffect,
  type RendezvousEvent,
  type RendezvousMessage,
  TIMERS,
} from '../rendezvous';

function seeded(seed: number): Random {
  let s = seed >>> 0 || 1;
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      out[i] = s & 0xff;
    }
    return out;
  };
}

const bytes = (s: string) => new TextEncoder().encode(s).length;
const PUB = generateKeyPair(seeded(1)).pub;

// ---------------------------------------------------------------------------

describe('BLE INFO', () => {
  const info: BleInfo = {
    v: 1,
    session: '1a2b3c4d',
    host: 'Sam’s Pixel',
    title: 'The Movie',
    kind: 'video',
    platform: 'android',
    canHotspot: true,
    canJoinWifi: true,
  };

  it('round-trips', () => {
    const text = encodeInfo(info);
    expect(bytes(text)).toBeLessThanOrEqual(200);
    expect(decodeInfo(text)).toEqual(info);
    const audio: BleInfo = { ...info, kind: 'audio', platform: 'apple', canHotspot: false, canJoinWifi: true };
    expect(decodeInfo(encodeInfo(audio))).toEqual(audio);
  });

  it('cuts the title first, then the host, at whole characters', () => {
    const title = '😀é€a"\\'.repeat(40);
    const text = encodeInfo({ ...info, title });
    expect(bytes(text)).toBeLessThanOrEqual(200);
    const back = decodeInfo(text)!;
    expect(back.host).toBe(info.host);
    expect(title.startsWith(back.title)).toBe(true);
    expect(back.title.length).toBeGreaterThan(0);
    expect(back.title).not.toMatch(/[\ud800-\udbff]$/); // no half of a surrogate pair
    // The title fills the room: one more character does not fit.
    const raw = JSON.parse(text);
    raw.n = [...title].slice(0, [...back.title].length + 1).join('');
    expect(bytes(JSON.stringify(raw))).toBeGreaterThan(200);

    const host = 'مرحبا'.repeat(60);
    const t2 = encodeInfo({ ...info, host, title });
    expect(bytes(t2)).toBeLessThanOrEqual(200);
    const b2 = decodeInfo(t2)!;
    expect(b2.title).toBe('');
    expect(host.startsWith(b2.host)).toBe(true);
    expect(b2.host.length).toBeGreaterThan(10);
  });

  it('keeps a lone surrogate safe', () => {
    const text = encodeInfo({ ...info, title: 'a\ud800b'.repeat(100) });
    expect(bytes(text)).toBeLessThanOrEqual(200);
    expect(decodeInfo(text)).not.toBeNull();
  });

  it('rejects bad INFO', () => {
    const ok = JSON.parse(encodeInfo(info));
    const bad = (patch: object) => decodeInfo(JSON.stringify({ ...ok, ...patch }));
    expect(bad({ v: 2 })).toBeNull();
    expect(bad({ s: '1A2B3C4D' })).toBeNull();
    expect(bad({ s: '1a2b3c' })).toBeNull();
    expect(bad({ h: 3 })).toBeNull();
    expect(bad({ k: 'x' })).toBeNull();
    expect(bad({ p: 'w' })).toBeNull();
    expect(bad({ c: 4 })).toBeNull();
    expect(bad({ c: 1.5 })).toBeNull();
    expect(bad({ n: 'x'.repeat(200) })).toBeNull(); // over 200 bytes
    expect(decodeInfo('nope')).toBeNull();
    expect(decodeInfo('[]')).toBeNull();
    expect(decodeInfo(null)).toBeNull();
  });
});

describe('rendezvous messages', () => {
  const samples: RendezvousMessage[] = [
    { t: 'hello', pub: PUB, platform: 'apple', canHotspot: false, canJoinWifi: true, name: 'iPad', memberId: 'm1' },
    { t: 'hello', pub: PUB, platform: 'android', canHotspot: true, canJoinWifi: true, name: 'Pixel', session: 'deadbeef' },
    { t: 'join', box: 'abc' },
    { t: 'accept', box: 'abc' },
    { t: 'decline', reason: 'busy' },
    { t: 'wifi', box: 'abc' },
    { t: 'addr', box: 'abc' },
    { t: 'error', reason: 'timeout' },
  ];

  it.each(samples.map((m) => [m.t, m]))('round-trips %s', (_t, m) => {
    expect(decodeRendezvous(encodeRendezvous(m as RendezvousMessage))).toEqual(m);
  });

  it('rejects bad messages', () => {
    const d = (x: unknown) => decodeRendezvous(JSON.stringify(x));
    expect(d({ t: 'join', box: 'a' })).toBeNull(); // no version
    expect(d({ v: 2, t: 'join', box: 'a' })).toBeNull();
    expect(d({ v: 1, t: 'dance' })).toBeNull();
    expect(d({ v: 1, t: 'join', box: '' })).toBeNull();
    expect(d({ v: 1, t: 'join', box: 5 })).toBeNull();
    expect(d({ v: 1, t: 'hello', pub: 'short', platform: 'apple', canHotspot: false, canJoinWifi: true })).toBeNull();
    expect(d({ v: 1, t: 'hello', pub: PUB, platform: 'windows', canHotspot: false, canJoinWifi: true })).toBeNull();
    expect(d({ v: 1, t: 'hello', pub: PUB, platform: 'apple', canHotspot: 'no', canJoinWifi: true })).toBeNull();
    expect(d({ v: 1, t: 'hello', pub: PUB, platform: 'apple', canHotspot: false, canJoinWifi: true, session: 'XYZ' })).toBeNull();
    expect(d({ v: 1, t: 'decline' })).toBeNull();
    expect(d({ v: 1, t: 'error', reason: 1 })).toBeNull();
    expect(d({ v: 1, t: 'addr', box: 'x'.repeat(5000) })).toBeNull(); // over 4096 bytes
    expect(decodeRendezvous('{')).toBeNull();
    expect(decodeRendezvous(undefined)).toBeNull();
  });

  it('validates the sealed bodies', () => {
    expect(decodeAcceptBody({ t: 'accept', rejoinKey: '0123456789abcdef0123', maker: 'host' })).not.toBeNull();
    expect(decodeAcceptBody({ t: 'wifi', rejoinKey: '0123456789abcdef0123', maker: 'host' })).toBeNull(); // wrong type
    expect(decodeAcceptBody({ t: 'accept', rejoinKey: '0123', maker: 'host' })).toBeNull();
    expect(decodeAcceptBody({ t: 'accept', rejoinKey: '0123456789abcdef0123', maker: 'both' })).toBeNull();
    expect(decodeWifiBody({ t: 'wifi', ssid: '', password: 'x' })).toBeNull();
    expect(decodeWifiBody({ t: 'wifi', ssid: 'x'.repeat(33), password: 'x' })).toBeNull();
    expect(decodeAddrBody({ t: 'addr', addrs: ['172.20.49.1'], port: 50123 })).not.toBeNull();
    expect(decodeAddrBody({ t: 'addr', addrs: ['172.20.49.256'], port: 50123 })).toBeNull();
    expect(decodeAddrBody({ t: 'addr', addrs: ['::1'], port: 50123 })).toBeNull();
    expect(decodeAddrBody({ t: 'addr', addrs: ['01.2.3.4'], port: 50123 })).toBeNull();
    expect(decodeAddrBody({ t: 'addr', addrs: [], port: 50123 })).toBeNull();
    expect(decodeAddrBody({ t: 'addr', addrs: ['1.2.3.4'], port: 0 })).toBeNull();
  });
});

const APPLE: Caps = { platform: 'apple', canHotspot: false, canJoinWifi: true };
const ANDROID: Caps = { platform: 'android', canHotspot: true, canJoinWifi: true };

describe('chooseMaker', () => {
  it('picks the Android device, the host first', () => {
    expect(chooseMaker(ANDROID, APPLE)).toBe('host');
    expect(chooseMaker(APPLE, ANDROID)).toBe('guest');
    expect(chooseMaker(ANDROID, ANDROID)).toBe('host');
    expect(chooseMaker(APPLE, APPLE)).toBeNull();
    expect(chooseMaker({ ...ANDROID, canHotspot: false }, ANDROID)).toBe('guest');
    expect(chooseMaker(ANDROID, { ...APPLE, canJoinWifi: false })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// End-to-end: a host machine and a guest machine, wired by a small effect runner.

const SESSION = '1a2b3c4d';
const REJOIN = '0123456789abcdef0123';
const SSID = 'DIRECT-zz-Secret';
const PASSWORD = 'hunter22-very-secret';
const HOST_ADDRS = { addrs: ['172.20.49.1'], port: 50123 };
const GUEST_NET_HOST_ADDRS = { addrs: ['10.0.0.7'], port: 50123 };

type Side = 'host' | 'guest';

interface Script {
  approve?: boolean | 'ignore';
  hotspot?: 'ok' | 'fail';
  wifi?: 'ok' | 'fail';
  connect?: 'ok' | 'fail';
  /** Drop every message after this many messages on the link (to test LINK_LOST). */
  dropAfter?: number;
}

function wire(hostCaps: Caps, guestCaps: Caps, script: Script = {}) {
  const host = createRendezvous({
    role: 'host',
    self: { name: 'Sam', ...hostCaps },
    session: SESSION,
    rejoinKey: REJOIN,
    keyPair: generateKeyPair(seeded(101)),
    random: seeded(102),
  });
  const guest = createRendezvous({
    role: 'guest',
    self: { name: 'Jane', memberId: 'member-1', ...guestCaps },
    session: SESSION,
    hostName: 'Sam',
    have: true,
    keyPair: generateKeyPair(seeded(201)),
    random: seeded(202),
  });
  const machines: Record<Side, Rendezvous> = { host, guest };
  const log: { side: Side; effect: RendezvousEffect }[] = [];
  const wireText: string[] = [];
  const queue: [Side, RendezvousEvent][] = [];
  let sent = 0;

  function run(side: Side, effects: RendezvousEffect[]) {
    for (const effect of effects) {
      log.push({ side, effect });
      const other: Side = side === 'host' ? 'guest' : 'host';
      switch (effect.type) {
        case 'send':
          wireText.push(effect.text);
          sent++;
          if (script.dropAfter !== undefined && sent > script.dropAfter) break;
          queue.push([other, { type: 'MESSAGE', text: effect.text }]);
          break;
        case 'askApproval':
          if (script.approve === 'ignore') break;
          queue.push([side, script.approve === false ? { type: 'DECLINE', reason: 'Not now' } : { type: 'APPROVE' }]);
          break;
        case 'startHotspot':
          queue.push([side, script.hotspot === 'fail' ? { type: 'HOTSPOT_FAILED', message: 'busy' } : { type: 'HOTSPOT_READY', ssid: SSID, password: PASSWORD }]);
          break;
        case 'joinWifi':
          expect(effect).toEqual({ type: 'joinWifi', ssid: SSID, password: PASSWORD });
          queue.push([side, script.wifi === 'fail' ? { type: 'WIFI_FAILED', message: 'no' } : { type: 'WIFI_JOINED' }]);
          break;
        case 'needAddresses':
          queue.push([side, { type: 'ADDRESSES', ...(machines.host.maker === 'host' ? HOST_ADDRS : GUEST_NET_HOST_ADDRS) }]);
          break;
        case 'connect':
          if (script.connect === 'fail') queue.push([side, { type: 'CONNECT_FAILED' }]);
          else {
            queue.push([side, { type: 'CONNECTED' }]);
            queue.push(['host', { type: 'CONNECTED' }]); // The TCP session opens on the host too.
          }
          break;
        default:
          break;
      }
    }
  }

  function drain() {
    for (let i = 0; queue.length > 0 && i < 1000; i++) {
      const [side, event] = queue.shift()!;
      run(side, machines[side].handle(event));
    }
  }

  return {
    host,
    guest,
    log,
    wireText,
    fire(side: Side, event: RendezvousEvent) {
      run(side, machines[side].handle(event));
      drain();
    },
    start() {
      run('host', host.start());
      run('guest', guest.start());
      drain();
    },
    of: (side: Side, type: RendezvousEffect['type']) => log.filter((l) => l.side === side && l.effect.type === type).map((l) => l.effect),
  };
}

function expectSecretsHidden(texts: string[]) {
  const all = texts.join('\n');
  expect(all).not.toContain(SSID);
  expect(all).not.toContain(PASSWORD);
  expect(all).not.toContain(REJOIN);
  expect(all).not.toContain('172.20.49.1');
  expect(all).not.toContain('10.0.0.7');
  const types = texts.map((t) => decodeRendezvous(t)?.t);
  for (const t of ['wifi', 'addr', 'accept', 'join']) {
    const m = texts.map((x) => decodeRendezvous(x)).find((x) => x?.t === t);
    if (m) expect(Object.keys(m).sort()).toEqual(['box', 't']);
  }
  return types;
}

describe('rendezvous end to end', () => {
  it('Android host + Apple guest: the host makes the Wi-Fi', () => {
    const w = wire(ANDROID, APPLE);
    w.start();
    expect(w.guest.state).toBe('done');
    expect(w.host.state).toBe('done');
    expect(w.host.maker).toBe('host');
    expect(w.guest.maker).toBe('host');
    expect(w.of('host', 'startHotspot')).toHaveLength(1);
    expect(w.of('guest', 'startHotspot')).toHaveLength(0);
    expect(w.of('guest', 'connect')).toEqual([{ type: 'connect', ...HOST_ADDRS, rejoinKey: REJOIN }]);
    expect(w.of('host', 'askApproval')).toEqual([{ type: 'askApproval', name: 'Jane', have: true }]);
    expect(w.host.peer).toMatchObject({ name: 'Jane', memberId: 'member-1', platform: 'apple', have: true });
    expect(w.of('guest', 'progress').map((e) => (e as { text: string }).text)).toEqual([
      'Asking Sam to let you in…',
      "Asking Sam's phone to make a Wi-Fi link…",
      `Joining the Wi-Fi “${SSID}”…`,
      'Connecting…',
      'Connected.',
    ]);
    expect(w.of('guest', 'done')).toHaveLength(1);
    expect(w.of('host', 'done')).toHaveLength(1);
    expect(expectSecretsHidden(w.wireText)).toEqual(['hello', 'hello', 'join', 'accept', 'wifi', 'addr']);
  });

  it('Apple host + Android guest: the guest makes the Wi-Fi', () => {
    const w = wire(APPLE, ANDROID);
    w.start();
    expect(w.guest.state).toBe('done');
    expect(w.host.state).toBe('done');
    expect(w.host.maker).toBe('guest');
    expect(w.of('guest', 'startHotspot')).toHaveLength(1);
    expect(w.of('host', 'joinWifi')).toHaveLength(1);
    expect(w.of('guest', 'connect')).toEqual([{ type: 'connect', ...GUEST_NET_HOST_ADDRS, rejoinKey: REJOIN }]);
    const texts = w.of('guest', 'progress').map((e) => (e as { text: string }).text);
    expect(texts).toContain('Making a Wi-Fi link…');
    expect(texts).toContain('Connected.');
    expect(w.of('host', 'progress').map((e) => (e as { text: string }).text)).toContain("Asking Jane's phone to make a Wi-Fi link…");
    expect(expectSecretsHidden(w.wireText)).toEqual(['hello', 'hello', 'join', 'accept', 'wifi', 'addr']);
  });

  it('Android + Android: the host makes the Wi-Fi', () => {
    const w = wire(ANDROID, ANDROID);
    w.start();
    expect(w.guest.state).toBe('done');
    expect(w.host.maker).toBe('host');
    expect(w.of('guest', 'startHotspot')).toHaveLength(0);
    expectSecretsHidden(w.wireText);
  });

  it('Apple + Apple: both fail with needs-wifi', () => {
    const w = wire(APPLE, APPLE);
    w.start();
    expect(w.host.state).toBe('failed');
    expect(w.guest.state).toBe('failed');
    expect(w.host.failure?.reason).toBe('needs-wifi');
    expect(w.guest.failure?.reason).toBe('needs-wifi');
    expect(w.of('host', 'askApproval')).toHaveLength(0);
    expect(w.of('guest', 'fail')).toHaveLength(1);
  });

  it('decline: the guest fails with declined', () => {
    const w = wire(ANDROID, APPLE, { approve: false });
    w.start();
    expect(w.host.state).toBe('failed');
    expect(w.host.failure?.reason).toBe('declined');
    expect(w.guest.state).toBe('failed');
    expect(w.guest.failure).toEqual({ reason: 'declined', message: 'Sam did not let you in.' });
    expect(w.of('host', 'startHotspot')).toHaveLength(0);
  });

  it('hotspot failure stops both sides', () => {
    const w = wire(APPLE, ANDROID, { hotspot: 'fail' });
    w.start();
    expect(w.guest.failure?.reason).toBe('hotspot');
    expect(w.host.failure?.reason).toBe('hotspot');
    expect(w.host.failure?.message).toBe("Jane's phone cannot make a Wi-Fi link.");
    expect(w.of('guest', 'connect')).toHaveLength(0);
  });

  it('Wi-Fi join failure stops both sides', () => {
    const w = wire(ANDROID, APPLE, { wifi: 'fail' });
    w.start();
    expect(w.guest.failure?.reason).toBe('wifi');
    expect(w.guest.failure?.message).toBe(`This device cannot join the Wi-Fi “${SSID}”.`);
    expect(w.host.failure?.reason).toBe('wifi');
  });

  it('connect failure fails the guest and tells the host', () => {
    const w = wire(ANDROID, APPLE, { connect: 'fail' });
    w.start();
    expect(w.guest.failure?.reason).toBe('connect');
    expect(w.host.failure?.reason).toBe('connect');
  });

  it('timeout while waiting for the approval', () => {
    const w = wire(ANDROID, APPLE, { approve: 'ignore' });
    w.start();
    expect(w.host.state).toBe('approving');
    expect(w.guest.state).toBe('waiting-approval');
    expect(w.of('guest', 'setTimer').at(-1)).toEqual({ type: 'setTimer', ms: TIMERS.approval });
    expect(w.of('host', 'setTimer').at(-1)).toEqual({ type: 'setTimer', ms: TIMERS.approval });
    w.fire('guest', { type: 'TIMEOUT' });
    expect(w.guest.failure?.reason).toBe('timeout');
    expect(w.host.state).toBe('failed');
    expect(w.host.failure?.reason).toBe('timeout');
    // A late approval does nothing.
    expect(w.host.handle({ type: 'APPROVE' })).toEqual([]);
  });

  it('link lost mid-way', () => {
    // hello, hello, join, accept, wifi go; addr and later are lost.
    const w = wire(ANDROID, APPLE, { dropAfter: 5 });
    w.start();
    expect(w.guest.state).toBe('waiting-addr');
    w.fire('guest', { type: 'LINK_LOST' });
    expect(w.guest.failure?.reason).toBe('link-lost');
    expect(w.of('guest', 'send').filter((e) => decodeRendezvous((e as { text: string }).text)?.t === 'error')).toHaveLength(0);
  });

  it('keeps going when the BLE link drops during the TCP connect', () => {
    const w = wire(ANDROID, APPLE);
    const effects: RendezvousEffect[] = [];
    // Drive by hand up to the connect, without the runner answering connect.
    const host = w.host;
    const guest = w.guest;
    const toGuest: string[] = [];
    const toHost: string[] = [];
    const go = (side: Side, out: RendezvousEffect[]) => {
      effects.push(...out);
      for (const e of out) {
        if (e.type === 'send') (side === 'host' ? toGuest : toHost).push(e.text);
        if (e.type === 'askApproval') go('host', host.handle({ type: 'APPROVE' }));
        if (e.type === 'startHotspot') go('host', host.handle({ type: 'HOTSPOT_READY', ssid: SSID, password: PASSWORD }));
        if (e.type === 'needAddresses') go('host', host.handle({ type: 'ADDRESSES', ...HOST_ADDRS }));
        if (e.type === 'joinWifi') go('guest', guest.handle({ type: 'WIFI_JOINED' }));
      }
    };
    go('guest', guest.start());
    for (let i = 0; i < 20 && (toGuest.length || toHost.length); i++) {
      while (toHost.length) go('host', host.handle({ type: 'MESSAGE', text: toHost.shift()! }));
      while (toGuest.length) go('guest', guest.handle({ type: 'MESSAGE', text: toGuest.shift()! }));
    }
    expect(guest.state).toBe('connecting');
    expect(host.state).toBe('waiting-guest');
    expect(guest.handle({ type: 'LINK_LOST' })).toEqual([]);
    expect(host.handle({ type: 'LINK_LOST' })).toEqual([]);
    expect(guest.handle({ type: 'CONNECTED' }).map((e) => e.type)).toEqual(['progress', 'done']);
    expect(host.handle({ type: 'CONNECTED' }).map((e) => e.type)).toEqual(['progress', 'done']);
  });

  it('ignores repeated, out-of-order and bad messages', () => {
    const w = wire(ANDROID, APPLE, { approve: 'ignore' });
    w.start();
    const hellos = w.wireText.filter((t) => decodeRendezvous(t)?.t === 'hello');
    const join = w.wireText.find((t) => decodeRendezvous(t)?.t === 'join')!;
    // A second hello and a second join change nothing.
    expect(w.host.handle({ type: 'MESSAGE', text: hellos[0] })).toEqual([]);
    expect(w.host.handle({ type: 'MESSAGE', text: join })).toEqual([]);
    expect(w.guest.handle({ type: 'MESSAGE', text: hellos[1] })).toEqual([]);
    // Events for other states change nothing.
    expect(w.guest.handle({ type: 'WIFI_JOINED' })).toEqual([]);
    expect(w.guest.handle({ type: 'CONNECTED' })).toEqual([]);
    expect(w.host.handle({ type: 'HOTSPOT_READY', ssid: 'x', password: 'y' })).toEqual([]);
    // Bad text and a box with the wrong key are dropped.
    expect(w.guest.handle({ type: 'MESSAGE', text: 'garbage' })).toEqual([]);
    expect(w.guest.handle({ type: 'MESSAGE', text: encodeRendezvous({ t: 'accept', box: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }) })).toEqual([]);
    // A join box sent as an accept is dropped (the body names its type).
    const joinBox = (decodeRendezvous(join) as { box: string }).box;
    expect(w.guest.handle({ type: 'MESSAGE', text: encodeRendezvous({ t: 'accept', box: joinBox }) })).toEqual([]);
    expect(w.guest.state).toBe('waiting-approval');
    expect(w.host.state).toBe('approving');
    // The flow still completes.
    w.fire('host', { type: 'APPROVE' });
    expect(w.guest.state).toBe('done');
  });

  it('a peer error stops this side without an answer', () => {
    const w = wire(ANDROID, APPLE, { approve: 'ignore' });
    w.start();
    const out = w.guest.handle({ type: 'MESSAGE', text: encodeRendezvous({ t: 'error', reason: 'cancelled' }) });
    expect(out).toEqual([{ type: 'fail', reason: 'cancelled', message: 'Sam stopped.' }]);
    const w2 = wire(ANDROID, APPLE, { approve: 'ignore' });
    w2.start();
    expect(w2.guest.handle({ type: 'MESSAGE', text: encodeRendezvous({ t: 'error', reason: 'weird' }) })[0]).toMatchObject({ reason: 'peer-error' });
  });

  it('cancel tells the peer', () => {
    const w = wire(ANDROID, APPLE, { approve: 'ignore' });
    w.start();
    w.fire('guest', { type: 'CANCEL' });
    expect(w.guest.failure?.reason).toBe('cancelled');
    expect(w.host.failure).toEqual({ reason: 'cancelled', message: 'Jane stopped.' });
    expect(w.guest.handle({ type: 'TIMEOUT' })).toEqual([]);
  });

  it('sets the deadlines of the states', () => {
    const w = wire(ANDROID, APPLE, { approve: 'ignore' });
    w.start();
    expect(w.of('host', 'setTimer')[0]).toEqual({ type: 'setTimer', ms: TIMERS.answer });
    expect(w.of('guest', 'setTimer')[0]).toEqual({ type: 'setTimer', ms: TIMERS.answer });
    w.fire('host', { type: 'APPROVE' });
    const ms = w.of('guest', 'setTimer').map((e) => (e as { ms: number }).ms);
    expect(ms).toEqual([TIMERS.answer, TIMERS.approval, TIMERS.wifi, TIMERS.wifi, TIMERS.answer, TIMERS.connect]);
  });

  it('rejects a bad setup and a host hello for another session', () => {
    const bad = createRendezvous({
      role: 'host',
      self: { name: 'Sam', ...ANDROID },
      session: 'nothex!!',
      rejoinKey: REJOIN,
      keyPair: generateKeyPair(seeded(1)),
      random: seeded(2),
    });
    expect(bad.start()).toEqual([expect.objectContaining({ type: 'fail', reason: 'setup' })]);

    const guest = createRendezvous({
      role: 'guest',
      self: { name: 'Jane', ...APPLE },
      session: 'ffffffff',
      keyPair: generateKeyPair(seeded(3)),
      random: seeded(4),
    });
    guest.start();
    const hello = encodeRendezvous({ t: 'hello', pub: PUB, ...ANDROID, name: 'Sam', session: SESSION });
    expect(guest.handle({ type: 'MESSAGE', text: hello })).toContainEqual(expect.objectContaining({ type: 'fail', reason: 'protocol' }));
  });
});
