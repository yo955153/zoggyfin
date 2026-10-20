/**
 * The nearby advert of a room: it names the room's item, or says that the
 * host picks something (an empty room). Guests read it from Bonjour TXT or
 * from the Bluetooth INFO, and the nearby list shows it.
 */
import { mergeSessions } from '../hub';
import { bleAdvert, decodeAdvert, encodeAdvert, roomAdvert } from '../protocol';
import { decodeInfo, encodeInfo } from '../rendezvous';
import type { NearbyHost } from '../store';

const base = { sessionId: 'session-1', hostName: 'Sam · Mac', epoch: 0, serverId: 'S1' };
const server = { serverId: 'S1', serverName: 'Home' };

function title(host: NearbyHost): string {
  return mergeSessions([host], [], server)[0]!.title;
}

describe('the advert of a room', () => {
  it('names the item, and the change to the next item', () => {
    const first = roomAdvert({ ...base, kind: 'video', itemId: 'f1', title: 'Dune' });
    const next = roomAdvert({ ...base, kind: 'audio', itemId: 't1', title: 'Blue' });
    expect(encodeAdvert(first)).not.toEqual(encodeAdvert(next));
    const seen = decodeAdvert(encodeAdvert(next))!;
    expect(seen).toMatchObject({ itemId: 't1', itemName: 'Blue', kind: 'audio' });
    expect(title({ peerId: 'zgf-1', via: 'network', advert: seen })).toBe('Blue');
  });

  it('says that the host picks something in an empty room', () => {
    const empty = decodeAdvert(encodeAdvert(roomAdvert({ ...base, kind: 'video', itemId: null, title: 'Dune' })))!;
    // An older guest needs an item id: "room" is one, and the title is empty.
    expect(empty).toMatchObject({ itemId: 'room', itemName: '' });
    expect(title({ peerId: 'zgf-1', via: 'network', advert: empty })).toBe('Picking something to play');
  });

  it('reads the Bluetooth INFO the same way', () => {
    const info = (t: string) => decodeInfo(encodeInfo({ v: 1, session: 'a1b2c3d4', host: 'Kim · Pixel', title: t, kind: 'video', platform: 'android', canHotspot: true, canJoinWifi: true }))!;
    expect(title({ peerId: 'b1', via: 'ble', advert: bleAdvert(info('Arrival')) })).toBe('Arrival');
    expect(title({ peerId: 'b1', via: 'ble', advert: bleAdvert(info('')) })).toBe('Picking something to play');
  });
});
