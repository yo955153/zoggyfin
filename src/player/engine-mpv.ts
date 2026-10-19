/**
 * The desktop engine: libmpv in the Tauri app (`desktop/`). libmpv opens the
 * original file from the server (MKV, HEVC, AV1, DTS, ASS and PGS
 * subtitles), draws the video under the web page and switches tracks inside
 * the file. The player screen draws the controls over the video.
 */
import { desktopWindow, localPath, mpv, type MpvEvent, type MpvTrack, nowPlaying, type NowPlayingInfo, type RemoteCommand } from '@/platform/desktop';

import type { EngineEvent, EngineListener, EngineSource, EngineSubtitle, VideoEngine } from './engine-types';

/** What Now Playing shows for the current state; null when nothing plays. */
export function nowPlayingInfo(
  meta: { title: string; subtitle?: string; artworkUri?: string } | null,
  state: { duration: number; position: number; paused: boolean; rate: number },
): NowPlayingInfo | null {
  if (!meta) return null;
  return {
    title: meta.title,
    subtitle: meta.subtitle,
    // Only http(s) artwork: Rust loads it; local files are not reachable by URL there.
    artworkUrl: meta.artworkUri && /^https?:\/\//.test(meta.artworkUri) ? meta.artworkUri : undefined,
    duration: state.duration,
    position: state.position,
    playing: !state.paused,
    rate: state.rate,
  };
}

/** The libmpv track for a Jellyfin stream index: the same stream index in the file, else the same position. */
export function trackFor(tracks: readonly MpvTrack[], type: 'audio' | 'sub', index: number, ordinal: number): MpvTrack | null {
  const ofType = tracks.filter((t) => t.type === type && !t.external);
  return ofType.find((t) => t.ffIndex === index) ?? ofType[ordinal] ?? null;
}

export class MpvEngine implements VideoEngine {
  readonly pipSupported = false;
  private listeners = new Set<EngineListener>();
  /** One libmpv call at a time, in order. */
  private chain: Promise<unknown> = Promise.resolve();
  private pos = 0;
  private cacheEnd = 0;
  /** A file is loading or loaded (libmpv also reports properties while idle). */
  private active = false;
  private loaded = false;
  /** libmpv's `pause` property, kept also while idle (it only reports changes). */
  private paused = false;
  private tracksNow: MpvTrack[] = [];
  /** Jellyfin indexes of the embedded audio and subtitle streams, in file order. */
  private audioOrder: number[] = [];
  private subOrder: number[] = [];
  private pendingAudio: number | null = null;
  private pendingSub: EngineSubtitle | null | undefined = undefined;
  /** External subtitle URLs already added to this file, with their libmpv track id. */
  private added = new Map<string, number>();
  /** Now Playing: the loaded item, its length and speed. */
  private meta: { title: string; subtitle?: string; artworkUri?: string } | null = null;
  private duration = 0;
  private rate = 1;

  constructor() {
    mpv.subscribe(this.onEvent);
    nowPlaying.onRemote(this.onRemote);
  }

  /** Sends the state to Now Playing (on load, play, pause, seek, speed and length changes). */
  private publish() {
    const info = nowPlayingInfo(this.active ? this.meta : null, { duration: this.duration, position: this.pos, paused: this.paused, rate: this.rate });
    void (info ? nowPlaying.update(info) : nowPlaying.clear()).catch(() => undefined);
  }

  private onRemote = (c: RemoteCommand) => {
    if (!this.active) return;
    switch (c.command) {
      case 'play':
        this.play();
        break;
      case 'pause':
        this.pause();
        break;
      case 'toggle':
        if (this.paused) this.play();
        else this.pause();
        break;
      case 'skip':
        this.seekTo(this.pos + c.seconds);
        break;
      case 'seek':
        this.seekTo(c.position);
        break;
      case 'next':
      case 'previous':
        this.emit({ type: 'remote', command: c.command });
        break;
    }
  };

  private emit(e: EngineEvent) {
    this.listeners.forEach((l) => l(e));
  }

  private run(fn: () => Promise<unknown>): void {
    this.chain = this.chain.then(fn).catch((e: unknown) => console.warn('[mpv]', e));
  }

  private onEvent = (e: MpvEvent) => {
    switch (e.type) {
      case 'prop':
        this.onProp(e.name, e.value);
        break;
      case 'tracks':
        this.tracksNow = e.tracks;
        break;
      case 'playback-restart':
        // After a seek: Now Playing moves its time from the new position.
        if (this.active) this.publish();
        break;
      case 'file-loaded':
        this.loaded = true;
        this.applyPendingTracks();
        this.publish();
        this.emit({ type: 'status', status: 'ready' });
        this.emit({ type: 'playing', playing: !this.paused });
        break;
      case 'end-file':
        if (!this.active) break;
        if (e.reason === 'eof') {
          this.active = false;
          this.publish();
          this.emit({ type: 'ended' });
        } else if (e.reason === 'error') {
          this.active = false;
          this.publish();
          this.emit({ type: 'status', status: 'error', error: e.error ? `The video could not be played (${e.error}).` : 'The video could not be played.' });
        }
        break;
    }
  };

  private onProp(name: string, value: number | boolean | string | null) {
    if (name === 'pause' && typeof value === 'boolean') this.paused = value;
    if (!this.active) return;
    switch (name) {
      case 'time-pos':
        if (typeof value === 'number') {
          this.pos = value;
          this.emit({ type: 'time', position: value, buffered: Math.max(value, this.cacheEnd) });
        }
        break;
      case 'demuxer-cache-time':
        if (typeof value === 'number') this.cacheEnd = value;
        break;
      case 'duration':
        if (typeof value === 'number' && value > 0) {
          this.duration = value;
          this.publish();
          this.emit({ type: 'duration', duration: value });
        }
        break;
      case 'pause':
        if (typeof value === 'boolean') {
          this.publish();
          this.emit({ type: 'playing', playing: !value });
        }
        break;
      case 'paused-for-cache':
        if (this.loaded && typeof value === 'boolean') this.emit({ type: 'status', status: value ? 'loading' : 'ready' });
        break;
      case 'speed':
        if (typeof value === 'number') {
          this.rate = value;
          this.publish();
          this.emit({ type: 'rate', rate: value });
        }
        break;
      case 'mute':
        if (typeof value === 'boolean') this.emit({ type: 'muted', muted: value });
        break;
      case 'video-codec':
      case 'hwdec-current':
        if (__DEV__ && value) console.log(`[mpv] ${name}: ${String(value)}`);
        break;
    }
  }

  get position(): number {
    return this.pos;
  }

  load(source: EngineSource): void {
    const start = source.startSeconds > 0.5 ? source.startSeconds : 0;
    this.active = true;
    this.loaded = false;
    this.pos = start;
    this.cacheEnd = 0;
    this.tracksNow = [];
    this.added.clear();
    this.audioOrder = source.streams?.audio ?? [];
    this.subOrder = source.streams?.subtitles ?? [];
    this.pendingAudio = source.audioIndex ?? null;
    this.pendingSub = undefined;
    this.meta = { title: source.title, subtitle: source.subtitle, artworkUri: source.artworkUri };
    this.duration = 0;
    this.emit({ type: 'status', status: 'loading' });
    const paused = source.autoplay === false;
    this.run(async () => {
      await mpv.set('pause', paused);
      await mpv.set('force-media-title', source.title);
      // Subtitles stay off until the session picks one; audio follows the plan.
      // A download plays from its file on the disk.
      await mpv.command('loadfile', localPath(source.uri), 'replace', '-1', `start=${start.toFixed(3)},sid=no`);
    });
  }

  unload(): void {
    if (!this.active && !this.loaded) return;
    this.active = false;
    this.loaded = false;
    this.pos = 0;
    this.meta = null;
    this.publish();
    this.run(() => mpv.command('stop'));
  }

  play(): void {
    this.run(() => mpv.set('pause', false));
  }

  pause(): void {
    this.run(() => mpv.set('pause', true));
  }

  seekTo(seconds: number): void {
    this.pos = Math.max(0, seconds);
    this.run(() => mpv.command('seek', this.pos.toFixed(3), 'absolute'));
  }

  setRate(rate: number): void {
    this.run(() => mpv.set('speed', rate));
  }

  setMuted(muted: boolean): void {
    this.run(() => mpv.set('mute', muted));
  }

  startPip(): void {
    // libmpv has no Picture in Picture here.
  }

  toggleFullscreen(): void {
    void desktopWindow.toggleFullscreen().catch(() => undefined);
  }

  readonly tracks = {
    selectAudio: (index: number) => {
      this.pendingAudio = index;
      if (this.loaded) this.applyPendingTracks();
    },
    selectSubtitle: (subtitle: EngineSubtitle | null) => {
      this.pendingSub = subtitle;
      if (this.loaded) this.applyPendingTracks();
    },
  };

  private applyPendingTracks(): void {
    const audio = this.pendingAudio;
    if (audio !== null) {
      this.pendingAudio = null;
      const track = trackFor(this.tracksNow, 'audio', audio, this.audioOrder.indexOf(audio));
      if (track?.id != null) {
        const id = track.id;
        this.run(() => mpv.set('aid', id));
      }
    }
    const sub = this.pendingSub;
    if (sub === undefined) return;
    this.pendingSub = undefined;
    if (sub === null) {
      this.run(() => mpv.set('sid', 'no'));
      return;
    }
    if (sub.url) {
      const known = this.added.get(sub.url);
      if (known !== undefined) {
        this.run(() => mpv.set('sid', known));
        return;
      }
      const url = sub.url;
      this.run(async () => {
        await mpv.command('sub-add', localPath(url), 'select', sub.label, sub.language ?? '');
        const id = Number(await mpv.get('sid'));
        if (Number.isFinite(id)) this.added.set(url, id);
      });
      return;
    }
    const track = trackFor(this.tracksNow, 'sub', sub.index, this.subOrder.indexOf(sub.index));
    if (track?.id != null) {
      const id = track.id;
      this.run(() => mpv.set('sid', id));
    }
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
