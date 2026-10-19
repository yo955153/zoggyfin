import { actionsFor, createRegistry, type ItemAction } from '../item-actions';

const noop = () => undefined;
const app = { play: noop, openItem: noop, setFavorite: async () => undefined, setPlayed: async () => undefined };

describe('registry', () => {
  it('orders entries, replaces by id and unregisters', () => {
    const r = createRegistry<ItemAction>();
    r.register({ id: 'b', title: 'B', icon: 'x', order: 20, run: noop });
    const offA = r.register({ id: 'a', title: 'A', icon: 'x', order: 10, run: noop });
    r.register({ id: 'b', title: 'B2', icon: 'x', order: 5, run: noop });
    expect(r.list().map((e) => e.title)).toEqual(['B2', 'A']);
    offA();
    expect(r.list().map((e) => e.id)).toEqual(['b']);
  });

  it('notifies subscribers', () => {
    const r = createRegistry<ItemAction>();
    const fn = jest.fn();
    const off = r.subscribe(fn);
    r.register({ id: 'a', title: 'A', icon: 'x', run: noop });
    off();
    r.register({ id: 'b', title: 'B', icon: 'x', run: noop });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('filters actions by when, and hides actions whose filter throws', () => {
    const r = createRegistry<ItemAction>();
    r.register({ id: 'movies', title: 'M', icon: 'x', when: ({ item }) => item.Type === 'Movie', run: noop });
    r.register({ id: 'all', title: 'All', icon: 'x', run: noop });
    r.register({
      id: 'bad',
      title: 'Bad',
      icon: 'x',
      when: () => {
        throw new Error('boom');
      },
      run: noop,
    });
    expect(actionsFor({ item: { Type: 'Movie' }, platform: 'ios', app }, r).map((a) => a.id)).toEqual(['movies', 'all']);
    expect(actionsFor({ item: { Type: 'Audio' }, platform: 'ios', app }, r).map((a) => a.id)).toEqual(['all']);
  });
});
