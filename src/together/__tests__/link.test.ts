import { NearbyLink } from '../link';
import { encodeLink } from '../protocol';
import { FakeNetwork } from '../test-utils/fake-link';
import { VirtualClock } from '../test-utils/sim';

function setup(sessionKey = 'k'.repeat(20)) {
  const clock = new VirtualClock();
  const net = new FakeNetwork(clock);
  const hostDev = net.device('host');
  const guestDev = net.device('guest');
  const host = new NearbyLink(hostDev, clock, { sessionKey: () => sessionKey, isCodeKey: (k) => k === 'abcd1234' });
  const guest = new NearbyLink(guestDev, clock, { joinTimeout: 5000 });
  const log: string[] = [];
  host.setHandlers({
    onRequest: (e) => log.push(`request ${e.ctx.name} code=${e.code}`),
    onPeerUp: (id, ctx) => log.push(`host up ${ctx?.name}`),
    onPeerDown: (id, e) => log.push(`host down wasUp=${e.wasUp}`),
    onMessage: (id, m) => log.push(`host got ${m.t}`),
  });
  guest.setHandlers({
    onPeerUp: () => log.push('guest up'),
    onPeerDown: (id, e) => log.push(`guest down declined=${e.declined} ${e.reason ?? ''}`.trim()),
    onMessage: (id, m) => log.push(`guest got ${m.t}`),
    onServiceFound: (e) => log.push(`found ${e.serviceId}`),
  });
  host.open();
  guest.open();
  return { clock, net, host, guest, hostDev, guestDev, log };
}

describe('NearbyLink', () => {
  it('asks the host, and carries messages after the accept', async () => {
    const t = setup();
    await t.hostDev.startServer('zgf-1', { v: '1' });
    t.guestDev.startBrowsing();
    expect(t.log).toContain('found zgf-1');
    const peer = t.guest.join({ serviceId: 'zgf-1' }, { v: 1, name: 'Sam', have: false });
    t.clock.advance(10);
    expect(t.log).toContain('request Sam code=false');
    // Messages before the accept do not reach the session.
    t.guestDev.send(peer, JSON.stringify({ v: 1, t: 'leave' }));
    t.clock.advance(10);
    expect(t.log).not.toContain('host got leave');
    const hostPeer = t.host.upPeers[0] ?? [...(t.net.links.values())][0]!.bId;
    t.host.respond(hostPeer, true);
    t.clock.advance(10);
    expect(t.log).toContain('host up Sam');
    expect(t.log).toContain('guest up');
    t.guest.send({ t: 'leave' }, [peer]);
    t.host.send({ t: 'end' });
    t.clock.advance(10);
    expect(t.log).toContain('host got leave');
    expect(t.log).toContain('guest got end');
  });

  it('tells the guest when the host declines', async () => {
    const t = setup();
    await t.hostDev.startServer('zgf-1', {});
    t.guest.join({ serviceId: 'zgf-1' }, { v: 1, name: 'Sam', have: true });
    t.clock.advance(10);
    const hostPeer = [...t.net.links.values()][0]!.bId;
    t.host.respond(hostPeer, false);
    t.clock.advance(400);
    expect(t.log).toContain('guest down declined=true The host did not let you join.');
  });

  it('lets a guest with the session key in with no request', async () => {
    const t = setup('s'.repeat(20));
    await t.hostDev.startServer('zgf-1', {});
    t.guest.join({ serviceId: 'zgf-1' }, { v: 1, name: 'Sam', have: true, key: 's'.repeat(20), memberId: 'm1' });
    t.clock.advance(10);
    expect(t.log.some((l) => l.startsWith('request'))).toBe(false);
    expect(t.log).toContain('host up Sam');
    expect(t.log).toContain('guest up');
  });

  it('marks a join with the code key, and still asks the host', async () => {
    const t = setup();
    await t.hostDev.startServer('zgf-1', {});
    t.guest.join({ host: 'host', port: 1 }, { v: 1, name: 'Sam', have: false, key: 'abcd1234' });
    t.clock.advance(10);
    expect(t.log).toContain('request Sam code=true');
    expect(t.log).not.toContain('guest up');
  });

  it('gives up when the host does not answer', async () => {
    const t = setup();
    await t.hostDev.startServer('zgf-1', {});
    t.guest.join({ serviceId: 'zgf-1' }, { v: 1, name: 'Sam', have: false });
    t.clock.advance(6000);
    expect(t.log).toContain('guest down declined=false The host did not answer.');
  });

  it('reports a lost link of an accepted peer', async () => {
    const t = setup('s'.repeat(20));
    await t.hostDev.startServer('zgf-1', {});
    t.guest.join({ serviceId: 'zgf-1' }, { v: 1, name: 'Sam', have: true, key: 's'.repeat(20) });
    t.clock.advance(10);
    t.net.drop('guest');
    expect(t.log).toContain('host down wasUp=true');
  });

  it('drops a join frame that is not valid', async () => {
    const t = setup();
    await t.hostDev.startServer('zgf-1', {});
    const peer = t.guestDev.connect('zgf-1');
    t.clock.advance(10);
    t.guestDev.send(peer, '{"v":1,"l":"join"}');
    t.guestDev.send(peer, encodeLink({ t: 'accept' }));
    t.clock.advance(10);
    expect(t.log.some((l) => l.startsWith('request') || l.startsWith('host up'))).toBe(false);
  });
});
