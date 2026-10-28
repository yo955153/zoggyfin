/**
 * The native engine: expo-video (AVPlayer on iOS). One player for the app's
 * life, so playback continues when the player screen closes (mini player,
 * background audio, Picture in Picture).
 */
import { createVideoPlayer, isPictureInPictureSupported, type VideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Platform, type StyleProp, View, type ViewStyle } from 'react-native';

import { setAutoPictureInPicture } from '@/native/zoggyfin-native';

import type { EngineListener, EngineSource, EngineStatus, VideoEngine } from './engine-types';

/**
 * iOS: with no artist or artwork from the app, expo-video puts the file's own
 * metadata items (AVMetadataItem) into the Now Playing info, and MediaPlayer
 * aborts the app on them. A download with cover art inside crashed on every
 * play. So the app always gives both. This URL loads nothing: no artwork shows.
 * patches/expo-video fixes the cause for the next native build.
 */
const NO_ARTWORK = 'file:///dev/null';

class NativeEngine implements VideoEngine {
  private player: VideoPlayer | null = null;
  private listeners = new Set<EngineListener>();
  private pendingStart: number | null = null;
  private pendingPlay = false;
  private subscriptions: { remove(): void }[] = [];
  private playing = false;
  /**
   * The player is to play: the app asked for it, or the player plays (or
   * stops) from outside the app, such as the lock screen. While it is false,
   * `setRate` only keeps the rate.
   */
  private wantPlay = false;
  /** The player waits for data (a stall stops it, but it is still to play). */
  private loading = false;
  /** The rate the session asked for. */
  private rate = 1;
  /**
   * True once the current source is ready. Android: a player made with no
   * source prepares an empty timeline, ExoPlayer ends it at once and
   * expo-video sends `playToEnd`, which arrives after the real source is set.
   */
  private sourceReady = false;
  private viewMounted = false;

  /** The mounted view, for Picture in Picture. */
  get view(): VideoView | null {
    return this.mountedView;
  }
  set view(v: VideoView | null) {
    this.mountedView = v;
    this.viewMounted = v !== null;
    this.updateAutoPip();
  }
  private mountedView: VideoView | null = null;

  /**
   * Android 8 to 11 have no automatic Picture in Picture: the native module
   * enters it on Home while a video plays on screen. No effect on iOS.
   */
  private updateAutoPip() {
    setAutoPictureInPicture(this.viewMounted && this.playing);
  }

  get pipSupported(): boolean {
    try {
      return isPictureInPictureSupported();
    } catch {
      return false;
    }
  }

  get position(): number {
    return this.player?.currentTime ?? 0;
  }



  private emit: EngineListener = (e) => this.listeners.forEach((l) => l(e));

  private ensurePlayer(): VideoPlayer {
    if (this.player) return this.player;
    const p = createVideoPlayer(null);
    p.timeUpdateEventInterval = 0.5;
    p.staysActiveInBackground = true;
    p.showNowPlayingNotification = true;
    p.allowsExternalPlayback = true;
    p.audioMixingMode = 'doNotMix';
    p.keepScreenOnWhilePlaying = true;
    this.subscriptions = [
      p.addListener('statusChange', ({ status, error }) => {
        const map: Record<string, EngineStatus> = { idle: 'idle', loading: 'loading', readyToPlay: 'ready', error: 'error' };
        if (status === 'readyToPlay') this.sourceReady = true;
        this.loading = status === 'loading';
        if (status === 'readyToPlay' && this.pendingStart !== null) {
          const start = this.pendingStart;
          this.pendingStart = null;
          if (start > 0.5 || !this.pendingPlay) p.currentTime = start;
          if (this.pendingPlay) this.startPlayer(p);
          this.pendingPlay = false;
        }
        this.emit({ type: 'status', status: map[status] ?? 'idle', error: error?.message });
      }),
      p.addListener('playingChange', ({ isPlaying }) => {
        this.playing = isPlaying;
        if (isPlaying) {
          // It plays (also from outside the app: the lock screen, a headset): give it the rate it kept.
          this.wantPlay = true;
          if (p.playbackRate !== this.rate) p.playbackRate = this.rate;
        } else if (!this.loading) {
          // A pause (also from outside the app). A stall is not one.
          this.wantPlay = false;
        }
        this.updateAutoPip();
        this.emit({ type: 'playing', playing: isPlaying });
      }),
      p.addListener('timeUpdate', ({ currentTime, bufferedPosition }) =>
        this.emit({ type: 'time', position: currentTime, buffered: Math.max(0, bufferedPosition) }),
      ),
      p.addListener('sourceLoad', ({ duration }) => this.emit({ type: 'duration', duration })),
      p.addListener('playToEnd', () => {
        if (this.sourceReady) this.emit({ type: 'ended' });
      }),
      p.addListener('playbackRateChange', ({ playbackRate }) => this.emit({ type: 'rate', rate: playbackRate })),
      p.addListener('mutedChange', ({ muted }) => this.emit({ type: 'muted', muted })),
    ];
    this.player = p;
    // A new player starts at its default rate.
    this.rate = 1;
    this.loading = false;
    this.playerListeners.forEach((l) => l());
    return p;
  }

  load(source: EngineSource): void {
    const p = this.ensurePlayer();
    this.pendingStart = source.startSeconds;
    this.pendingPlay = source.autoplay !== false;
    this.wantPlay = this.pendingPlay;
    this.sourceReady = false;
    // Android's default is 20 s; iOS's 0 lets AVPlayer decide (it can read minutes ahead).
    p.bufferOptions = source.readAhead
      ? { preferredForwardBufferDuration: source.readAhead, minBufferForPlayback: 2, waitsToMinimizeStalling: true }
      : { preferredForwardBufferDuration: Platform.OS === 'ios' ? 0 : 20, minBufferForPlayback: 2, waitsToMinimizeStalling: true };
    p.replace({
      uri: source.uri,
      contentType: source.isHls ? 'hls' : 'progressive',
      metadata: { title: source.title, artist: source.subtitle ?? '', artwork: source.artworkUri ?? (Platform.OS === 'ios' ? NO_ARTWORK : undefined) },
    }, true);
  }

  /**
   * Releases the player. A player that was emptied with `replace(null)` does
   * not load the next source reliably, so every new item gets a new player.
   */
  unload(): void {
    const p = this.player;
    this.pendingStart = null;
    this.pendingPlay = false;
    if (!p) return;
    this.subscriptions.forEach((s) => s.remove());
    this.subscriptions = [];
    this.player = null;
    this.playing = false;
    this.wantPlay = false;
    this.updateAutoPip();
    this.playerListeners.forEach((l) => l());
    try {
      p.pause();
      p.release();
    } catch {
      // Already released.
    }
  }

  /** The surface re-renders when the player object changes. */
  private playerListeners = new Set<() => void>();
  subscribePlayer = (l: () => void) => {
    this.playerListeners.add(l);
    return () => {
      this.playerListeners.delete(l);
    };
  };
  currentPlayer = (): VideoPlayer | null => this.player;

  play(): void {
    this.wantPlay = true;
    if (this.player) this.startPlayer(this.player);
  }

  /** Plays, then gives the player the rate that `setRate` kept while it was paused. */
  private startPlayer(p: VideoPlayer): void {
    p.play();
    if (p.playbackRate !== this.rate) p.playbackRate = this.rate;
  }

  pause(): void {
    this.wantPlay = false;
    this.player?.pause();
  }

  seekTo(seconds: number): void {
    if (this.player) this.player.currentTime = Math.max(0, seconds);
  }

  /**
   * On iOS, expo-video sets `AVPlayer.rate` for `playbackRate`, and a rate
   * above zero starts a paused AVPlayer. So a paused player only keeps the
   * rate, and takes it on the next play. Else a pause, then a rate change (a
   * watch-together guest ends a drift nudge when the group pauses) starts the
   * player again, and the binding sends that start to the group as a play.
   */
  setRate(rate: number): void {
    this.rate = rate;
    const p = this.player;
    if (!p) return;
    if (Platform.OS === 'ios' && !this.wantPlay) return;
    p.playbackRate = rate;
  }

  setMuted(muted: boolean): void {
    if (this.player) this.player.muted = muted;
  }

  startPip(): void {
    void this.view?.startPictureInPicture().catch(() => undefined);
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called by the surface. */
  pipChanged(active: boolean): void {
    this.emit({ type: 'pip', active });
  }
}

let engine: NativeEngine | null = null;

function nativeEngine(): NativeEngine {
  engine ??= new NativeEngine();
  return engine;
}

export function getEngine(): VideoEngine {
  return nativeEngine();
}

function attachView(view: VideoView | null) {
  nativeEngine().view = view;
}

function detachView(view: VideoView | null) {
  const e = nativeEngine();
  if (e.view === view) e.view = null;
}

/** Draws the video. `fill` crops to the window; otherwise the whole frame shows. */
export function VideoSurface({ fill, style }: { fill: boolean; style?: StyleProp<ViewStyle> }) {
  const e = nativeEngine();
  const ref = useRef<VideoView>(null);
  const player = useSyncExternalStore(e.subscribePlayer, e.currentPlayer);
  useEffect(() => {
    const view = ref.current;
    attachView(view);
    return () => detachView(view);
  }, [player]);
  if (!player) return <View style={style} />;
  return (
    <VideoView
      ref={ref}
      player={player}
      style={style}
      nativeControls={false}
      contentFit={fill ? 'cover' : 'contain'}
      allowsPictureInPicture
      startsPictureInPictureAutomatically
      onPictureInPictureStart={() => e.pipChanged(true)}
      onPictureInPictureStop={() => e.pipChanged(false)}
    />
  );
}
