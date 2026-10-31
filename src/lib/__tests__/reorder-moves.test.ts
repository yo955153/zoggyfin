import { reorderMoves } from '../reorder-moves';

const keys = (position: number, total: number) => reorderMoves(position, total).map((m) => m.key);

describe('reorderMoves', () => {
  it('has no moves for a list of one, or for a position outside the list', () => {
    expect(reorderMoves(0, 1)).toEqual([]);
    expect(reorderMoves(-1, 5)).toEqual([]);
    expect(reorderMoves(5, 5)).toEqual([]);
  });

  it('moves the first entry down only', () => {
    expect(keys(0, 2)).toEqual(['down']);
    expect(keys(0, 5)).toEqual(['down', 'bottom']);
  });

  it('moves the last entry up only', () => {
    expect(keys(1, 2)).toEqual(['up']);
    expect(keys(4, 5)).toEqual(['up', 'top']);
  });

  it('offers top and bottom only when they go further than one step', () => {
    expect(keys(1, 3)).toEqual(['up', 'down']);
    expect(keys(2, 5)).toEqual(['up', 'down', 'top', 'bottom']);
  });

  it('gives the new position of each move', () => {
    expect(reorderMoves(2, 5)).toEqual([
      { key: 'up', label: 'Move up', to: 1 },
      { key: 'down', label: 'Move down', to: 3 },
      { key: 'top', label: 'Move to the top', to: 0 },
      { key: 'bottom', label: 'Move to the bottom', to: 4 },
    ]);
  });
});
