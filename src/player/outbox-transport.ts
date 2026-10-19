/**
 * Progress reports that survive a missing server. While the server answers,
 * reports go out as usual. When it does not (offline playback of a
 * download), the last position goes to the outbox and is sent later.
 */
import { addToOutbox, clearOutboxFor } from '@/downloads/outbox-store';
import { isOffline, reportNetworkError } from '@/lib/online';

import type { PlaybackReport, ProgressTransport } from './progress-reporter';

export interface OutboxContext {
  serverId: string;
  userId: string;
  runTimeTicks: number | null;
}

export function withOutbox(transport: ProgressTransport, ctx: OutboxContext): ProgressTransport {
  const save = (r: PlaybackReport) =>
    addToOutbox({
      serverId: ctx.serverId,
      userId: ctx.userId,
      itemId: r.itemId,
      positionTicks: r.positionTicks,
      runTimeTicks: ctx.runTimeTicks,
      at: Date.now(),
    });
  const sent = (r: PlaybackReport) => clearOutboxFor(ctx.serverId, ctx.userId, r.itemId);
  const guard = async (r: PlaybackReport, fn: () => Promise<void>, keep: boolean) => {
    if (isOffline()) {
      if (keep) save(r);
      return;
    }
    try {
      await fn();
      if (keep) sent(r);
    } catch (e) {
      if (keep) save(r);
      reportNetworkError();
      throw e;
    }
  };
  return {
    start: (r) => guard(r, () => transport.start(r), false),
    progress: (r, event) => guard(r, () => transport.progress(r, event), true),
    stopped: (r) => guard(r, () => transport.stopped(r), true),
  };
}

/**
 * Progress of a download from a server that is not the active one: it goes
 * only into the outbox, tagged with that download's server and user. The
 * outbox sends it when that server answers. Nothing goes to the active server.
 */
export function outboxOnly(ctx: OutboxContext): ProgressTransport {
  const save = (r: PlaybackReport) =>
    addToOutbox({ serverId: ctx.serverId, userId: ctx.userId, itemId: r.itemId, positionTicks: r.positionTicks, runTimeTicks: ctx.runTimeTicks, at: Date.now() });
  return {
    start: async () => undefined,
    progress: async (r) => save(r),
    stopped: async (r) => save(r),
  };
}

/** True when a download belongs to a server other than the active one. */
export function isForeignDownload(record: { serverId?: string | null } | null | undefined, activeServerId: string | null | undefined): boolean {
  return !!record?.serverId && !!activeServerId && record.serverId !== activeServerId;
}
