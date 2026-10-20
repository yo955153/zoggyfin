import { deviceKey, JoinGate, MAX_GUESTS, REFUSAL_TEXT } from '../join-gate';
import { NearbyLink } from '../link';
import type { JoinContext } from '../protocol';
import { FakeNetwork } from '../test-utils/fake-link';
import { VirtualClock } from '../test-utils/sim';

const KEY = 'k'.repeat(20);

/** A host link with the join gate wired in, as nearby.ts does. */
function setup(opts: { guests?: number } = {}) {
  const clock = new VirtualClock();
  const net = new FakeNetwork(clock);
  const hostDev = net.device('host');
  const gate = new JoinGate(() => clock.t);
  const pending: { peerId: string; device: string; at: number }[] = [];
  const host = new NearbyLink(hostDev, clock, {
    sessionKey: () => KEY,
    admit: ({ peerId, ctx, withKey }) => {
      const device = deviceKey(peerId, ctx.memberId);
      if (withKey) {
        const back = gate.screenReturn(device);
        if (back === null) return 'ok';
        if (back !== 'ask') return { refuse: REFUSAL_TEXT[back] };
      }
      const r = gate.screen(device, { guests: opts.guests ?? 0, pending });
      return r ? { refuse: REFUSAL_TEXT[r] } : 'ask';
    },
  });
  const log: string[] = [];
  host.setHandlers({
    onRequest: (e) => {
      pending.push({ peerId: e.peerId, device: deviceKey(e.peerId, e.ctx.memberId), at: clock.t });
      log.push(`request ${e.ctx.name}`);
    },
    onPeerUp: (_id, ctx) => log.push(`up ${ctx?.name}`),
  });
  host.open();
  const guest = (name: string) => {
    const dev = net.device(`g-${name}-${Math.random()}`);
    const link = new NearbyLink(dev, clock, { joinTimeout: 5000 });
    const out: string[] = [];
    link.setHandlers({ onPeerUp: () => out.push('in'), onPeerDown: (_id, e) => out.push(`out ${e.reason ?? ''}`) });
    link.open();
    return { link, out, join: (ctx: Partial<JoinContext>) => link.join({ serviceId: 'zgf-1' }, { v: 1, name, have: false, ...ctx }) };
  };
  return { clock, hostDev, host, gate, log, guest };
}

describe('the join gate in the host link', () => {
  it('refuses at once, with no prompt, while the session is locked', async () => {
    const t = setup();
    await t.hostDev.startServer('zgf-1', {});
    t.gate.locked = true;
    const g = t.guest('Sam');
    g.join({ memberId: 'a' });
    t.clock.advance(400);
    expect(t.log).toEqual([]);
    expect(g.out).toEqual([`out ${REFUSAL_TEXT.locked}`]);
  });

  it('tells a guest that the session is full', async () => {
    const t = setup({ guests: MAX_GUESTS });
    await t.hostDev.startServer('zgf-1', {});
    const g = t.guest('Sam');
    g.join({ memberId: 'a' });
    t.clock.advance(400);
    expect(g.out).toEqual([`out ${REFUSAL_TEXT.full}`]);
  });

  it('refuses a blocked device even with the session key', async () => {
    const t = setup();
    await t.hostDev.startServer('zgf-1', {});
    t.gate.remove('m:a', true);
    const g = t.guest('Renamed');
    g.join({ memberId: 'a', key: KEY });
    t.clock.advance(400);
    expect(t.log).toEqual([]);
    expect(g.out).toEqual([`out ${REFUSAL_TEXT.blocked}`]);
  });

  it('makes a removed device ask again instead of using its key', async () => {
    const t = setup();
    await t.hostDev.startServer('zgf-1', {});
    t.gate.remove('m:a', false);
    t.guest('Sam').join({ memberId: 'a', key: KEY });
    t.clock.advance(50);
    expect(t.log).toEqual(['request Sam']);
  });

  it('lets a member with the key back in at once', async () => {
    const t = setup();
    await t.hostDev.startServer('zgf-1', {});
    const g = t.guest('Sam');
    g.join({ memberId: 'a', key: KEY });
    t.clock.advance(50);
    expect(t.log).toEqual(['up Sam']);
    expect(g.out).toEqual(['in']);
  });

  it('allows one pending request per device', async () => {
    const t = setup();
    await t.hostDev.startServer('zgf-1', {});
    t.guest('Sam').join({ memberId: 'a' });
    t.clock.advance(50);
    const again = t.guest('Sam');
    again.join({ memberId: 'a' });
    t.clock.advance(400);
    expect(t.log).toEqual(['request Sam']);
    expect(again.out).toEqual([`out ${REFUSAL_TEXT.duplicate}`]);
  });
});
