/**
 * Development only: an Admin API with made-up data, kept in memory. It lets
 * the Admin panel render and run every action with no admin account and no
 * change on a real server. All names are generic test data.
 */
import type {
  ActivityLogEntry,
  BaseItemDto,
  DeviceInfoDto,
  LogFile,
  SessionInfoDto,
  SystemInfo,
  SystemStorageDto,
  TaskInfo,
  UserDto,
  UserPolicy,
  VirtualFolderInfo,
} from '@jellyfin/sdk/lib/generated-client/models';

import type { AdminApi } from './api';
import { ACTIVITY_PAGE_SIZE, LIBRARY_SCAN_TASK_KEY } from './logic';

export const FIXTURE_SERVER_NAME = 'Home Media Server';
export const FIXTURE_ADMIN_ID = 'u-jane';

const TICKS = 10_000_000;
const GB = 1024 ** 3;
const MIN = 60_000;

function iso(msAgo: number, now = Date.now()): string {
  return new Date(now - msAgo).toISOString();
}

function policy(p: Partial<UserPolicy>): UserPolicy {
  return {
    IsAdministrator: false,
    IsHidden: false,
    IsDisabled: false,
    EnableAllFolders: true,
    EnabledFolders: [],
    EnableContentDownloading: true,
    EnableRemoteAccess: true,
    EnableVideoPlaybackTranscoding: true,
    EnableAudioPlaybackTranscoding: true,
    EnablePlaybackRemuxing: true,
    EnableMediaPlayback: true,
    SyncPlayAccess: 'CreateAndJoinGroups',
    RemoteClientBitrateLimit: 0,
    MaxParentalRating: null,
    AuthenticationProviderId: 'Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider',
    PasswordResetProviderId: 'Jellyfin.Server.Implementations.Users.DefaultPasswordResetProvider',
    ...p,
  };
}

function item(p: Partial<BaseItemDto>): BaseItemDto {
  return { Id: `i-${p.Name ?? 'x'}`, ...p };
}

const LIBRARIES: VirtualFolderInfo[] = [
  { Name: 'Movies', ItemId: 'lib-movies', CollectionType: 'movies', Locations: ['/media/movies'] },
  { Name: 'Shows', ItemId: 'lib-shows', CollectionType: 'tvshows', Locations: ['/media/shows', '/mnt/archive/shows'] },
  { Name: 'Music', ItemId: 'lib-music', CollectionType: 'music', Locations: ['/media/music'] },
  { Name: 'Audiobooks', ItemId: 'lib-books', CollectionType: 'books', Locations: ['/media/audiobooks'] },
];

function makeUsers(): UserDto[] {
  return [
    { Id: FIXTURE_ADMIN_ID, Name: 'Jane Doe', HasPassword: true, LastActivityDate: iso(2 * MIN), LastLoginDate: iso(3 * 3600_000), Policy: policy({ IsAdministrator: true }) },
    { Id: 'u-sam', Name: 'Sam Lee', HasPassword: true, LastActivityDate: iso(12 * MIN), LastLoginDate: iso(26 * 3600_000), Policy: policy({ RemoteClientBitrateLimit: 8_000_000 }) },
    {
      Id: 'u-kids',
      Name: 'Kids',
      HasPassword: false,
      LastActivityDate: iso(2 * 24 * 3600_000),
      LastLoginDate: iso(2 * 24 * 3600_000),
      Policy: policy({ EnableAllFolders: false, EnabledFolders: ['lib-movies', 'lib-shows'], MaxParentalRating: 10, EnableContentDownloading: false, SyncPlayAccess: 'JoinGroups' }),
    },
    { Id: 'u-alex', Name: 'Alex Kim', HasPassword: true, LastActivityDate: iso(40 * 24 * 3600_000), LastLoginDate: iso(41 * 24 * 3600_000), Policy: policy({ IsDisabled: true, EnableRemoteAccess: false }) },
    {
      Id: 'u-long',
      Name: 'Maximiliana Alexandrovna Konstantinopoulou-Wetherby',
      HasPassword: true,
      LastActivityDate: null,
      LastLoginDate: null,
      Policy: policy({ EnableVideoPlaybackTranscoding: false }),
    },
  ];
}

function makeSessions(): SessionInfoDto[] {
  const now = Date.now();
  return [
    {
      Id: 's-tv',
      UserId: 'u-sam',
      UserName: 'Sam Lee',
      Client: 'Jellyfin Android TV',
      ApplicationVersion: '0.18.2',
      DeviceName: 'Living Room TV',
      DeviceId: 'd-tv',
      LastActivityDate: iso(5_000, now),
      SupportsRemoteControl: true,
      SupportsMediaControl: true,
      NowPlayingItem: item({
        Name: 'The Long Voyage',
        Type: 'Movie',
        ProductionYear: 2019,
        RunTimeTicks: 7_200 * TICKS,
        MediaSources: [{ Id: 'ms-1', Bitrate: 24_000_000 }],
      }),
      PlayState: { PositionTicks: 2_610 * TICKS, IsPaused: false, PlayMethod: 'Transcode', MediaSourceId: 'ms-1', CanSeek: true },
      TranscodingInfo: {
        VideoCodec: 'h264',
        AudioCodec: 'aac',
        Container: 'ts',
        IsVideoDirect: false,
        IsAudioDirect: false,
        Bitrate: 8_400_000,
        CompletionPercentage: 41.2,
        Width: 1920,
        Height: 1080,
        HardwareAccelerationType: 'vaapi',
        TranscodeReasons: ['VideoCodecNotSupported', 'ContainerBitrateExceedsLimit'],
      },
    },
    {
      Id: 's-phone',
      UserId: FIXTURE_ADMIN_ID,
      UserName: 'Jane Doe',
      Client: 'Zoggyfin',
      ApplicationVersion: '0.1.1',
      DeviceName: 'iPhone',
      DeviceId: 'd-phone',
      LastActivityDate: iso(20_000, now),
      SupportsRemoteControl: true,
      SupportsMediaControl: true,
      NowPlayingItem: item({ Name: 'Morning Light', Type: 'Audio', Album: 'Quiet Hours', AlbumArtist: 'The Example Trio', RunTimeTicks: 245 * TICKS, MediaSources: [{ Id: 'ms-2', Bitrate: 320_000 }] }),
      PlayState: { PositionTicks: 94 * TICKS, IsPaused: true, PlayMethod: 'DirectPlay', MediaSourceId: 'ms-2' },
    },
    {
      Id: 's-web',
      UserId: 'u-kids',
      UserName: 'Kids',
      Client: 'Jellyfin Web',
      ApplicationVersion: '10.11.5',
      DeviceName: 'Firefox',
      DeviceId: 'd-web',
      LastActivityDate: iso(9_000, now),
      SupportsRemoteControl: true,
      SupportsMediaControl: true,
      NowPlayingItem: item({ Name: 'A Day at the Sea', Type: 'Episode', SeriesName: 'Little Explorers', ParentIndexNumber: 2, IndexNumber: 7, RunTimeTicks: 1_320 * TICKS, MediaSources: [{ Id: 'ms-3', Bitrate: 5_200_000 }] }),
      PlayState: { PositionTicks: 300 * TICKS, IsPaused: false, PlayMethod: 'DirectStream', MediaSourceId: 'ms-3' },
      TranscodingInfo: { VideoCodec: 'h264', AudioCodec: 'aac', Container: 'mp4', IsVideoDirect: true, IsAudioDirect: false, Bitrate: 5_400_000, TranscodeReasons: ['AudioCodecNotSupported'] },
    },
    {
      Id: 's-idle',
      UserId: 'u-sam',
      UserName: 'Sam Lee',
      Client: 'Zoggyfin',
      ApplicationVersion: '0.1.1',
      DeviceName: 'iPad',
      DeviceId: 'd-ipad',
      LastActivityDate: iso(7 * MIN, now),
      SupportsRemoteControl: true,
    },
  ];
}

function makeTasks(): TaskInfo[] {
  const t = (id: string, name: string, category: string, extra: Partial<TaskInfo> = {}): TaskInfo => ({
    Id: id,
    Key: id,
    Name: name,
    Category: category,
    State: 'Idle',
    IsHidden: false,
    Description: '',
    Triggers: [{ Type: 'IntervalTrigger', IntervalTicks: 12 * 3600 * TICKS }],
    LastExecutionResult: { Status: 'Completed', StartTimeUtc: iso(5 * 3600_000 + 60_000), EndTimeUtc: iso(5 * 3600_000) },
    ...extra,
  });
  return [
    t(LIBRARY_SCAN_TASK_KEY, 'Scan media library', 'Library', { Description: 'Scans the media library for new files and refreshes metadata.' }),
    t('RefreshPeople', 'Refresh people', 'Library', { Triggers: [{ Type: 'WeeklyTrigger', DayOfWeek: 'Sunday', TimeOfDayTicks: 3 * 3600 * TICKS }] }),
    t('ExtractChapterImages', 'Extract chapter images', 'Library', {
      Triggers: [{ Type: 'DailyTrigger', TimeOfDayTicks: 2 * 3600 * TICKS }],
      LastExecutionResult: { Status: 'Failed', StartTimeUtc: iso(20 * 3600_000), EndTimeUtc: iso(20 * 3600_000 - 90_000), ErrorMessage: 'ffmpeg exited with code 1' },
    }),
    t('CleanTranscode', 'Clean transcode folder', 'Maintenance', { Triggers: [{ Type: 'StartupTrigger' }, { Type: 'IntervalTrigger', IntervalTicks: 24 * 3600 * TICKS }] }),
    t('CleanLogs', 'Clean log folder', 'Maintenance', { LastExecutionResult: { Status: 'Cancelled', StartTimeUtc: iso(30 * 3600_000), EndTimeUtc: iso(30 * 3600_000) } }),
    t('TrickplayImages', 'Generate trickplay images', 'Library', { State: 'Running', CurrentProgressPercentage: 37, Triggers: [] }),
    t('UpdatePlugins', 'Update plugins', 'Application', { LastExecutionResult: undefined, Triggers: [{ Type: 'DailyTrigger', TimeOfDayTicks: 4 * 3600 * TICKS }] }),
  ];
}

const ACTIVITY_TYPES: { type: string; severity: ActivityLogEntry['Severity']; name: (u: string) => string; overview?: string }[] = [
  { type: 'AuthenticationSucceeded', severity: 'Information', name: (u) => `${u} signed in from Living Room TV` },
  { type: 'VideoPlayback', severity: 'Information', name: (u) => `${u} is playing The Long Voyage on Living Room TV` },
  { type: 'VideoPlaybackStopped', severity: 'Information', name: (u) => `${u} stopped The Long Voyage on Living Room TV` },
  { type: 'AudioPlayback', severity: 'Information', name: (u) => `${u} is playing Morning Light on iPhone` },
  { type: 'AuthenticationFailed', severity: 'Error', name: (u) => `Failed sign-in for ${u}`, overview: 'The user name or password is not correct.' },
  { type: 'SessionEnded', severity: 'Information', name: (u) => `${u} disconnected from Firefox` },
  { type: 'ScheduledTaskFailed', severity: 'Error', name: () => 'Extract chapter images failed', overview: 'ffmpeg exited with code 1' },
  { type: 'UserPolicyUpdated', severity: 'Information', name: (u) => `The policy of ${u} changed` },
  { type: 'SubtitleDownloadFailure', severity: 'Warning', name: () => 'Subtitles for The Long Voyage could not be downloaded' },
];

function makeActivity(count: number): ActivityLogEntry[] {
  const names = ['Jane Doe', 'Sam Lee', 'Kids', 'Alex Kim'];
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const t = ACTIVITY_TYPES[i % ACTIVITY_TYPES.length];
    const u = names[i % names.length];
    return { Id: count - i, Type: t.type, Severity: t.severity, Name: t.name(u), ShortOverview: t.overview ?? null, Overview: t.overview ?? null, Date: iso(i * 17 * MIN, now), UserId: FIXTURE_ADMIN_ID };
  });
}

function makeDevices(): DeviceInfoDto[] {
  return [
    { Id: 'd-phone', Name: 'iPhone', AppName: 'Zoggyfin', AppVersion: '0.1.1', LastUserName: 'Jane Doe', LastUserId: FIXTURE_ADMIN_ID, DateLastActivity: iso(20_000) },
    { Id: 'd-tv', Name: 'Living Room TV', AppName: 'Jellyfin Android TV', AppVersion: '0.18.2', LastUserName: 'Sam Lee', DateLastActivity: iso(5_000) },
    { Id: 'd-web', Name: 'Firefox', AppName: 'Jellyfin Web', AppVersion: '10.11.5', LastUserName: 'Kids', DateLastActivity: iso(9_000) },
    { Id: 'd-ipad', Name: 'iPad', AppName: 'Zoggyfin', AppVersion: '0.1.1', LastUserName: 'Sam Lee', DateLastActivity: iso(7 * MIN) },
    { Id: 'd-old', Name: 'Old Laptop', CustomName: 'Study laptop', AppName: 'Jellyfin Media Player', AppVersion: '1.9.1', LastUserName: 'Alex Kim', DateLastActivity: iso(60 * 24 * 3600_000) },
  ];
}

const LEVELS = ['INF', 'INF', 'INF', 'DBG', 'WRN', 'INF', 'ERR'];
const SOURCES = ['Emby.Server.Implementations.ScheduledTasks.TaskManager', 'MediaBrowser.MediaEncoding.Transcoding.TranscodeManager', 'Jellyfin.Api.Auth.CustomAuthenticationHandler', 'Emby.Server.Implementations.Library.LibraryManager'];

function makeLog(lines: number): string {
  const out: string[] = [];
  for (let i = 0; i < lines; i++) {
    const lvl = LEVELS[i % LEVELS.length];
    const src = SOURCES[i % SOURCES.length];
    const h = String(Math.floor(i / 3600) % 24).padStart(2, '0');
    const m = String(Math.floor(i / 60) % 60).padStart(2, '0');
    const s = String(i % 60).padStart(2, '0');
    out.push(`[2026-10-19 ${h}:${m}:${s}.${String(i % 1000).padStart(3, '0')} +00:00] [${lvl}] [${i % 40}] ${src}: Line ${i + 1}. ${lvl === 'ERR' ? 'Error processing request. The file /media/movies/Example (2019)/Example.mkv is not readable.' : 'Request finished in 12 ms.'}`);
  }
  return out.join('\n') + '\n';
}

const delay = (ms = 250) => new Promise<void>((r) => setTimeout(r, ms));

/** A fresh in-memory admin API. Each call to `sessions()` and `tasks()` moves time on, so live refresh shows changes. */
export function fixtureAdminApi(): AdminApi {
  let users = makeUsers();
  let sessions = makeSessions();
  let tasks = makeTasks();
  let devices = makeDevices();
  const activity = makeActivity(180);
  const logs: Record<string, string> = {
    'log_20261019.log': makeLog(6000),
    'log_20261018.log': makeLog(800),
    'FFmpeg.Transcode-2026-10-19_12-00-00_abcd.log': makeLog(120),
  };
  const libraries = LIBRARIES.map((l) => ({ ...l }));

  const tick = () => {
    sessions = sessions.map((s) => {
      if (!s.PlayState || s.PlayState.IsPaused || !s.NowPlayingItem) return s;
      const run = s.NowPlayingItem.RunTimeTicks ?? 0;
      const pos = Math.min(run, (s.PlayState.PositionTicks ?? 0) + 5 * TICKS);
      const ti = s.TranscodingInfo && s.TranscodingInfo.CompletionPercentage != null ? { ...s.TranscodingInfo, CompletionPercentage: Math.min(100, s.TranscodingInfo.CompletionPercentage + 0.6) } : s.TranscodingInfo;
      return { ...s, PlayState: { ...s.PlayState, PositionTicks: pos }, TranscodingInfo: ti };
    });
  };

  const findUser = (id: string) => {
    const u = users.find((x) => x.Id === id);
    if (!u) throw Object.assign(new Error('Not found'), { response: { status: 404 } });
    return u;
  };

  return {
    systemInfo: async () => {
      await delay();
      return {
        ServerName: FIXTURE_SERVER_NAME,
        Version: '10.11.5',
        OperatingSystem: 'Linux',
        OperatingSystemDisplayName: 'Linux',
        SystemArchitecture: 'X64',
        HasPendingRestart: true,
        CanSelfRestart: true,
        Id: 'fixture-server',
      } as SystemInfo;
    },
    storage: async () => {
      await delay();
      const folder = (path: string, used: number, free: number) => ({ Path: path, UsedSpace: used * GB, FreeSpace: free * GB, StorageType: 'ext4', DeviceId: path });
      return {
        ProgramDataFolder: folder('/config', 12, 180),
        WebFolder: folder('/usr/share/jellyfin/web', 0.1, 180),
        ImageCacheFolder: folder('/config/cache/images', 3, 180),
        CacheFolder: folder('/cache', 8, 180),
        LogFolder: folder('/config/log', 0.2, 180),
        InternalMetadataFolder: folder('/config/metadata', 4, 180),
        TranscodingTempFolder: folder('/cache/transcodes', 2, 180),
        Libraries: [
          { Id: 'lib-movies', Name: 'Movies', Folders: [folder('/media/movies', 3100, 900)] },
          { Id: 'lib-shows', Name: 'Shows', Folders: [folder('/media/shows', 3100, 900), folder('/mnt/archive/shows', 7400, 140)] },
          { Id: 'lib-music', Name: 'Music', Folders: [folder('/media/music', 3100, 900)] },
          { Id: 'lib-books', Name: 'Audiobooks', Folders: [folder('/media/audiobooks', 3100, 900)] },
        ],
      } satisfies SystemStorageDto;
    },
    sessions: async () => {
      await delay(150);
      tick();
      return sessions.map((s) => ({ ...s }));
    },
    sendMessage: async () => delay(),
    playstate: async (id, command) => {
      await delay();
      sessions = sessions.map((s) => {
        if (s.Id !== id) return s;
        if (command === 'Stop') return { ...s, NowPlayingItem: undefined, PlayState: undefined, TranscodingInfo: undefined };
        return { ...s, PlayState: { ...s.PlayState, IsPaused: command === 'Pause' } };
      });
    },
    stopTranscode: async (target) => {
      await delay();
      sessions = sessions.map((s) => (s.Id === target.Id ? { ...s, NowPlayingItem: undefined, PlayState: undefined, TranscodingInfo: undefined } : s));
      return 'stopped';
    },
    users: async () => {
      await delay();
      return users.map((u) => ({ ...u, Policy: { ...u.Policy } as UserPolicy }));
    },
    updatePolicy: async (id, p) => {
      await delay();
      findUser(id);
      users = users.map((u) => (u.Id === id ? { ...u, Policy: { ...p } } : u));
    },
    setPassword: async (id) => {
      await delay();
      findUser(id);
      users = users.map((u) => (u.Id === id ? { ...u, HasPassword: true } : u));
    },
    removePassword: async (id) => {
      await delay();
      findUser(id);
      users = users.map((u) => (u.Id === id ? { ...u, HasPassword: false } : u));
    },
    deleteUser: async (id) => {
      await delay();
      findUser(id);
      users = users.filter((u) => u.Id !== id);
    },
    parentalRatings: async () => {
      await delay();
      return [
        { Name: 'G', Value: 0 },
        { Name: 'TV-Y', Value: 0 },
        { Name: 'PG', Value: 10 },
        { Name: 'TV-PG', Value: 10 },
        { Name: 'PG-13', Value: 13 },
        { Name: 'TV-14', Value: 14 },
        { Name: 'R', Value: 17 },
        { Name: 'NC-17', Value: 18 },
      ];
    },
    libraries: async () => {
      await delay();
      return libraries.map((l) => ({ ...l }));
    },
    refreshLibrary: async () => delay(),
    scanAll: async () => {
      await delay();
      tasks = tasks.map((t) => (t.Key === LIBRARY_SCAN_TASK_KEY ? { ...t, State: 'Running', CurrentProgressPercentage: 0 } : t));
    },
    tasks: async () => {
      await delay(150);
      tasks = tasks.map((t) => {
        if (t.State !== 'Running') return t;
        const p = (t.CurrentProgressPercentage ?? 0) + 9;
        if (p < 100) return { ...t, CurrentProgressPercentage: p };
        return { ...t, State: 'Idle', CurrentProgressPercentage: null, LastExecutionResult: { Status: 'Completed', StartTimeUtc: iso(60_000), EndTimeUtc: iso(0) } };
      });
      return tasks.map((t) => ({ ...t }));
    },
    startTask: async (id) => {
      await delay();
      tasks = tasks.map((t) => (t.Id === id ? { ...t, State: 'Running', CurrentProgressPercentage: 0 } : t));
    },
    stopTask: async (id) => {
      await delay();
      tasks = tasks.map((t) => (t.Id === id ? { ...t, State: 'Idle', CurrentProgressPercentage: null, LastExecutionResult: { Status: 'Cancelled', StartTimeUtc: iso(30_000), EndTimeUtc: iso(0) } } : t));
    },
    activity: async (startIndex, limit = ACTIVITY_PAGE_SIZE) => {
      await delay();
      const items = activity.slice(startIndex, startIndex + limit);
      return { items, startIndex, count: items.length, total: activity.length };
    },
    devices: async () => {
      await delay();
      return devices.map((d) => ({ ...d }));
    },
    deleteDevice: async (id) => {
      await delay();
      devices = devices.filter((d) => d.Id !== id);
    },
    logFiles: async () => {
      await delay();
      return Object.entries(logs).map(([Name, text], i): LogFile => ({ Name, Size: text.length, DateCreated: iso((i + 1) * 3600_000), DateModified: iso(i * 3600_000) }));
    },
    logChunk: async (name, start, end) => {
      await delay(200);
      const text = logs[name];
      if (text === undefined) throw Object.assign(new Error('Not found'), { response: { status: 404 } });
      const part = text.slice(start, end + 1);
      return { text: part, total: text.length, done: end + 1 >= text.length, bytes: part.length };
    },
    restart: async () => delay(),
    shutdown: async () => delay(),
  };
}
