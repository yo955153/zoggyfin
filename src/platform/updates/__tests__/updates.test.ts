import { initialUpdateState, isBusy, retryAction, type UpdateEvent, updateReducer, type UpdateState } from '../machine';
import { parseReleaseNotes, progressFraction, progressLabel } from '../notes';
import { compareVersions, isNewer, isVersion } from '../version';

describe('compareVersions', () => {
  it('orders major, minor and patch as numbers', () => {
    expect(compareVersions('0.1.0', '0.1.1')).toBe(-1);
    expect(compareVersions('0.2.0', '0.1.9')).toBe(1);
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
  });

  it('puts a prerelease before its release', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1);
    expect(compareVersions('1.0.0-beta', '1.0.0-beta.1')).toBe(-1);
  });

  it('ignores build metadata and puts invalid versions first', () => {
    expect(compareVersions('1.0.0+abc', '1.0.0')).toBe(0);
    expect(compareVersions('nonsense', '0.0.1')).toBe(-1);
    expect(compareVersions('0.0.1', '')).toBe(1);
    expect(isVersion('1.2')).toBe(false);
    expect(isNewer('0.1.1', '0.1.0')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
  });
});

describe('parseReleaseNotes', () => {
  it('has no lines for empty notes or only "Zoggyfin X"', () => {
    expect(parseReleaseNotes(null)).toEqual([]);
    expect(parseReleaseNotes('  ')).toEqual([]);
    expect(parseReleaseNotes('Zoggyfin 0.1.1')).toEqual([]);
  });

  it('turns bullets into plain lines and drops headings', () => {
    expect(parseReleaseNotes('## 0.1.1\n\n- **Faster** start\n* `⌘F` opens Search\n1. One\n[Link](https://x) text')).toEqual([
      'Faster start',
      '⌘F opens Search',
      'One',
      'Link text',
    ]);
  });

  it('cuts long lines and long lists', () => {
    expect(parseReleaseNotes('x'.repeat(300))[0]).toHaveLength(140);
    expect(parseReleaseNotes(Array.from({ length: 30 }, (_, i) => `- ${i}`).join('\n'))).toHaveLength(12);
  });

  it('formats the progress', () => {
    expect(progressLabel(12_300_000, 40_000_000)).toBe('12.3 MB of 40.0 MB');
    expect(progressLabel(5_000_000, 0)).toBe('5.0 MB');
    expect(progressFraction(5, 10)).toBe(0.5);
    expect(progressFraction(5, 0)).toBe(0);
    expect(progressFraction(20, 10)).toBe(1);
  });
});

const offer = (version: string) => ({ version, notes: ['A fix'], date: null });
const run = (state: UpdateState, ...events: UpdateEvent[]) => events.reduce(updateReducer, state);

describe('updateReducer', () => {
  const start = initialUpdateState('0.1.0');

  it('opens the card when an automatic check finds a newer version', () => {
    const s = run(start, { type: 'check', manual: false });
    expect(s.phase.kind).toBe('checking');
    expect(s.open).toBe(false);
    const found = updateReducer(s, { type: 'found', offer: offer('0.1.1'), at: 1 });
    expect(found.phase.kind).toBe('available');
    expect(found.open).toBe(true);
    expect(found.checkedAt).toBe(1);
  });

  it('stays quiet when an automatic check finds nothing or fails', () => {
    expect(run(start, { type: 'check', manual: false }, { type: 'none', at: 1 })).toMatchObject({ phase: { kind: 'idle' }, open: false });
    expect(run(start, { type: 'check', manual: false }, { type: 'failed', message: 'offline' })).toMatchObject({
      phase: { kind: 'idle' },
      open: false,
    });
  });

  it('shows "newest version" and errors after a manual check', () => {
    const none = run(start, { type: 'check', manual: true }, { type: 'none', at: 2 });
    expect(none).toMatchObject({ phase: { kind: 'current' }, open: true });
    const failed = run(start, { type: 'check', manual: true }, { type: 'failed', message: 'HTTP 404' });
    expect(failed.phase).toEqual({ kind: 'error', step: 'check', message: 'HTTP 404' });
    expect(failed.open).toBe(true);
    expect(retryAction(failed)).toBe('check');
    expect(run(failed, { type: 'close' })).toMatchObject({ phase: { kind: 'idle' }, open: false });
  });

  it('does not offer a version that is not newer', () => {
    const s = run(start, { type: 'check', manual: true }, { type: 'found', offer: offer('0.1.0'), at: 1 });
    expect(s.phase.kind).toBe('current');
    expect(s.offer).toBeNull();
  });

  it('keeps "Later" for that version only; a manual check opens the card anyway', () => {
    const found = run(start, { type: 'check', manual: false }, { type: 'found', offer: offer('0.1.1'), at: 1 });
    const later = updateReducer(found, { type: 'later' });
    expect(later).toMatchObject({ open: false, later: '0.1.1', phase: { kind: 'available' } });
    const again = run(later, { type: 'check', manual: false }, { type: 'found', offer: offer('0.1.1'), at: 2 });
    expect(again.open).toBe(false);
    const manual = run(later, { type: 'check', manual: true }, { type: 'found', offer: offer('0.1.1'), at: 3 });
    expect(manual.open).toBe(true);
    const newer = run(later, { type: 'check', manual: false }, { type: 'found', offer: offer('0.1.2'), at: 4 });
    expect(newer.open).toBe(true);
    expect(run(later, { type: 'reopen' }).open).toBe(true);
  });

  it('downloads with progress, then installs', () => {
    const found = run(start, { type: 'check', manual: false }, { type: 'found', offer: offer('0.1.1'), at: 1 });
    const dl = run(found, { type: 'install' }, { type: 'progress', done: 5, total: 10 });
    expect(dl.phase).toEqual({ kind: 'downloading', done: 5, total: 10 });
    expect(isBusy(dl)).toBe(true);
    // Nothing stops a download: no "Later", no new check, no second install.
    expect(run(dl, { type: 'later' }, { type: 'close' }, { type: 'install' }, { type: 'check', manual: false })).toEqual(dl);
    const inst = updateReducer(dl, { type: 'downloaded' });
    expect(inst.phase.kind).toBe('installing');
    expect(updateReducer(inst, { type: 'progress', done: 1, total: 2 })).toBe(inst);
  });

  it('shows a failed download or install and retries the same step', () => {
    const found = run(start, { type: 'check', manual: false }, { type: 'found', offer: offer('0.1.1'), at: 1 });
    const dlFail = run(found, { type: 'install' }, { type: 'failed', message: 'signature' });
    expect(dlFail.phase).toEqual({ kind: 'error', step: 'download', message: 'signature' });
    expect(retryAction(dlFail)).toBe('install');
    const instFail = run(found, { type: 'install' }, { type: 'downloaded' }, { type: 'failed', message: '' });
    expect(instFail.phase).toEqual({ kind: 'error', step: 'install', message: 'Unknown error.' });
    expect(updateReducer(instFail, { type: 'install' }).phase.kind).toBe('downloading');
    expect(run(instFail, { type: 'later' })).toMatchObject({ phase: { kind: 'available' }, open: false });
  });

  it('does nothing for an install with no offer', () => {
    expect(updateReducer(start, { type: 'install' })).toBe(start);
    expect(retryAction(start)).toBeNull();
  });
});
