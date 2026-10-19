import { addServer, EMPTY_ACCOUNTS } from '../accounts';

describe('addServer', () => {
  it('saves a server with no user and keeps the active account', () => {
    const d = addServer({ ...EMPTY_ACCOUNTS, active: null }, { serverId: 's1', serverName: 'Family', addresses: [{ url: 'http://100.64.0.1:8096', kind: 'external' }] });
    expect(d.servers).toHaveLength(1);
    expect(d.servers[0]).toMatchObject({ id: 's1', name: 'Family', users: [], addresses: [{ url: 'http://100.64.0.1:8096', kind: 'external' }] });
    expect(d.active).toBeNull();
  });

  it('adds only new addresses to a saved server', () => {
    const one = addServer(EMPTY_ACCOUNTS, { serverId: 's1', serverName: 'Family', addresses: [{ url: 'https://a.example', kind: 'external' }] });
    const two = addServer(one, { serverId: 's1', serverName: 'X', addresses: [{ url: 'https://a.example', kind: 'external' }, { url: 'http://10.0.0.2', kind: 'internal' }] });
    expect(two.servers[0].name).toBe('Family');
    expect(two.servers[0].addresses.map((a) => a.url)).toEqual(['https://a.example', 'http://10.0.0.2']);
  });

  it('does not save a new server with no address', () => {
    expect(addServer(EMPTY_ACCOUNTS, { serverId: 's1', serverName: 'F', addresses: [] }).servers).toEqual([]);
  });
});
