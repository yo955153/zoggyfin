import type { SessionInfoDto, TaskInfo, UserPolicy } from '@jellyfin/sdk/lib/generated-client/models';

import {
  activityMatches,
  appendLogChunk,
  bitrateLimitLabel,
  buildPolicyUpdate,
  describeChanges,
  draftFrom,
  formatBitrate,
  formatDiskSize,
  groupTasks,
  hasLibrary,
  logLineLevel,
  nextActivityStart,
  nextLogRange,
  nextRun,
  parentalRatingOptions,
  parseContentRange,
  playMethodLabel,
  policyDiff,
  refreshDelay,
  searchLines,
  sessionPlayInfo,
  sortSessions,
  taskStatus,
  toggleLibrary,
  transcodeReasonLabel,
  transcodeReasonsText,
  usedShare,
  webDashboardUrl,
} from '../logic';

const TICKS = 10_000_000;

describe('play method and transcode reason labels', () => {
  it('names the three play methods', () => {
    expect(playMethodLabel('DirectPlay')).toBe('Direct Play');
    expect(playMethodLabel('DirectStream')).toBe('Direct Stream');
    expect(playMethodLabel('Transcode')).toBe('Transcode');
    expect(playMethodLabel(undefined)).toBeNull();
  });
  it('gives plain reasons, and splits unknown reasons into words', () => {
    expect(transcodeReasonLabel('VideoCodecNotSupported')).toBe('Video codec not supported');
    expect(transcodeReasonLabel('ContainerBitrateExceedsLimit')).toBe('Bitrate is above the limit');
    expect(transcodeReasonLabel('SomethingNewInServer')).toBe('Something New In Server');
    expect(transcodeReasonsText(['AudioCodecNotSupported', 'SubtitleCodecNotSupported'])).toBe('Audio codec not supported, Subtitle format not supported');
    expect(transcodeReasonsText([])).toBeNull();
  });
  it('formats bitrates', () => {
    expect(formatBitrate(8_400_000)).toBe('8.4 Mbps');
    expect(formatBitrate(120_000_000)).toBe('120 Mbps');
    expect(formatBitrate(20_000_000)).toBe('20 Mbps');
    expect(formatBitrate(320_000)).toBe('320 kbps');
    expect(formatBitrate(0)).toBeNull();
  });
});

describe('sessionPlayInfo', () => {
  const base: SessionInfoDto = { Id: 's', NowPlayingItem: { RunTimeTicks: 100 * TICKS, MediaSources: [{ Id: 'm', Bitrate: 4_000_000 }] } };
  it('reads a transcode with reasons, details and job progress', () => {
    const info = sessionPlayInfo({
      ...base,
      PlayState: { PlayMethod: 'Transcode', PositionTicks: 25 * TICKS, MediaSourceId: 'm' },
      TranscodingInfo: { VideoCodec: 'h264', AudioCodec: 'aac', IsVideoDirect: false, IsAudioDirect: true, Bitrate: 8_000_000, CompletionPercentage: 41.6, HardwareAccelerationType: 'vaapi', TranscodeReasons: ['VideoCodecNotSupported'] },
    });
    expect(info).toMatchObject({ method: 'Transcode', isTranscode: true, reasons: 'Video codec not supported', bitrate: '8 Mbps', progress: 0.25, transcodePercent: 42 });
    expect(info.detail).toBe('Video → H264 · Audio AAC (direct) · HW vaapi');
  });
  it('uses the source bitrate for Direct Play and has no reasons', () => {
    const info = sessionPlayInfo({ ...base, PlayState: { PlayMethod: 'DirectPlay', PositionTicks: 0, MediaSourceId: 'm', IsPaused: true } });
    expect(info).toMatchObject({ method: 'Direct Play', isTranscode: false, reasons: null, bitrate: '4 Mbps', paused: true, progress: 0 });
  });
  it('guesses the method from the transcode job when the play state has none', () => {
    expect(sessionPlayInfo({ ...base, PlayState: {}, TranscodingInfo: { IsVideoDirect: false, IsAudioDirect: true } }).method).toBe('Transcode');
    expect(sessionPlayInfo({ ...base, PlayState: {}, TranscodingInfo: { IsVideoDirect: true, IsAudioDirect: true } }).method).toBe('Direct Stream');
  });
  it('has no progress without a run time', () => {
    expect(sessionPlayInfo({ Id: 'x', NowPlayingItem: {}, PlayState: { PositionTicks: 5 } }).progress).toBeNull();
  });
  it('sorts playing sessions first, then by last activity', () => {
    const list = sortSessions([
      { Id: 'idle-new', LastActivityDate: '2026-10-19T10:00:00Z' },
      { Id: 'play-old', NowPlayingItem: {}, LastActivityDate: '2026-10-19T08:00:00Z' },
      { Id: 'play-new', NowPlayingItem: {}, LastActivityDate: '2026-10-19T09:00:00Z' },
    ]);
    expect(list.map((s) => s.Id)).toEqual(['play-new', 'play-old', 'idle-new']);
  });
});

describe('refreshDelay (session refresh scheduling)', () => {
  it('refreshes every 5 s while the screen is open and the app is active', () => {
    expect(refreshDelay({ focused: true, appActive: true, failures: 0 })).toBe(5000);
  });
  it('stops when the screen is not in front or the app is in the background', () => {
    expect(refreshDelay({ focused: false, appActive: true, failures: 0 })).toBe(false);
    expect(refreshDelay({ focused: true, appActive: false, failures: 0 })).toBe(false);
  });
  it('waits longer after failures, up to one minute', () => {
    expect(refreshDelay({ focused: true, appActive: true, failures: 1 })).toBe(10_000);
    expect(refreshDelay({ focused: true, appActive: true, failures: 2 })).toBe(20_000);
    expect(refreshDelay({ focused: true, appActive: true, failures: 30 })).toBe(60_000);
    expect(refreshDelay({ focused: true, appActive: true, failures: 0, base: 2000 })).toBe(2000);
  });
});

describe('policy diff and patch', () => {
  const saved: UserPolicy = {
    IsAdministrator: false,
    EnableAllFolders: true,
    EnabledFolders: [],
    EnableContentDownloading: true,
    EnableRemoteAccess: true,
    EnableVideoPlaybackTranscoding: true,
    EnableAudioPlaybackTranscoding: true,
    SyncPlayAccess: 'CreateAndJoinGroups',
    RemoteClientBitrateLimit: 0,
    MaxParentalRating: null,
    IsDisabled: false,
    BlockedTags: ['keep-me'],
    AuthenticationProviderId: 'auth',
    PasswordResetProviderId: 'reset',
  };

  it('finds no change in a fresh draft', () => {
    expect(policyDiff(saved, draftFrom(saved))).toEqual([]);
    expect(buildPolicyUpdate(saved, draftFrom(saved))).toBeNull();
  });
  it('treats a missing value and null as the same', () => {
    const { MaxParentalRating: _m, ...noRating } = saved;
    expect(policyDiff(noRating as UserPolicy, { MaxParentalRating: null })).toEqual([]);
  });
  it('compares folder lists without order', () => {
    expect(policyDiff({ ...saved, EnabledFolders: ['a', 'b'] }, { EnabledFolders: ['b', 'a'] })).toEqual([]);
  });
  it('changes only edited fields and keeps every other field of the policy', () => {
    const draft = { ...draftFrom(saved), EnableContentDownloading: false, RemoteClientBitrateLimit: 8_000_000 };
    expect(policyDiff(saved, draft)).toEqual(['EnableContentDownloading', 'RemoteClientBitrateLimit']);
    const next = buildPolicyUpdate(saved, draft);
    expect(next).toEqual({ ...saved, EnableContentDownloading: false, RemoteClientBitrateLimit: 8_000_000 });
    expect(next?.BlockedTags).toEqual(['keep-me']);
    expect(next?.AuthenticationProviderId).toBe('auth');
  });
  it('empties the folder list when all libraries are on', () => {
    const limited = { ...saved, EnableAllFolders: false, EnabledFolders: ['a'] };
    const next = buildPolicyUpdate(limited, { EnableAllFolders: true, EnabledFolders: ['a'] });
    expect(next?.EnableAllFolders).toBe(true);
    expect(next?.EnabledFolders).toEqual([]);
  });
  it('describes the changes in words', () => {
    expect(describeChanges(['EnableContentDownloading'])).toBe('downloads');
    expect(describeChanges(['EnableAllFolders', 'EnabledFolders', 'MaxParentalRating', 'SyncPlayAccess'])).toBe('library access, parental rating and SyncPlay');
  });
  it('turns one library off from "all libraries"', () => {
    const r = toggleLibrary({ EnableAllFolders: true, EnabledFolders: [] }, ['a', 'b', 'c'], 'b', false);
    expect(r).toEqual({ EnableAllFolders: false, EnabledFolders: ['a', 'c'] });
    expect(hasLibrary(r, 'b')).toBe(false);
    expect(hasLibrary(r, 'a')).toBe(true);
  });
  it('goes back to "all libraries" when the last library is turned on', () => {
    expect(toggleLibrary({ EnableAllFolders: false, EnabledFolders: ['a', 'c'] }, ['a', 'b', 'c'], 'b', true)).toEqual({ EnableAllFolders: true, EnabledFolders: [] });
  });
  it('drops library Ids that the server no longer has', () => {
    expect(toggleLibrary({ EnableAllFolders: false, EnabledFolders: ['gone', 'a'] }, ['a', 'b', 'c'], 'c', true)).toEqual({ EnableAllFolders: false, EnabledFolders: ['a', 'c'] });
  });
  it('labels bitrate limits', () => {
    expect(bitrateLimitLabel(0)).toBe('No limit');
    expect(bitrateLimitLabel(8_000_000)).toBe('8 Mbps');
    expect(bitrateLimitLabel(7_500_000)).toBe('7.5 Mbps');
  });
  it('groups parental ratings by score', () => {
    const opts = parentalRatingOptions([
      { Name: 'PG', Value: 10 },
      { Name: 'TV-PG', Value: 10 },
      { Name: 'G', Value: 0 },
      { Name: 'Unrated', Value: null },
    ]);
    expect(opts).toEqual([
      { value: null, label: 'No limit' },
      { value: 0, label: 'G' },
      { value: 10, label: 'PG, TV-PG' },
    ]);
  });
});

describe('scheduled tasks', () => {
  const now = new Date(2026, 9, 19, 12, 0, 0); // Monday 19 October 2026, 12:00 local
  const H = 3600 * TICKS;
  it('finds the next daily run today or tomorrow', () => {
    expect(nextRun([{ Type: 'DailyTrigger', TimeOfDayTicks: 15 * H }], null, now)).toEqual(new Date(2026, 9, 19, 15, 0, 0));
    expect(nextRun([{ Type: 'DailyTrigger', TimeOfDayTicks: 3 * H }], null, now)).toEqual(new Date(2026, 9, 20, 3, 0, 0));
  });
  it('finds the next weekly run on its day', () => {
    expect(nextRun([{ Type: 'WeeklyTrigger', DayOfWeek: 'Sunday', TimeOfDayTicks: 3 * H }], null, now)).toEqual(new Date(2026, 9, 25, 3, 0, 0));
  });
  it('counts an interval from the end of the last run', () => {
    const lastEnd = new Date(2026, 9, 19, 10, 0, 0).toISOString();
    expect(nextRun([{ Type: 'IntervalTrigger', IntervalTicks: 12 * H }], lastEnd, now)).toEqual(new Date(2026, 9, 19, 22, 0, 0));
  });
  it('moves an overdue interval to the future', () => {
    const lastEnd = new Date(2026, 9, 18, 10, 0, 0).toISOString();
    const at = nextRun([{ Type: 'IntervalTrigger', IntervalTicks: 1 * H }], lastEnd, now);
    expect(at!.getTime()).toBeGreaterThan(now.getTime());
    expect(at!.getTime() - now.getTime()).toBeLessThanOrEqual(3600_000);
  });
  it('takes the earliest trigger and ignores startup triggers', () => {
    expect(nextRun([{ Type: 'StartupTrigger' }], null, now)).toBeNull();
    expect(nextRun([{ Type: 'DailyTrigger', TimeOfDayTicks: 20 * H }, { Type: 'DailyTrigger', TimeOfDayTicks: 13 * H }], null, now)).toEqual(new Date(2026, 9, 19, 13, 0, 0));
  });
  it('gives a status for each state', () => {
    const t = (p: Partial<TaskInfo>): TaskInfo => ({ Name: 'x', ...p });
    expect(taskStatus(t({ State: 'Running', CurrentProgressPercentage: 37.4 }))).toEqual({ tone: 'running', label: 'Running · 37 %' });
    expect(taskStatus(t({ State: 'Idle', LastExecutionResult: { Status: 'Failed' } })).tone).toBe('failed');
    expect(taskStatus(t({ State: 'Idle', LastExecutionResult: { Status: 'Completed' } })).label).toBe('Completed');
    expect(taskStatus(t({ State: 'Idle' })).tone).toBe('never');
  });
  it('groups visible tasks by category', () => {
    const g = groupTasks([
      { Name: 'B', Category: 'Library' },
      { Name: 'A', Category: 'Library' },
      { Name: 'Hidden', Category: 'Library', IsHidden: true },
      { Name: 'C', Category: 'Application' },
    ]);
    expect(g.map((x) => [x.category, x.tasks.map((t) => t.Name)])).toEqual([
      ['Application', ['C']],
      ['Library', ['A', 'B']],
    ]);
  });
});

describe('activity filters and paging', () => {
  it('sorts entries into sign-ins, playback and errors', () => {
    expect(activityMatches({ Type: 'AuthenticationSucceeded' }, 'signins')).toBe(true);
    expect(activityMatches({ Type: 'VideoPlayback' }, 'signins')).toBe(false);
    expect(activityMatches({ Type: 'AudioPlaybackStopped' }, 'playback')).toBe(true);
    expect(activityMatches({ Type: 'ScheduledTaskFailed', Severity: 'Error' }, 'errors')).toBe(true);
    expect(activityMatches({ Type: 'AuthenticationFailed', Severity: 'Information' }, 'errors')).toBe(true);
    expect(activityMatches({ Type: 'VideoPlayback', Severity: 'Information' }, 'errors')).toBe(false);
    expect(activityMatches({ Type: 'Anything' }, 'all')).toBe(true);
  });
  it('finds the next page until the end', () => {
    expect(nextActivityStart([])).toBe(0);
    expect(nextActivityStart([{ startIndex: 0, count: 50, total: 120 }])).toBe(50);
    expect(nextActivityStart([{ startIndex: 0, count: 50, total: 120 }, { startIndex: 50, count: 50, total: 120 }, { startIndex: 100, count: 20, total: 120 }])).toBeUndefined();
    expect(nextActivityStart([{ startIndex: 0, count: 0, total: 999 }])).toBeUndefined();
  });
});

describe('log paging', () => {
  it('reads a Content-Range header', () => {
    expect(parseContentRange('bytes 0-1023/52000')).toEqual({ start: 0, end: 1023, total: 52000 });
    expect(parseContentRange('bytes 10-20/*')).toEqual({ start: 10, end: 20, total: null });
    expect(parseContentRange(undefined)).toBeNull();
    expect(parseContentRange('items 0-1/2')).toBeNull();
  });
  it('asks for the next chunk and stops at the end', () => {
    expect(nextLogRange(0, null, 100)).toEqual({ start: 0, end: 99 });
    expect(nextLogRange(100, 150, 100)).toEqual({ start: 100, end: 149 });
    expect(nextLogRange(150, 150, 100)).toBeNull();
  });
  it('keeps a line that a chunk cuts until the next chunk', () => {
    let st = appendLogChunk({ lines: [], carry: '' }, 'one\ntw', false);
    expect(st).toEqual({ lines: ['one'], carry: 'tw' });
    st = appendLogChunk(st, 'o\r\nthree\n', false);
    expect(st).toEqual({ lines: ['one', 'two', 'three'], carry: '' });
    st = appendLogChunk(st, 'four', true);
    expect(st).toEqual({ lines: ['one', 'two', 'three', 'four'], carry: '' });
  });
  it('drops the empty line after the last newline of the file', () => {
    expect(appendLogChunk({ lines: [], carry: '' }, 'a\nb\n', true).lines).toEqual(['a', 'b']);
  });
  it('searches lines without case and finds levels', () => {
    expect(searchLines(['Alpha', 'beta', 'ALPHABET'], 'alpha')).toEqual([0, 2]);
    expect(searchLines(['x'], '  ')).toEqual([]);
    expect(logLineLevel('[12:00] [ERR] boom')).toBe('error');
    expect(logLineLevel('[12:00] [WRN] hmm')).toBe('warning');
    expect(logLineLevel('[12:00] [INF] ok')).toBeNull();
  });
});

describe('dashboard helpers', () => {
  it('computes the used share of a disk', () => {
    expect(usedShare(30, 70)).toBeCloseTo(0.3);
    expect(usedShare(undefined, 70)).toBeNull();
    expect(usedShare(0, 0)).toBeNull();
  });
  it('formats disk sizes', () => {
    expect(formatDiskSize(966e9)).toBe('966 GB');
    expect(formatDiskSize(8.1e12)).toBe('8.1 TB');
    expect(formatDiskSize(12.4e12)).toBe('12 TB');
    expect(formatDiskSize(0)).toBe('0 KB');
  });
  it('builds the web dashboard link', () => {
    expect(webDashboardUrl('https://media.example.com/')).toBe('https://media.example.com/web/#/dashboard');
    expect(webDashboardUrl('http://h:8096', 'dashboard/plugins')).toBe('http://h:8096/web/#/dashboard/plugins');
  });
});
