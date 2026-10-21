import { chooseGuestVideoSource, guestKeepsPlayer, noAccessText } from '../guest-source';

const base = 'http://10.0.0.2:5000';
const facts = { ownFile: null, base, activeServerId: null, serverReachable: true };

describe('chooseGuestVideoSource', () => {
  it('plays the guest’s own download first', () => {
    expect(chooseGuestVideoSource({ serverId: 'S1', path: '/t/1.mp4' }, { ...facts, ownFile: 'file:///d/1.mp4', activeServerId: 'S1' })).toEqual({ kind: 'local', uri: 'file:///d/1.mp4' });
  });

  it('streams from the item’s server, not from the host, when the guest is signed in there', () => {
    // The host has a download and shares it, but the guest reaches the same server: the host's upload stays free.
    expect(chooseGuestVideoSource({ serverId: 'S1', path: '/t/1.mp4' }, { ...facts, activeServerId: 'S1' })).toEqual({ kind: 'server' });
  });

  it('reads the host’s file when the guest cannot reach the item’s server', () => {
    expect(chooseGuestVideoSource({ serverId: 'S1', path: '/t/1.mp4' }, { ...facts, activeServerId: 'S1', serverReachable: false })).toEqual({ kind: 'host', uri: `${base}/t/1.mp4` });
  });

  it('reads the host’s file when the guest is signed in to another server', () => {
    expect(chooseGuestVideoSource({ serverId: 'S1', path: '/t/1.mp4' }, { ...facts, activeServerId: 'S2' })).toEqual({ kind: 'host', uri: `${base}/t/1.mp4` });
  });

  it('reads the host’s file when the guest is not signed in', () => {
    expect(chooseGuestVideoSource({ serverId: 'S1', path: '/t/1.mp4' }, facts)).toEqual({ kind: 'host', uri: `${base}/t/1.mp4` });
  });

  it('streams from the same server when the host streams and the guest is signed in there', () => {
    expect(chooseGuestVideoSource({ serverId: 'S1', path: null }, { ...facts, activeServerId: 'S1' })).toEqual({ kind: 'server' });
  });

  it('tries the server when the host has no file, even after a failed check', () => {
    expect(chooseGuestVideoSource({ serverId: 'S1', path: null }, { ...facts, activeServerId: 'S1', serverReachable: false })).toEqual({ kind: 'server' });
  });

  it('does not stream from another server', () => {
    expect(chooseGuestVideoSource({ serverId: 'S1', path: null }, { ...facts, activeServerId: 'S2' })).toEqual({ kind: 'none', reason: 'no-access' });
  });

  it('never relays a server stream through the host', () => {
    // No host file, guest not signed in: no source, even with a host address.
    expect(chooseGuestVideoSource({ serverId: 'S1', path: null }, facts).kind).toBe('none');
  });

  it('a forced stream (development) skips the own file and the server', () => {
    expect(chooseGuestVideoSource({ serverId: 'S1', path: '/t/1.mp4' }, { ...facts, ownFile: 'file:///d/1.mp4', activeServerId: 'S1', forceStream: true }).kind).toBe('host');
  });

  it('says plainly what to do', () => {
    expect(noAccessText('Sam · iPhone')).toBe('Sam · iPhone streams this from a server you are not signed in to. Ask them to download it first, or sign in to that server.');
  });
});

describe('guestKeepsPlayer (the session ends, or the guest leaves)', () => {
  it('keeps the player of a guest that streams from its own server: it plays on alone, and Continue Watching has the position', () => {
    expect(guestKeepsPlayer('server', true)).toBe(true);
  });

  it('keeps the player of a guest that plays its own download', () => {
    expect(guestKeepsPlayer('local', true)).toBe(true);
  });

  it('closes the player that reads the host’s file: the file is gone with the host', () => {
    expect(guestKeepsPlayer('stream', true)).toBe(false);
  });

  it('closes the player of a guest with no account (it has no player outside the session)', () => {
    expect(guestKeepsPlayer('local', false)).toBe(false);
    expect(guestKeepsPlayer('server', false)).toBe(false);
  });

  it('has nothing to keep when nothing played', () => {
    expect(guestKeepsPlayer(null, true)).toBe(false);
  });
});
