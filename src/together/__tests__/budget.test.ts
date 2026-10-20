import { fileBitrateMbps, hostPath, streamBudget, streamingFromHost, streamWarning } from '../budget';
import type { Member } from '../protocol';

const wifi = { name: 'en0', address: '192.0.2.4', kind: 'wifi' as const };
const eth = { name: 'en5', address: '192.0.2.5', kind: 'ethernet' as const };
const bridge = { name: 'bridge100', address: '172.20.10.1', kind: 'hotspot' as const };

describe('stream budget', () => {
  it('follows the report table at 8 Mbit/s', () => {
    expect(streamBudget('wifi-phone', 8)).toBe(8);
    expect(streamBudget('wifi-mac', 8)).toBe(10);
    expect(streamBudget('ethernet', 8)).toBe(15);
    expect(streamBudget('awdl', 8)).toBe(4);
    expect(streamBudget('hotspot', 8)).toBe(3);
  });

  it('gets smaller for a large file, and never goes under 1', () => {
    expect(streamBudget('wifi-phone', 20)).toBe(3);
    expect(streamBudget('hotspot', 40)).toBe(1);
  });

  it('uses 8 Mbit/s when the bitrate is unknown', () => {
    expect(streamBudget('wifi-phone', null)).toBe(8);
  });

  it('finds the path from the addresses', () => {
    expect(hostPath({ platform: 'ios', addresses: [wifi], hotspot: false })).toBe('wifi-phone');
    expect(hostPath({ platform: 'mac', addresses: [wifi], hotspot: false })).toBe('wifi-mac');
    expect(hostPath({ platform: 'mac', addresses: [wifi, eth], hotspot: false })).toBe('ethernet');
    expect(hostPath({ platform: 'ios', addresses: [], hotspot: false })).toBe('awdl');
    expect(hostPath({ platform: 'ios', addresses: [wifi, bridge], hotspot: false })).toBe('hotspot');
    expect(hostPath({ platform: 'android', addresses: [wifi], hotspot: true })).toBe('hotspot');
  });

  it('computes the bitrate from the size and the run time', () => {
    // 3.6 GB over 1 hour = 8 Mbit/s.
    expect(fileBitrateMbps(3_600_000_000, 36_000_000_000)).toBeCloseTo(8, 5);
    expect(fileBitrateMbps(null, 1)).toBeNull();
    expect(fileBitrateMbps(1, 0)).toBeNull();
  });

  it('counts only the guests that stream from the host', () => {
    const m = (x: Partial<Member>): Member => ({ id: 'x', name: 'x', local: false, buffering: false, ...x });
    expect(streamingFromHost([m({}), m({ local: true }), m({ server: true }), m({ away: true }), m({})])).toBe(2);
  });
});

describe('stream warning', () => {
  it('says nothing while the streams fit', () => {
    expect(streamWarning({ path: 'wifi-phone', bitrateMbps: 8, streaming: 8 })).toBeNull();
    expect(streamWarning({ path: 'wifi-phone', bitrateMbps: 8, streaming: 0 })).toBeNull();
  });

  it('warns the host above the budget', () => {
    expect(streamWarning({ path: 'wifi-phone', bitrateMbps: 8, streaming: 9 })).toEqual({
      tone: 'warning',
      text: 'More than 8 people stream from you. Playback may stutter. Ask them to download first.',
    });
  });

  it('has its own lines on a hotspot', () => {
    expect(streamWarning({ path: 'hotspot', bitrateMbps: 8, streaming: 1 })).toEqual({
      tone: 'note',
      text: 'Guests on your hotspot should download the video first. Streaming from your phone works for 3 guests at most.',
    });
    expect(streamWarning({ path: 'hotspot', bitrateMbps: 8, streaming: 4 })?.text).toBe(
      'More than 3 people stream from your hotspot. Playback may stutter. Ask them to download first.',
    );
  });

  it('says when the file is large', () => {
    expect(streamWarning({ path: 'ethernet', bitrateMbps: 20, streaming: 1 })?.tone).toBe('note');
  });
});
