/**
 * The contract of the TS bridge (`ZoggyfinTsBridge`, iOS only,
 * modules/zoggyfin-native/ios/TsBridge.swift).
 *
 * AVPlayer cannot open a progressive (endless) MPEG-TS stream over HTTP, the
 * `http://host/.../123.ts` form of many IPTV M3U lists. It does play HLS with
 * MPEG-TS segments. The bridge reads the stream on the device, cuts it into
 * short segments at key frames and serves a live HLS playlist on 127.0.0.1,
 * so expo-video plays it like any HLS stream (Picture in Picture, AirPlay and
 * the lock screen keep working).
 *
 * Use (for the IPTV player): on iOS, when the URL is progressive TS
 * (`isProgressiveTsUrl`) and the HLS form of the stream failed, call
 * `tsBridge.start(url, headers)`, then play `playlistUrl`. Call
 * `stop(id)` when playback ends. A new `start` stops the old session
 * (zapping) unless `keepOthers` is set. `tsBridge` is null on Android, the
 * web, the Mac app and in iOS binaries built before the bridge.
 */

/** Why a session failed, started or ended. */
export type TsBridgeCode =
  /** The URL is not http or https. */
  | 'badUrl'
  /** The source answered with an HTTP error (`httpStatus`). */
  | 'http'
  /** The source is not MPEG-TS (no PAT and PMT in the first 4 MB). */
  | 'notTs'
  /** The PMT has no video and no audio stream. */
  | 'noMedia'
  /** The connection failed. */
  | 'network'
  /** No data, or not ready before `startTimeout`. */
  | 'timeout'
  /** The source closed the stream. */
  | 'upstreamClosed'
  /** A segment could not be written (disk full). */
  | 'disk'
  /** `stop`, `stopAll` or a newer `start` stopped the session. */
  | 'stopped'
  /** The local server could not start. */
  | 'server';

export interface TsBridgeStartOptions {
  /** Keep the other sessions running. Default false: they stop. */
  keepOthers?: boolean;
  /** Segment length the bridge aims for, s (1 to 10, default 2). Segments start at key frames, so a long GOP makes longer segments. */
  targetDuration?: number;
  /** Segments in the playlist (3 to 20, default 6). */
  windowSize?: number;
  /** `start` fails with `timeout` when the playlist is not ready after this long, s (3 to 120, default 20). */
  startTimeout?: number;
}

export interface TsBridgeSession {
  id: string;
  /** `http://127.0.0.1:<port>/<token>/index.m3u8`. Valid until `stop`. */
  playlistUrl: string;
}

/** Status events per session id. */
export type TsBridgeStatus =
  /** The playlist has its first segments (`start` resolves at the same time). */
  | { id: string; type: 'ready' }
  /** The source dropped; the bridge connects again (the playlist gets a discontinuity). */
  | { id: string; type: 'reconnecting'; code: TsBridgeCode; attempt: number }
  /** The source is gone after the retries: the playlist ends, the player plays what is left. */
  | { id: string; type: 'ended'; code: TsBridgeCode }
  | { id: string; type: 'error'; code: TsBridgeCode; message: string; httpStatus?: number };

export interface TsBridge {
  /** Resolves when the playlist is ready to play. Rejects with a `TsBridgeError`. */
  start(url: string, headers?: Record<string, string>, options?: TsBridgeStartOptions): Promise<TsBridgeSession>;
  stop(id: string): Promise<void>;
  stopAll(): Promise<void>;
  /** Returns a function that removes the listener. */
  addStatusListener(listener: (status: TsBridgeStatus) => void): () => void;
}

export class TsBridgeError extends Error {
  readonly code: TsBridgeCode;
  readonly httpStatus?: number;

  constructor(code: TsBridgeCode, message: string, httpStatus?: number) {
    super(message);
    this.name = 'TsBridgeError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** True for an http(s) URL whose path ends in `.ts` (a progressive MPEG-TS stream). */
export function isProgressiveTsUrl(url: string): boolean {
  const m = /^https?:\/\/[^/?#]+(\/[^?#]*)?/i.exec(url.trim());
  return !!m && /\.ts$/i.test(m[1] ?? '');
}
