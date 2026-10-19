/**
 * The server calls of the Admin panel. Screens use `AdminApi` and never the
 * SDK. `sdkAdminApi` talks to a Jellyfin server; the dev fixture mode uses
 * `fixtureAdminApi` (fixtures.ts) with the same interface.
 */
import type { Api } from '@jellyfin/sdk';
import type {
  ActivityLogEntry,
  DeviceInfoDto,
  LogFile,
  ParentalRating,
  SessionInfoDto,
  SystemInfo,
  SystemStorageDto,
  TaskInfo,
  UserDto,
  UserPolicy,
  VirtualFolderInfo,
} from '@jellyfin/sdk/lib/generated-client/models';
import { getDeviceApi } from '@jellyfin/sdk/lib/utils/api/device-api';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { getLibraryStructureApi } from '@jellyfin/sdk/lib/utils/api/library-structure-api';
import { getLocalizationApi } from '@jellyfin/sdk/lib/utils/api/localization-api';
import { getScheduledTaskApi } from '@jellyfin/sdk/lib/utils/api/scheduled-task-api';
import { getSessionApi } from '@jellyfin/sdk/lib/utils/api/session-api';
import { getSystemApi } from '@jellyfin/sdk/lib/utils/api/system-api';
import { getUserApi } from '@jellyfin/sdk/lib/utils/api/user-api';

import { ACTIVITY_PAGE_SIZE, parseContentRange } from './logic';

export interface ActivityPage {
  items: ActivityLogEntry[];
  startIndex: number;
  count: number;
  total: number;
}

export interface LogChunk {
  text: string;
  /** The size of the whole file when the server tells it. */
  total: number | null;
  /** True when this chunk ends the file. */
  done: boolean;
  /** Bytes this chunk covers. */
  bytes: number;
}

export type RefreshKind = 'scan' | 'missing' | 'replace';

export interface AdminApi {
  systemInfo(): Promise<SystemInfo>;
  /** Null when the server is older than 10.11 and has no storage endpoint. */
  storage(): Promise<SystemStorageDto | null>;
  sessions(): Promise<SessionInfoDto[]>;
  sendMessage(sessionId: string, text: string): Promise<void>;
  playstate(sessionId: string, command: 'Pause' | 'Unpause' | 'Stop'): Promise<void>;
  /** Ends the transcode job of a session. Returns how it was done. */
  stopTranscode(session: SessionInfoDto): Promise<'killed' | 'stopped'>;
  users(): Promise<UserDto[]>;
  updatePolicy(userId: string, policy: UserPolicy): Promise<void>;
  setPassword(userId: string, password: string): Promise<void>;
  removePassword(userId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  parentalRatings(): Promise<ParentalRating[]>;
  libraries(): Promise<VirtualFolderInfo[]>;
  refreshLibrary(itemId: string, kind: RefreshKind): Promise<void>;
  scanAll(): Promise<void>;
  tasks(): Promise<TaskInfo[]>;
  startTask(id: string): Promise<void>;
  stopTask(id: string): Promise<void>;
  activity(startIndex: number, limit?: number): Promise<ActivityPage>;
  devices(): Promise<DeviceInfoDto[]>;
  deleteDevice(id: string): Promise<void>;
  logFiles(): Promise<LogFile[]>;
  /** One part of a log file. `start`/`end` are byte offsets (inclusive). */
  logChunk(name: string, start: number, end: number): Promise<LogChunk>;
  restart(): Promise<void>;
  shutdown(): Promise<void>;
}

const MESSAGE_TIMEOUT_MS = 15_000;

function isNotFound(e: unknown): boolean {
  const status = (e as { response?: { status?: number } })?.response?.status;
  return status === 404;
}

export function sdkAdminApi(api: Api): AdminApi {
  const system = () => getSystemApi(api);
  const sessionApi = () => getSessionApi(api);
  const userApi = () => getUserApi(api);
  const tasksApi = () => getScheduledTaskApi(api);
  return {
    systemInfo: async () => (await system().getSystemInfo()).data,
    storage: async () => {
      try {
        return (await system().getSystemStorage()).data;
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
    sessions: async () => (await sessionApi().getSessions({ activeWithinSeconds: 960 })).data,
    sendMessage: async (sessionId, text) => {
      await sessionApi().sendMessageCommand({ sessionId, messageCommand: { Header: 'Message from the server', Text: text, TimeoutMs: MESSAGE_TIMEOUT_MS } });
    },
    playstate: async (sessionId, command) => {
      await sessionApi().sendPlaystateCommand({ sessionId, command });
    },
    stopTranscode: async (s) => {
      // DELETE /Videos/ActiveEncodings needs the play session Id. Servers that send it get the
      // direct call; for the others the playback stops, and the server ends the job with it.
      const playSessionId = (s.PlayState as { PlaySessionId?: string | null } | undefined)?.PlaySessionId;
      if (s.DeviceId && playSessionId) {
        await api.axiosInstance.delete(`${api.basePath}/Videos/ActiveEncodings`, { params: { deviceId: s.DeviceId, playSessionId } });
        return 'killed';
      }
      if (!s.Id) throw new Error('The session has no Id.');
      await sessionApi().sendPlaystateCommand({ sessionId: s.Id, command: 'Stop' });
      return 'stopped';
    },
    users: async () => (await userApi().getUsers()).data,
    updatePolicy: async (userId, policy) => {
      await userApi().updateUserPolicy({ userId, userPolicy: policy });
    },
    setPassword: async (userId, password) => {
      await userApi().updateUserPassword({ userId, updateUserPassword: { CurrentPw: '', NewPw: password, ResetPassword: false } });
    },
    removePassword: async (userId) => {
      await userApi().updateUserPassword({ userId, updateUserPassword: { ResetPassword: true } });
    },
    deleteUser: async (userId) => {
      await userApi().deleteUser({ userId });
    },
    parentalRatings: async () => (await getLocalizationApi(api).getParentalRatings()).data,
    libraries: async () => (await getLibraryStructureApi(api).getVirtualFolders()).data,
    refreshLibrary: async (itemId, kind) => {
      const full = kind !== 'scan';
      await getLibraryApi(api).refreshItem({
        itemId,
        metadataRefreshMode: full ? 'FullRefresh' : 'Default',
        imageRefreshMode: full ? 'FullRefresh' : 'Default',
        replaceAllMetadata: kind === 'replace',
        replaceAllImages: kind === 'replace',
      });
    },
    scanAll: async () => {
      await getLibraryApi(api).refreshLibrary();
    },
    tasks: async () => (await tasksApi().getTasks({ isHidden: false })).data,
    startTask: async (taskId) => {
      await tasksApi().startTask({ taskId });
    },
    stopTask: async (taskId) => {
      await tasksApi().stopTask({ taskId });
    },
    activity: async (startIndex, limit = ACTIVITY_PAGE_SIZE) => {
      const res = (await system().getLogEntries({ startIndex, limit })).data;
      const items = res.Items ?? [];
      return { items, startIndex, count: items.length, total: res.TotalRecordCount ?? items.length };
    },
    devices: async () => (await getDeviceApi(api).getDevices()).data.Items ?? [],
    deleteDevice: async (id) => {
      // The server reads one `id` query value.
      await api.axiosInstance.delete(`${api.basePath}/Devices`, { params: { id } });
    },
    logFiles: async () => (await system().getServerLogs()).data,
    logChunk: async (name, start, end) => {
      const res = await api.axiosInstance.get<string>(`${api.basePath}/System/Logs/Log`, {
        params: { name },
        headers: { Range: `bytes=${start}-${end}` },
        responseType: 'text',
        transformResponse: (d: unknown) => d,
      });
      const text = typeof res.data === 'string' ? res.data : String(res.data ?? '');
      const range = res.status === 206 ? parseContentRange(res.headers['content-range'] as string | undefined) : null;
      if (!range) {
        // No range support: the whole file came at once.
        return { text, total: text.length, done: true, bytes: text.length };
      }
      const bytes = range.end - range.start + 1;
      return { text, total: range.total, done: range.total !== null && range.end + 1 >= range.total, bytes };
    },
    restart: async () => {
      await system().restartApplication();
    },
    shutdown: async () => {
      await system().shutdownApplication();
    },
  };
}
