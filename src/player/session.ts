/**
 * The video playback session: asks the server how to play an item, drives
 * the engine, keeps the shared store current and reports progress.
 * One session at a time; screens use it through `usePlayer()`.
 */
import type { Api } from '@jellyfin/sdk';
import * as Network from 'expo-network';
import { AppState, type NativeEventSubscription } from 'react-native';

import { getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import * as jf from '@/api/jellyfin';
import { queryClient } from '@/api/query-client';
import { queryKeys } from '@/api/query-keys';
import type { BaseItemDto } from '@/api/types';
import { clientIdentity } from '@/auth/identity';
import { useSessionStore } from '@/auth/session-store';
import { resolveImage } from '@/images/resolve-image';
import { bitrateFor, usePlaybackSettings } from '@/settings/playback';

import { mediaCapabilities } from './capabilities';
import { buildDeviceProfile } from './device-profile';
import { getEngine } from './engine';
import type { EngineEvent } from './engine-types';
import { type PlaybackReport, ProgressReporter, secondsToTicks, ticksToSecondsExact } from './progress-reporter';
import { normalizeSegments } from './segments';
import { setPlayerState, initialPlayerState, playerState, type NowPlaying } from './store';
import { audioSwitchNeedsStream, pickSource, planStream, playbackInfoBody, type StreamServer } from './stream';
import { chaptersOf, pickTrickplay } from './timeline';
import type { PlayRequest } from './types';
import { parseVtt } from './vtt';

interface Ctx {
  api: Api;
  userId: string;
  server: StreamServer;
}

function context(): Ctx {
  const s = useSessionStore.getState().session;
  if (!s) throw new Error('Sign in to play.');
  return {
    api: getApi(s.serverUrl, s.token),
    userId: s.userId,
    server: { baseUrl: s.serverUrl, token: s.token, deviceId: clientIdentity().deviceId },
  };
}

async function onCellular(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.type === Network.NetworkStateType.CELLULAR;
  } catch {
    return false;
  }
}

function toServerReport(r: PlaybackReport) {
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
    AudioStreamIndex: r.audioStreamIndex,
    SubtitleStreamIndex: r.subtitleStreamIndex ?? -1,
  };
}

function artworkUrl(item: BaseItemDto, server: StreamServer): string | undefined {
  try {
    const img = resolveImage(item, 'landscape', { width: 640, height: 360 }, { baseUrl: server.baseUrl, token: server.token });
    return img.kind === 'remote' && !img.crop ? img.uri : undefined;
  } catch {
    return undefined;
  }
}

function subtitleLine(item: BaseItemDto): string | undefined {
  if (item.Type === 'Episode') {
    const se = item.ParentIndexNumber != null && item.IndexNumber != null ? `S${item.ParentIndexNumber} E${item.IndexNumber}` : null;
    return [item.SeriesName, se].filter(Boolean).join(' · ') || undefined;
  }
  return item.ProductionYear ? String(item.ProductionYear) : undefined;
}

interface LoadOptions {
  startSeconds: number;
  audioIndex?: number | null;
  subtitleIndex?: number | null;
  bitrateChoice?: number | null;
  forceStream?: boolean;
}

class VideoSession {
  private engine = getEngine();
  private reporter: ProgressReporter | null = null;
  private appState: NativeEventSubscription | null = null;
  /** Guards against an old load finishing after a newer one started. */
  private loadId = 0;
  private lastRequest: PlayRequest | null = null;

  constructor() {
    this.engine.subscribe(this.onEngine);
  }

  private onEngine = (e: EngineEvent) => {
    const st = playerState();
    if (!st.now) return;
    switch (e.type) {
      case 'status':
        if (e.status === 'error') {
          setPlayerState({ status: 'error', error: e.error ?? 'The video could not be played.' });
          void this.reporter?.stop({ positionTicks: secondsToTicks(st.position) });
        } else if (e.status === 'loading') setPlayerState({ status: st.status === 'loading' ? 'loading' : 'buffering' });
        else if (e.status === 'ready') setPlayerState({ status: 'ready' });
        break;
      case 'playing':
        if (e.playing !== st.playing) {
          setPlayerState({ playing: e.playing });
          this.reporter?.tick(e.playing ? 'Unpause' : 'Pause');
        }
        break;
      case 'time':
        setPlayerState({ position: e.position, buffered: e.buffered });
        break;
      case 'duration':
        if (e.duration > 0) setPlayerState({ duration: e.duration });
        break;
      case 'rate':
        setPlayerState({ rate: e.rate });
        break;
      case 'muted':
        setPlayerState({ muted: e.muted });
        break;
      case 'pip':
        setPlayerState({ pip: e.active });
        break;
      case 'ended':
        void this.onEnded();
        break;
      case 'remote':
        if (e.command === 'next' && st.now.next) void this.playNext();
        break;
    }
  };

  private snapshot = () => {
    const st = playerState();
    return {
      positionTicks: secondsToTicks(this.engine.position || st.position),
      isPaused: !st.playing,
      isMuted: st.muted,
      playbackRate: st.rate,
      audioStreamIndex: st.now?.plan.audioIndex ?? null,
      subtitleStreamIndex: st.now?.plan.subtitleIndex ?? null,
    };
  };

  private makeReporter(api: Api): ProgressReporter {
    return new ProgressReporter(
      {
        start: (r) => jf.reportPlaybackStart(api, toServerReport(r)),
        progress: (r) => jf.reportPlaybackProgress(api, toServerReport(r)),
        stopped: (r) =>
          jf.reportPlaybackStopped(api, {
            ItemId: r.itemId,
            MediaSourceId: r.mediaSourceId,
            PlaySessionId: r.playSessionId,
            PositionTicks: r.positionTicks,
          }),
      },
      this.snapshot,
      undefined,
      undefined,
      (e) => console.warn('[player] progress report failed', describeError(e).title),
    );
  }

  /** Starts an item. Containers (show, season, collection) resolve to an episode or item first. */
  async play(request: PlayRequest): Promise<void> {
    const id = ++this.loadId;
    await this.finishCurrent();
    this.lastRequest = request;
    setPlayerState({ ...initialPlayerState, status: 'loading', presentation: 'full' });
    try {
      const { api, userId } = context();
      const target = await jf.resolvePlayable(api, userId, request.item);
      if (!target?.Id) throw new Error('Nothing to play here yet.');
      // The full item has chapters, trickplay info and the user's position.
      const item = await jf.getItem(api, userId, target.Id);
      if (id !== this.loadId) return;
      const resume = ticksToSecondsExact(item.UserData?.PlaybackPositionTicks);
      const start =
        request.startPositionTicks !== undefined
          ? ticksToSecondsExact(request.startPositionTicks)
          : target === request.item || target.Id === request.item.Id
            ? resume
            : ticksToSecondsExact(target.UserData?.PlaybackPositionTicks);
      await this.load(id, item, request.queue ?? [], { startSeconds: start });
    } catch (e) {
      if (id !== this.loadId) return;
      setPlayerState({ status: 'error', error: describeError(e).title });
    }
  }

  private async load(id: number, item: BaseItemDto, queue: BaseItemDto[], opts: LoadOptions): Promise<void> {
    const { api, userId, server } = context();
    const settings = usePlaybackSettings.getState();
    const bitrate = opts.bitrateChoice ?? bitrateFor(settings, await onCellular());
    const profile = buildDeviceProfile(mediaCapabilities(), { maxBitrate: bitrate });
    const current = playerState().now;
    const keep = current && current.item.Id === item.Id ? current : null;
    const sameItem = keep !== null;
    const keepSource = keep ? keep.plan.mediaSourceId : undefined;
    const info = await jf.getPlaybackInfo(
      api,
      item.Id ?? '',
      playbackInfoBody({
        userId,
        profile,
        maxBitrate: bitrate,
        startTicks: secondsToTicks(opts.startSeconds),
        mediaSourceId: keepSource,
        audioIndex: opts.audioIndex,
        subtitleIndex: opts.subtitleIndex,
        forceStream: opts.forceStream,
      }),
    );
    if (id !== this.loadId) return;
    const source = pickSource(info.MediaSources, keepSource);
    if (!source) throw new Error('The server has no playable version of this item.');
    const plan = planStream(server, item.Id ?? '', source, info.PlaySessionId ?? null, {
      audioIndex: opts.audioIndex,
      subtitleIndex: opts.subtitleIndex,
    });
    const next: NowPlaying = {
      kind: 'video',
      item,
      queue,
      plan,
      segments: keep ? keep.segments : [],
      chapters: chaptersOf(item.Chapters, ticksToSecondsExact(item.RunTimeTicks)),
      trickplay: pickTrickplay(item.Trickplay, plan.mediaSourceId),
      bitrateChoice: opts.bitrateChoice ?? null,
      bitrate,
      next: keep ? keep.next : (queue[0] ?? null),
    };
    setPlayerState({
      now: next,
      status: 'loading',
      error: null,
      position: opts.startSeconds,
      duration: ticksToSecondsExact(item.RunTimeTicks) || playerState().duration,
      cues: sameItem ? playerState().cues : null,
    });
    this.engine.load({
      uri: plan.url,
      isHls: plan.isHls,
      startSeconds: opts.startSeconds,
      title: item.Name ?? 'Video',
      subtitle: subtitleLine(item),
      artworkUri: artworkUrl(item, server),
    });
    const rate = playerState().rate;
    if (rate !== 1) this.engine.setRate(rate);

    this.reporter = this.makeReporter(api);
    this.reporter.start({
      itemId: item.Id ?? '',
      mediaSourceId: plan.mediaSourceId,
      playSessionId: plan.playSessionId,
      playMethod: plan.playMethod,
      canSeek: true,
    });
    this.watchAppState();

    if (!sameItem) {
      void this.loadExtras(id, api, userId, item, source.HasSegments !== false, queue);
      const def = plan.subtitles.find((s) => s.index === source.DefaultSubtitleStreamIndex && s.isText);
      if (def && opts.subtitleIndex === undefined) void this.selectSubtitle(def.index);
    }
  }

  private async loadExtras(id: number, api: Api, userId: string, item: BaseItemDto, hasSegments: boolean, queue: BaseItemDto[]) {
    const [segments, next] = await Promise.all([
      hasSegments ? jf.getMediaSegments(api, item.Id ?? '') : Promise.resolve([]),
      item.Type === 'Episode' && !queue.length ? jf.getNextEpisode(api, userId, item).catch(() => null) : Promise.resolve(queue[0] ?? null),
    ]);
    if (id !== this.loadId) return;
    const now = playerState().now;
    if (!now || now.item.Id !== item.Id) return;
    setPlayerState({ now: { ...now, segments: normalizeSegments(segments), next } });
  }

  private watchAppState() {
    if (this.appState) return;
    this.appState = AppState.addEventListener('change', (s) => {
      if (s === 'background') this.reporter?.tick('Background');
    });
  }

  /** Reloads the current item at the current position with new stream options. */
  private async reload(opts: Omit<LoadOptions, 'startSeconds'>): Promise<void> {
    const st = playerState();
    if (!st.now) return;
    const id = ++this.loadId;
    const position = this.engine.position || st.position;
    const now = st.now;
    await this.reporter?.stop({ positionTicks: secondsToTicks(position) });
    try {
      await this.load(id, now.item, now.queue, {
        startSeconds: position,
        audioIndex: opts.audioIndex !== undefined ? opts.audioIndex : now.plan.audioIndex,
        subtitleIndex: opts.subtitleIndex !== undefined ? opts.subtitleIndex : now.plan.subtitleIndex,
        bitrateChoice: opts.bitrateChoice !== undefined ? opts.bitrateChoice : now.bitrateChoice,
        forceStream: opts.forceStream,
      });
    } catch (e) {
      if (id === this.loadId) setPlayerState({ status: 'error', error: describeError(e).title });
    }
  }

  retry(): void {
    const st = playerState();
    if (st.now) void this.reload({});
    else if (this.lastRequest) void this.play(this.lastRequest);
  }

  togglePlay(): void {
    if (playerState().playing) this.engine.pause();
    else this.engine.play();
  }

  play_(): void {
    this.engine.play();
  }

  pause(): void {
    this.engine.pause();
  }

  seekTo(seconds: number): void {
    const { duration } = playerState();
    const target = Math.max(0, duration > 0 ? Math.min(seconds, duration - 0.5) : seconds);
    this.engine.seekTo(target);
    setPlayerState({ position: target });
    this.reporter?.tick('Seek');
  }

  skip(delta: number): void {
    this.seekTo((this.engine.position || playerState().position) + delta);
  }

  setRate(rate: number): void {
    this.engine.setRate(rate);
    setPlayerState({ rate });
  }

  toggleMuted(): void {
    const muted = !playerState().muted;
    this.engine.setMuted(muted);
    setPlayerState({ muted });
  }

  startPip(): void {
    this.engine.startPip();
  }

  get pipSupported(): boolean {
    return this.engine.pipSupported;
  }

  toggleFullscreen(element: unknown): void {
    this.engine.toggleFullscreen?.(element);
  }

  async selectAudio(index: number): Promise<void> {
    const now = playerState().now;
    if (!now || now.plan.audioIndex === index) return;
    // A direct-played file plays its default track: another track needs a remux from the server.
    const def = now.plan.audio.find((a) => a.isDefault) ?? now.plan.audio[0];
    const forceStream = audioSwitchNeedsStream(now.plan, index) && now.plan.playMethod !== 'Transcode' && def?.index !== index;
    await this.reload({ audioIndex: index, forceStream });
    this.reporter?.tick('AudioTrackChange');
  }

  /** null turns subtitles off. Text subtitles load as WebVTT; image subtitles need a burned-in stream. */
  async selectSubtitle(index: number | null): Promise<void> {
    const now = playerState().now;
    if (!now) return;
    const option = index === null ? null : now.plan.subtitles.find((s) => s.index === index);
    if (!option) {
      setPlayerState({ cues: null });
      if (now.plan.burnedSubtitle) await this.reload({ subtitleIndex: null });
      else this.setPlanSubtitle(null);
      return;
    }
    if (!option.isText || (!option.url && !now.plan.burnedSubtitle)) {
      // Image subtitles: the server burns them in. A text subtitle without a URL needs a fresh answer.
      setPlayerState({ cues: null });
      await this.reload({ subtitleIndex: option.index });
      if (option.isText) await this.loadCues(option.index);
      return;
    }
    if (now.plan.burnedSubtitle) {
      await this.reload({ subtitleIndex: option.index });
    } else {
      this.setPlanSubtitle(option.index);
    }
    await this.loadCues(option.index);
  }

  private setPlanSubtitle(index: number | null) {
    const now = playerState().now;
    if (!now) return;
    setPlayerState({ now: { ...now, plan: { ...now.plan, subtitleIndex: index } } });
    this.reporter?.tick('SubtitleTrackChange');
  }

  private async loadCues(index: number) {
    const now = playerState().now;
    const option = now?.plan.subtitles.find((s) => s.index === index);
    if (!option?.url) return;
    try {
      const { api } = context();
      const text = await jf.getText(api, option.url);
      if (playerState().now?.plan.subtitleIndex !== index) return;
      setPlayerState({ cues: parseVtt(text) });
    } catch (e) {
      setPlayerState({ cues: null });
      console.warn('[player] subtitles failed', describeError(e).title);
    }
  }

  async setQuality(bitrate: number | null): Promise<void> {
    const now = playerState().now;
    if (!now || now.bitrateChoice === bitrate) return;
    await this.reload({ bitrateChoice: bitrate });
  }

  /** Refreshes Continue Watching and the item page, for example when the player minimizes. */
  refreshLists(): void {
    this.reporter?.tick('TimeUpdate');
    setTimeout(() => refreshAfterPlayback(playerState().now?.item), 1500);
  }

  async playNext(): Promise<void> {
    const now = playerState().now;
    if (!now?.next) return;
    const rest = now.queue[0]?.Id === now.next.Id ? now.queue.slice(1) : [];
    await this.play({ item: now.next, queue: rest, startPositionTicks: 0 });
  }

  private async onEnded() {
    const now = playerState().now;
    if (now?.next && usePlaybackSettings.getState().autoplayNext) {
      await this.playNext();
      return;
    }
    setPlayerState({ status: 'ended', playing: false });
    await this.stop();
  }

  /** Ends playback, reports the last position and refreshes Continue Watching. */
  async stop(): Promise<void> {
    this.loadId++;
    await this.finishCurrent();
    setPlayerState({ ...initialPlayerState });
  }

  private async finishCurrent(): Promise<void> {
    const st = playerState();
    const reporter = this.reporter;
    this.reporter = null;
    const position = this.engine.position || st.position;
    this.engine.unload();
    if (reporter) {
      await reporter.stop({ positionTicks: secondsToTicks(position), isPaused: true });
      refreshAfterPlayback(st.now?.item);
    }
  }
}

/** Continue Watching, Next Up and the item page change after playback. */
function refreshAfterPlayback(item: BaseItemDto | undefined) {
  const s = useSessionStore.getState().session;
  if (!s) return;
  const scope = { serverId: s.serverId, userId: s.userId };
  void queryClient.invalidateQueries({ queryKey: queryKeys.resume(scope, 'Video') });
  // Prefix match: Next Up on Home and on every show page.
  void queryClient.invalidateQueries({ queryKey: queryKeys.nextUp(scope).slice(0, -1) });
  if (item?.Id) void queryClient.invalidateQueries({ queryKey: queryKeys.item(scope, item.Id) });
}

let session: VideoSession | null = null;

export function videoSession(): VideoSession {
  session ??= new VideoSession();
  return session;
}
