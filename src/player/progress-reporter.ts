/**
 * Reports playback to Jellyfin, so Continue Watching and resume positions
 * stay correct on every device.
 *
 *   idle --start()--> active --stop()--> stopped
 *
 * While active: a progress report every `intervalMs` (10 s), and one at once
 * on pause, resume, seek, track change and when the app goes to the background.
 * Transport errors never reach the player; a failed report is retried by the
 * next tick.
 *
 * Pure apart from the injected transport and timer, so it is unit-tested.
 */
import type { PlayMethod } from '@/api/types';

export interface PlaybackSnapshot {
  positionTicks: number;
  isPaused: boolean;
  isMuted: boolean;
  playbackRate: number;
  audioStreamIndex: number | null;
  subtitleStreamIndex: number | null;
}

export interface PlaybackSessionInfo {
  itemId: string;
  mediaSourceId: string;
  playSessionId: string | null;
  playMethod: PlayMethod;
  canSeek: boolean;
}

/** The body Jellyfin expects, flattened. */
export type PlaybackReport = PlaybackSessionInfo & PlaybackSnapshot;

export interface ProgressTransport {
  start(report: PlaybackReport): Promise<void>;
  progress(report: PlaybackReport, event: ProgressEvent): Promise<void>;
  stopped(report: PlaybackReport): Promise<void>;
}

export type ProgressEvent = 'TimeUpdate' | 'Pause' | 'Unpause' | 'Seek' | 'AudioTrackChange' | 'SubtitleTrackChange' | 'Background';

export interface Timer {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const defaultTimer: Timer = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export type ReporterState = 'idle' | 'active' | 'stopped';

export const PROGRESS_INTERVAL_MS = 10_000;

export class ProgressReporter {
  private state: ReporterState = 'idle';
  private handle: unknown = null;
  private session: PlaybackSessionInfo | null = null;
  /** One report at a time, in order: a stop never overtakes a progress report. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly transport: ProgressTransport,
    private readonly snapshot: () => PlaybackSnapshot,
    private readonly timer: Timer = defaultTimer,
    private readonly intervalMs = PROGRESS_INTERVAL_MS,
    private readonly onError: (e: unknown) => void = () => undefined,
  ) {}

  get current(): ReporterState {
    return this.state;
  }

  start(session: PlaybackSessionInfo): void {
    if (this.state === 'active') return;
    this.session = session;
    this.state = 'active';
    this.send((r) => this.transport.start(r));
    this.handle = this.timer.setInterval(() => this.tick('TimeUpdate'), this.intervalMs);
  }

  /** An immediate progress report: pause, resume, seek, track change, background. */
  tick(event: ProgressEvent): void {
    if (this.state !== 'active') return;
    this.send((r) => this.transport.progress(r, event));
  }

  /** Reports the end of playback. `final` overrides the snapshot (the last known position). */
  stop(final?: Partial<PlaybackSnapshot>): Promise<void> {
    if (this.state !== 'active') return this.queue;
    this.state = 'stopped';
    if (this.handle !== null) this.timer.clearInterval(this.handle);
    this.handle = null;
    return this.send((r) => this.transport.stopped(r), final);
  }

  private send(fn: (r: PlaybackReport) => Promise<void>, override?: Partial<PlaybackSnapshot>): Promise<void> {
    const session = this.session;
    if (!session) return this.queue;
    const report: PlaybackReport = { ...session, ...this.snapshot(), ...override };
    report.positionTicks = Math.max(0, Math.round(report.positionTicks));
    this.queue = this.queue.then(() => fn(report)).catch((e: unknown) => this.onError(e));
    return this.queue;
  }
}

export function secondsToTicks(seconds: number): number {
  return Math.max(0, Math.round(seconds * 10_000_000));
}

export function ticksToSecondsExact(ticks: number | null | undefined): number {
  return ticks ? ticks / 10_000_000 : 0;
}

/** The report body Jellyfin expects. */
export function toServerReport(r: PlaybackReport) {
  return {
    ItemId: r.itemId,
    MediaSourceId: r.mediaSourceId,
    PlaySessionId: r.playSessionId,
    PlayMethod: r.playMethod,
    CanSeek: r.canSeek,
    PositionTicks: r.positionTicks,
    IsPaused: r.isPaused,
    IsMuted: r.isMuted,
    PlaybackRate: r.playbackRate,
    AudioStreamIndex: r.audioStreamIndex ?? undefined,
    SubtitleStreamIndex: r.subtitleStreamIndex ?? -1,
  };
}
