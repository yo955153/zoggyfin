/**
 * The desktop app bridge. The desktop app (`desktop/`, Tauri) loads the web
 * build in a window and adds libmpv for video. This module finds out if the
 * web app runs there and gives the desktop features to the player.
 *
 * Screens do not import this module. The player (`src/player/`) uses it
 * through its engine interface. In a plain browser `isDesktop` is false and
 * nothing here runs.
 *
 * The Rust side calls `window.__zoggyfinDesktop.mpv(event)` for libmpv
 * events and `window.__zoggyfinDesktop.menu(command)` for menu items.
 */
import { router } from 'expo-router';

interface TauriInternals {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

type DesktopWindow = Window & {
  __TAURI_INTERNALS__?: TauriInternals;
  __zoggyfinDesktop?: { mpv(event: MpvEvent): void; menu(command: string): void };
  /** Set by the desktop app before the page loads when libmpv started. */
  __ZOGGYFIN_MPV__?: boolean;
};

function tauri(): TauriInternals | null {
  if (typeof window === 'undefined') return null;
  return (window as DesktopWindow).__TAURI_INTERNALS__ ?? null;
}

/** True in the desktop app (Tauri), false in a browser and on native. */
export const isDesktop: boolean = tauri() !== null;

/** True when the desktop app plays video through libmpv. */
export const hasMpv: boolean = isDesktop && (window as DesktopWindow).__ZOGGYFIN_MPV__ === true;

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = tauri();
  if (!t) return Promise.reject(new Error('Not in the desktop app.'));
  return t.invoke(cmd, args) as Promise<T>;
}

/** A track as libmpv lists it. `ffIndex` is the stream index in the file (Jellyfin's `Index`). */
export interface MpvTrack {
  id: number | null;
  type: 'video' | 'audio' | 'sub' | null;
  ffIndex: number | null;
  external: boolean;
  title: string | null;
  lang: string | null;
  codec: string | null;
  selected: boolean;
}

export type MpvEvent =
  | { type: 'prop'; name: string; value: number | boolean | string | null }
  | { type: 'tracks'; tracks: MpvTrack[] }
  | { type: 'start-file' | 'file-loaded' | 'playback-restart' | 'seek' }
  | { type: 'end-file'; reason: 'eof' | 'error' | 'stop' | 'quit' | 'redirect'; error: string | null };

const mpvListeners = new Set<(e: MpvEvent) => void>();

/** libmpv in the desktop app. All calls fail outside the desktop app. */
export const mpv = {
  command: (...args: (string | number)[]): Promise<void> => invoke('mpv_command', { args: args.map(String) }),
  set: (name: string, value: string | number | boolean): Promise<void> =>
    invoke('mpv_set_property', { name, value: typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value) }),
  get: (name: string): Promise<string | null> => invoke('mpv_get_property', { name }),
  /** Shows the video under the web page (the player is open) or hides it. */
  setVideoVisible: (visible: boolean): Promise<void> => invoke('mpv_set_video_visible', { visible }),
  subscribe(listener: (e: MpvEvent) => void): () => void {
    mpvListeners.add(listener);
    return () => mpvListeners.delete(listener);
  },
};

/** Window features of the desktop app. */
export const desktopWindow = {
  toggleFullscreen: (): Promise<boolean> => invoke<boolean>('desktop_toggle_fullscreen'),
};

/** Menu items that the web app handles. Space stays with the page (play/pause). */
function onMenu(command: string): void {
  switch (command) {
    case 'settings':
      router.navigate('/settings');
      break;
    case 'search':
      router.navigate('/search');
      break;
    case 'home':
      router.navigate('/');
      break;
    case 'library':
      router.navigate('/libraries');
      break;
    case 'music':
      router.navigate('/music');
      break;
    case 'back':
      if (router.canGoBack()) router.back();
      break;
  }
}

/** The CSS class on `<html>` while libmpv shows video under the page. */
const VIDEO_CLASS = 'zf-mpv-video';
/** Marks the video host and its ancestors. Their backgrounds turn transparent. */
const PATH_ATTRIBUTE = 'data-zf-mpv-path';

/**
 * Shows the libmpv video through the page at `host`: the host and its
 * ancestors get transparent backgrounds, and everything painted under them
 * (earlier siblings, such as the screens behind the player) is hidden.
 * Controls painted after the host stay visible. Returns the undo function.
 */
export function showVideoThrough(host: HTMLElement): () => void {
  const path: HTMLElement[] = [];
  for (let el: HTMLElement | null = host; el && el !== document.body; el = el.parentElement) {
    el.setAttribute(PATH_ATTRIBUTE, '');
    path.push(el);
  }
  document.documentElement.classList.add(VIDEO_CLASS);
  void mpv.setVideoVisible(true).catch(() => undefined);
  return () => {
    path.forEach((el) => el.removeAttribute(PATH_ATTRIBUTE));
    document.documentElement.classList.remove(VIDEO_CLASS);
    void mpv.setVideoVisible(false).catch(() => undefined);
  };
}

/**
 * Desktop look: room for the window buttons (the title bar is transparent),
 * a strip to drag the window, and the rules that make the page transparent
 * over the video while the player is open.
 */
/** The height of the transparent title bar with the window buttons. */
const TITLE_BAR = 28;

function installChrome(): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.classList.add('zf-desktop');
  const style = document.createElement('style');
  style.textContent = `
    html.zf-desktop body { -webkit-user-select: none; user-select: none; }
    html.zf-desktop input, html.zf-desktop textarea { -webkit-user-select: text; user-select: text; }
    html.zf-desktop body { background-color: #0B0B0E; }
    html.zf-desktop #root { position: fixed; top: ${TITLE_BAR}px; left: 0; right: 0; bottom: 0; height: auto; }
    html.zf-desktop.zf-fullscreen #root { top: 0; }
    #zf-titlebar { position: fixed; top: 0; left: 0; right: 0; height: ${TITLE_BAR}px; z-index: 2147483647; }
    html.zf-fullscreen #zf-titlebar { display: none; }
    html.${VIDEO_CLASS}, html.${VIDEO_CLASS} body { background: transparent !important; }
    html.${VIDEO_CLASS} [${PATH_ATTRIBUTE}] { background-color: transparent !important; background-image: none !important; }
    html.${VIDEO_CLASS} *:has(~ [${PATH_ATTRIBUTE}]) { visibility: hidden !important; }
  `;
  document.head.appendChild(style);
  const bar = document.createElement('div');
  bar.id = 'zf-titlebar';
  // Tauri starts a window drag on mouse down in an element with this attribute.
  bar.setAttribute('data-tauri-drag-region', '');
  // Full screen has no title bar: the page uses the whole screen.
  const fullscreen = () => html.classList.toggle('zf-fullscreen', window.innerHeight >= window.screen.height - 1);
  window.addEventListener('resize', fullscreen);
  fullscreen();
  const add = () => document.body.appendChild(bar);
  if (document.body) add();
  else document.addEventListener('DOMContentLoaded', add, { once: true });
}

if (isDesktop && typeof window !== 'undefined') {
  (window as DesktopWindow).__zoggyfinDesktop = {
    mpv: (event) => mpvListeners.forEach((l) => l(event)),
    menu: onMenu,
  };
  installChrome();
  // A page reload leaves libmpv as it was: stop what played before.
  void mpv.command('stop').catch(() => undefined);
  void mpv.setVideoVisible(false).catch(() => undefined);
}
