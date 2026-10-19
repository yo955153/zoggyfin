/**
 * The native engine: expo-video (AVPlayer on iOS). One player for the app's
 * life, so playback continues when the player screen closes (mini player,
 * background audio, Picture in Picture).
 */
import { createVideoPlayer, isPictureInPictureSupported, type VideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';

import type { EngineListener, EngineSource, EngineStatus, VideoEngine } from './engine-types';

class NativeEngine implements VideoEngine {
  private player: VideoPlayer | null = null;
  private listeners = new Set<EngineListener>();
  private pendingStart: number | null = null;
  private pendingPlay = false;
  private subscriptions: { remove(): void }[] = [];
  /** The mounted view, for Picture in Picture. */
  view: VideoView | null = null;

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
        if (status === 'readyToPlay' && this.pendingStart !== null) {
          const start = this.pendingStart;
          this.pendingStart = null;
          if (start > 0.5) p.currentTime = start;
          if (this.pendingPlay) p.play();
          this.pendingPlay = false;
        }
        this.emit({ type: 'status', status: map[status] ?? 'idle', error: error?.message });
      }),
      p.addListener('playingChange', ({ isPlaying }) => this.emit({ type: 'playing', playing: isPlaying })),
      p.addListener('timeUpdate', ({ currentTime, bufferedPosition }) =>
        this.emit({ type: 'time', position: currentTime, buffered: Math.max(0, bufferedPosition) }),
      ),
      p.addListener('sourceLoad', ({ duration }) => this.emit({ type: 'duration', duration })),
      p.addListener('playToEnd', () => this.emit({ type: 'ended' })),
      p.addListener('playbackRateChange', ({ playbackRate }) => this.emit({ type: 'rate', rate: playbackRate })),
      p.addListener('mutedChange', ({ muted }) => this.emit({ type: 'muted', muted })),
    ];
    this.player = p;
    this.playerListeners.forEach((l) => l());
    return p;
  }

  load(source: EngineSource): void {
    const p = this.ensurePlayer();
    this.pendingStart = source.startSeconds;
    this.pendingPlay = true;
    p.replace({
      uri: source.uri,
      contentType: source.isHls ? 'hls' : 'progressive',
      metadata: { title: source.title, artist: source.subtitle, artwork: source.artworkUri },
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
    this.player?.play();
  }

  pause(): void {
    this.player?.pause();
  }

  seekTo(seconds: number): void {
    if (this.player) this.player.currentTime = Math.max(0, seconds);
  }

  setRate(rate: number): void {
    if (this.player) this.player.playbackRate = rate;
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
