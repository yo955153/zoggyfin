/**
 * The moves of one entry in a list that people reorder. Touch drags the
 * entry; a TV remote (and anyone else with no drag) picks a move from the
 * entry's menu instead. Pure, so it is unit-tested.
 */

export type ReorderMoveKey = 'up' | 'down' | 'top' | 'bottom';

export interface ReorderMove {
  key: ReorderMoveKey;
  label: string;
  /** The entry's new position. */
  to: number;
}

/**
 * The moves that change something for the entry at `position` in a list of
 * `total`: Move up and Move down by one, and Move to the top and Move to the
 * bottom when they go further than one step.
 */
export function reorderMoves(position: number, total: number): ReorderMove[] {
  if (total < 2 || position < 0 || position >= total) return [];
  const moves: ReorderMove[] = [];
  if (position > 0) moves.push({ key: 'up', label: 'Move up', to: position - 1 });
  if (position < total - 1) moves.push({ key: 'down', label: 'Move down', to: position + 1 });
  if (position > 1) moves.push({ key: 'top', label: 'Move to the top', to: 0 });
  if (position < total - 2) moves.push({ key: 'bottom', label: 'Move to the bottom', to: total - 1 });
  return moves;
}
