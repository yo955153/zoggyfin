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
import { type DownloadRecord, findDownload, localExtraUri, localFileFor, readLocalText } from '@/downloads';
import { outboxPosition } from '@/downloads/outbox-store';
import { resolveImage } from '@/images/resolve-image';
import { isOffline } from '@/lib/online';
import { bitrateFor, usePlaybackSettings } from '@/settings/playback';

import { mediaCapabilities } from './capabilities';
import { controlGate } from './control-gate';
import { buildDeviceProfile } from './device-profile';
import { getEngine } from './engine';
import type { EngineEvent } from './engine-types';
import { isForeignDownload, outboxOnly, withOutbox } from './outbox-transport';
import { ProgressReporter, type ProgressTransport, secondsToTicks, ticksToSecondsExact, toServerReport } from './progress-reporter';
import { normalizeSegments } from './segments';
import { setPlayerState, initialPlayerState, playerState, type NowPlaying } from './store';
import { audioOptions, audioSwitchNeedsStream, pickSource, planStream, playbackInfoBody, type StreamPlan, type StreamServer } from './stream';
import { chaptersOf, pickTrickplay } from './timeline';
import type { PlayRequest } from './types';
import { parseVtt } from './vtt';

interface Ctx {
  api: Api;
  userId: string;
  serverId: string;
  server: StreamServer;
}

function context(): Ctx {
  const s = useSessionStore.getState().session;
  if (!s) throw new Error('Sign in to play.');
  return {
    api: getApi(s.serverUrl, s.token),
    userId: s.userId,
    serverId: s.serverId,
    server: { baseUrl: s.serverUrl, token: s.token, deviceId: clientIdentity().deviceId },
  };
}

/** A completed download of this item, from any saved server, or null. It plays from the device. */
function downloaded(itemId: string | null | undefined): DownloadRecord | null {
  const r = findDownload(itemId);
  return r && r.state === 'completed' && localFileFor(r.itemId) ? r : null;
}

/** True when the download is from a server that is not the active one: no server calls for it. */
function foreign(r: DownloadRecord): boolean {
  const active = useSessionStore.getState().session?.serverId;
  // With no account signed in, every download counts as another server's: no server calls, progress to the outbox.
  return !active || isForeignDownload(r, active);
}

/** The stream plan for a downloaded file: the file itself, with its saved subtitles. */
function localPlan(r: DownloadRecord, uri: string): StreamPlan {
  const source = r.item.MediaSources?.[0] ?? {};
  const audio = r.method === 'original' ? audioOptions(source) : [];
  return {
    url: uri,
    isHls: false,
    playMethod: 'DirectPlay',
    mediaSourceId: r.mediaSourceId,
    playSessionId: null,
    audio,
    subtitles: r.subtitles.map((sub) => ({
      index: sub.index,
      label: sub.label,
      language: sub.language,
      isDefault: sub.isDefault,
      isForced: sub.isForced,
      isText: true,
      url: localExtraUri(r, sub.file),
    })),
    audioIndex: audio.find((a) => a.isDefault)?.index ?? audio[0]?.index ?? null,
    subtitleIndex: null,
    burnedSubtitle: false,
    isLocal: true,
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
  autoplay?: boolean;
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
          if (this.recoverAfterAddressSwitch()) break;
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

  private makeReporter(api: Api, item: BaseItemDto): ProgressReporter {
    const s = useSessionStore.getState().session;
    const transport: ProgressTransport = {
        start: (r) => jf.reportPlaybackStart(api, toServerReport(r)),
        progress: (r) => jf.reportPlaybackProgress(api, toServerReport(r)),
        stopped: (r) =>
          jf.reportPlaybackStopped(api, {
            ItemId: r.itemId,
            MediaSourceId: r.mediaSourceId,
            PlaySessionId: r.playSessionId,
            PositionTicks: r.positionTicks,
          }),
    };
    return new ProgressReporter(
      s ? withOutbox(transport, { serverId: s.serverId, userId: s.userId, runTimeTicks: item.RunTimeTicks ?? null }) : transport,
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
      const local = downloaded(request.item.Id);
      if (local) {
        await this.playLocal(id, local, request);
        return;
      }
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
      await this.load(id, item, request.queue ?? [], { startSeconds: start, autoplay: request.autoplay });
    } catch (e) {
      if (id !== this.loadId) return;
      setPlayerState({ status: 'error', error: describeError(e).title });
    }
  }

  /** Plays a downloaded file. The server is asked for the saved position only when it answers. */
  private async playLocal(id: number, r: DownloadRecord, request: PlayRequest): Promise<void> {
    const other = foreign(r);
    let item: BaseItemDto = r.item;
    if (!isOffline() && !other) {
      const { api, userId } = context();
      try {
        const fresh = await Promise.race([
          jf.getItem(api, userId, r.itemId),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
        ]);
        if (fresh) item = { ...r.item, UserData: fresh.UserData, Chapters: fresh.Chapters ?? r.item.Chapters, Trickplay: fresh.Trickplay };
      } catch {
        // Offline: the saved facts are enough.
      }
    }
    if (id !== this.loadId) return;
    const uri = localFileFor(r.itemId);
    if (!uri) throw new Error('The downloaded file is missing. Download it again.');
    const plan = localPlan(r, uri);
    // With no fresh facts from the server, a position that waits in the outbox is the newest one.
    const pending = item === r.item ? outboxPosition(r.serverId, r.userId, r.itemId) : null;
    const start =
      request.startPositionTicks !== undefined
        ? ticksToSecondsExact(request.startPositionTicks)
        : ticksToSecondsExact(pending ?? item.UserData?.PlaybackPositionTicks);
    const queue = request.queue ?? [];
    setPlayerState({
      now: {
        kind: 'video',
        item,
        queue,
        plan,
        segments: [],
        chapters: chaptersOf(item.Chapters, ticksToSecondsExact(item.RunTimeTicks)),
        trickplay: isOffline() || other ? null : pickTrickplay(item.Trickplay, plan.mediaSourceId),
        bitrateChoice: null,
        bitrate: 0,
        next: queue[0] ?? null,
      },
      status: 'loading',
      error: null,
      position: start,
      duration: ticksToSecondsExact(item.RunTimeTicks),
      cues: null,
    });
    this.engine.load({
      uri,
      isHls: false,
      startSeconds: start,
      title: item.Name ?? 'Video',
      subtitle: subtitleLine(item),
      artworkUri: undefined,
      autoplay: request.autoplay,
    });
    const rate = playerState().rate;
    if (rate !== 1) this.engine.setRate(rate);
    this.reporter = this.localReporter(r, item);
    this.reporter.start({ itemId: r.itemId, mediaSourceId: plan.mediaSourceId, playSessionId: null, playMethod: 'DirectPlay', canSeek: true });
    this.watchAppState();
    const def = plan.subtitles.find((sub) => sub.isDefault);
    if (def) void this.selectSubtitle(def.index);
  }

  /**
   * The reporter of a download: the active server (with the outbox when it
   * does not answer), or for another server's download only the outbox,
   * tagged with that server and user.
   */
  private localReporter(r: DownloadRecord, item: BaseItemDto): ProgressReporter {
    if (!foreign(r)) return this.makeReporter(context().api, item);
    return new ProgressReporter(
      outboxOnly({ serverId: r.serverId, userId: r.userId, runTimeTicks: item.RunTimeTicks ?? null }),
      this.snapshot,
      undefined,
      undefined,
      (e) => console.warn('[player] progress report failed', describeError(e).title),
    );
  }

  /**
   * Plays a file the server did not plan: this device's download, or a
   * nearby host's file (watch together). Needs no server. Progress of a
   * download goes to its own server (see `localReporter`).
   */
  async playSource(src: { item: BaseItemDto; uri: string; startSeconds: number; autoplay: boolean; record: DownloadRecord | null }): Promise<void> {
    const id = ++this.loadId;
    await this.finishCurrent();
    if (id !== this.loadId) return;
    this.lastRequest = null;
    const r = src.record;
    const item = r?.item ?? src.item;
    const plan: StreamPlan = r
      ? localPlan(r, src.uri)
      : {
          url: src.uri,
          isHls: false,
          playMethod: 'DirectPlay',
          mediaSourceId: item.MediaSources?.[0]?.Id ?? '',
          playSessionId: null,
          audio: [],
          subtitles: [],
          audioIndex: null,
          subtitleIndex: null,
          burnedSubtitle: false,
          isLocal: true,
          fromPeer: true,
        };
    setPlayerState({
      ...initialPlayerState,
      presentation: 'full',
      now: {
        kind: 'video',
        item,
        queue: [],
        plan,
        segments: [],
        chapters: chaptersOf(item.Chapters, ticksToSecondsExact(item.RunTimeTicks)),
        trickplay: null,
        bitrateChoice: null,
        bitrate: 0,
        next: null,
      },
      status: 'loading',
      position: src.startSeconds,
      duration: ticksToSecondsExact(item.RunTimeTicks),
    });
    this.engine.load({ uri: src.uri, isHls: false, startSeconds: src.startSeconds, title: item.Name ?? 'Video', subtitle: subtitleLine(item), autoplay: src.autoplay });
    if (r) {
      this.reporter = this.localReporter(r, item);
      this.reporter.start({ itemId: r.itemId, mediaSourceId: plan.mediaSourceId, playSessionId: null, playMethod: 'DirectPlay', canSeek: true });
      this.watchAppState();
    }
    const def = plan.subtitles.find((sub) => sub.isDefault);
    if (def) void this.selectSubtitle(def.index);
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
      autoplay: opts.autoplay,
      audioIndex: plan.audioIndex,
      streams: { audio: plan.audio.map((a) => a.index), subtitles: plan.subtitles.filter((x) => !x.isExternal).map((x) => x.index) },
    });
    const rate = playerState().rate;
    if (rate !== 1) this.engine.setRate(rate);

    this.reporter = this.makeReporter(api, item);
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
      const def = plan.subtitles.find((s) => s.index === source.DefaultSubtitleStreamIndex && (s.isText || this.engineTracks(plan)));
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

  /** The stream URL that was reloaded after an address switch, so a second failure shows the error. */
  private recovered: string | null = null;

  /**
   * The app moved to another address of the server while this stream played
   * (`servers/connection.ts`). The stream keeps its old address until it
   * fails; then it starts again on the new address at the same position.
   * A transcode needs a new session for that, which `reload` asks for.
   */
  private recoverAfterAddressSwitch(): boolean {
    const now = playerState().now;
    const s = useSessionStore.getState().session;
    if (!now || now.plan.isLocal || !s || !now.plan.url) return false;
    if (now.plan.url.startsWith(`${s.serverUrl}/`) || this.recovered === now.plan.url) return false;
    this.recovered = now.plan.url;
    if (__DEV__) console.log('[player] the server address changed: the stream starts again on the new address');
    void this.reload({});
    return true;
  }

  /** Reloads the current item at the current position with new stream options. */
  private async reload(opts: Omit<LoadOptions, 'startSeconds'>): Promise<void> {
    const st = playerState();
    if (!st.now) return;
    if (st.now.plan.isLocal) {
      // A downloaded file has its tracks inside; the server is not asked for another stream.
      if (st.status === 'error' && this.lastRequest) void this.play({ ...this.lastRequest, startPositionTicks: secondsToTicks(st.position) });
      return;
    }
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
    if (playerState().playing) this.pause();
    else this.play_();
  }

  play_(): void {
    if (controlGate.intercept({ action: 'play' })) return;
    this.engine.play();
  }

  pause(): void {
    if (controlGate.intercept({ action: 'pause' })) return;
    this.engine.pause();
  }

  seekTo(seconds: number): void {
    const { duration } = playerState();
    const target = Math.max(0, duration > 0 ? Math.min(seconds, duration - 0.5) : seconds);
    if (controlGate.intercept({ action: 'seek', position: target })) return;
    this.directSeek(target);
  }

  /**
   * Player changes that skip the control gate. Watch together uses them to
   * apply the group's commands, so a remote command does not echo.
   */
  readonly direct = {
    play: () => this.engine.play(),
    pause: () => this.engine.pause(),
    seek: (seconds: number) => this.directSeek(seconds),
    rate: (rate: number) => {
      this.engine.setRate(rate);
      setPlayerState({ rate });
    },
    position: () => this.engine.position || playerState().position,
  };

  private directSeek(target: number): void {
    this.engine.seekTo(target);
    setPlayerState({ position: target });
    this.reporter?.tick('Seek');
  }

  skip(delta: number): void {
    this.seekTo((this.engine.position || playerState().position) + delta);
  }

  setRate(rate: number): void {
    if (controlGate.intercept({ action: 'rate', rate })) return;
    this.direct.rate(rate);
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

  /** The engine switches tracks inside this file itself (libmpv, direct play). */
  private engineTracks(plan: StreamPlan): boolean {
    return !!this.engine.tracks && plan.playMethod === 'DirectPlay';
  }

  async selectAudio(index: number): Promise<void> {
    const now = playerState().now;
    if (!now || now.plan.audioIndex === index) return;
    if (this.engineTracks(now.plan)) {
      this.engine.tracks?.selectAudio(index);
      setPlayerState({ now: { ...now, plan: { ...now.plan, audioIndex: index } } });
      this.reporter?.tick('AudioTrackChange');
      return;
    }
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
    if (this.engineTracks(now.plan)) {
      // The engine draws every subtitle format itself (ASS styling, PGS pictures).
      this.engine.tracks?.selectSubtitle(
        option ? { index: option.index, url: option.isExternal ? option.url : null, label: option.label, language: option.language } : null,
      );
      setPlayerState({ cues: null });
      this.setPlanSubtitle(option ? option.index : null);
      return;
    }
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
      const text = /^(file|asset):/.test(option.url) ? ((await readLocalText(option.url)) ?? '') : await jf.getText(api, option.url);
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
    // In a watch-together session the group decides what plays next.
    if (now?.next && usePlaybackSettings.getState().autoplayNext && !controlGate.active) {
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
