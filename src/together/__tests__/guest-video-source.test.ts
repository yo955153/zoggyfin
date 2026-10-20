import { chooseGuestVideoSource, noAccessText } from '../guest-source';

const base = 'http://10.0.0.2:5000';
const facts = { ownFile: null, base, activeServerId: null };

describe('chooseGuestVideoSource', () => {
  it('plays the guest’s own download first', () => {
    expect(chooseGuestVideoSource({ serverId: 'S1', path: '/t/1.mp4' }, { ...facts, ownFile: 'file:///d/1.mp4' })).toEqual({ kind: 'local', uri: 'file:///d/1.mp4' });
  });

  it('reads the host’s file when the host has a download', () => {
    expect(chooseGuestVideoSource({ serverId: 'S1', path: '/t/1.mp4' }, facts)).toEqual({ kind: 'host', uri: `${base}/t/1.mp4` });
  });

  it('streams from the same server when the host streams and the guest is signed in there', () => {
    expect(chooseGuestVideoSource({ serverId: 'S1', path: null }, { ...facts, activeServerId: 'S1' })).toEqual({ kind: 'server' });
  });

  it('does not stream from another server', () => {
    expect(chooseGuestVideoSource({ serverId: 'S1', path: null }, { ...facts, activeServerId: 'S2' })).toEqual({ kind: 'none', reason: 'no-access' });
  });

  it('never relays a server stream through the host', () => {
    // No host file, guest not signed in: no source, even with a host address.
    expect(chooseGuestVideoSource({ serverId: 'S1', path: null }, facts).kind).toBe('none');
  });

  it('a forced stream (development) skips the own file', () => {
    expect(chooseGuestVideoSource({ serverId: 'S1', path: '/t/1.mp4' }, { ...facts, ownFile: 'file:///d/1.mp4', forceStream: true }).kind).toBe('host');
  });

  it('says plainly what to do', () => {
    expect(noAccessText('Sam · iPhone')).toBe('Sam · iPhone streams this from a server you are not signed in to. Ask them to download it first, or sign in to that server.');
  });
});
