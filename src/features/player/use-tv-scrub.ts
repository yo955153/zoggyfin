/**
 * TV: Left and Right on a focused seek bar. Each press moves a target (a tap
 * 10 s, a held key faster, player/tv-keys.ts); the seek runs SCRUB_COMMIT_MS
 * after the last press, or at once on `commit` (Select). A held key repeats
 * every HOLD_REPEAT_MS until it is let go. The music player uses it; the
 * video player has its own copy with the controls' extra rules.
 */
import { useEffect, useRef, useState } from 'react';

import { NO_RUN, nextRun, SCRUB_COMMIT_MS, type ScrubRun, scrubTarget } from '@/player/tv-keys';

/** A held Left or Right steps this often (ms). */
const HOLD_REPEAT_MS = 150;

export interface TvScrub {
  /** The time the bar shows while scrubbing, or null. */
  target: number | null;
  /** One press of Left (-1) or Right (1). */
  press: (dir: -1 | 1) => void;
  /** A held Left or Right starts (true) or ends (false). */
  hold: (dir: -1 | 1, start: boolean) => void;
  /** Seek to the target now (Select). */
  commit: () => void;
}

export function useTvScrub(read: () => { position: number; duration: number }, seekTo: (seconds: number) => void): TvScrub {
  const [target, setTargetState] = useState<number | null>(null);
  const targetRef = useRef<number | null>(null);
  const run = useRef<ScrubRun>(NO_RUN);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const io = useRef({ read, seekTo });
  useEffect(() => {
    io.current = { read, seekTo };
  });
  useEffect(
    () => () => {
      if (commitTimer.current) clearTimeout(commitTimer.current);
      if (holdTimer.current) clearInterval(holdTimer.current);
    },
    [],
  );

  const setTarget = (v: number | null) => {
    targetRef.current = v;
    setTargetState(v);
  };
  const stopHold = () => {
    if (holdTimer.current) clearInterval(holdTimer.current);
    holdTimer.current = null;
  };
  const commit = () => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = null;
    stopHold();
    run.current = NO_RUN;
    const to = targetRef.current;
    setTarget(null);
    if (to !== null) io.current.seekTo(to);
  };
  const press = (dir: -1 | 1) => {
    const r = nextRun(run.current, dir, Date.now());
    run.current = r.run;
    if (!r.apply) return;
    const { position, duration } = io.current.read();
    setTarget(scrubTarget(targetRef.current ?? position, run.current, duration));
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(commit, SCRUB_COMMIT_MS);
  };
  const hold = (dir: -1 | 1, start: boolean) => {
    stopHold();
    if (!start) return;
    press(dir);
    holdTimer.current = setInterval(() => press(dir), HOLD_REPEAT_MS);
  };
  return { target, press, hold, commit };
}
