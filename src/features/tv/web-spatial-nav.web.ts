/**
 * Web TV preview: the arrow keys move the focus to the nearest control in
 * that direction, like the D-pad on a TV. Keys a screen has already handled
 * (the players, text fields) are left alone.
 */
import { playerState } from '@/player/store';

type Dir = 'left' | 'right' | 'up' | 'down';

const DIRS: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

const FOCUSABLE = '[tabindex]:not([tabindex="-1"]), button, a[href], input, textarea';

function shown(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

/** The distance from `from` to a control in direction `dir`, or null when it is not that way. */
export function spatialScore(from: DOMRect, to: DOMRect, dir: Dir): number | null {
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;
  const tx = to.left + to.width / 2;
  const ty = to.top + to.height / 2;
  let along: number;
  let across: number;
  if (dir === 'left' || dir === 'right') {
    along = dir === 'left' ? fx - tx : tx - fx;
    across = Math.abs(ty - fy);
  } else {
    along = dir === 'up' ? fy - ty : ty - fy;
    across = Math.abs(tx - fx);
  }
  if (along <= 1) return null;
  return along + across * 2;
}

function isText(el: Element | null): boolean {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

export function installWebSpatialNav(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const onKey = (e: KeyboardEvent) => {
    const dir = DIRS[e.key];
    if (!dir || e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
    // The full player has its own keys.
    if (playerState().presentation === 'full') return;
    const active = document.activeElement as HTMLElement | null;
    if (isText(active) && (dir === 'left' || dir === 'right')) return;
    const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(shown);
    if (!all.length) return;
    e.preventDefault();
    if (!active || active === document.body || !all.includes(active)) {
      all[0]?.focus();
      return;
    }
    const from = active.getBoundingClientRect();
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of all) {
      if (el === active || el.contains(active) || active.contains(el)) continue;
      const score = spatialScore(from, el.getBoundingClientRect(), dir);
      if (score !== null && score < bestScore) {
        best = el;
        bestScore = score;
      }
    }
    if (!best) return;
    best.focus();
    best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
