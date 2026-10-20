import { createPullRefresh, MIN_REFRESH_MS } from '../use-pull-refresh';

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createPullRefresh', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('a fast refresh keeps the spinner up for the minimum time, then hides it once', async () => {
    const changes: boolean[] = [];
    const ctl = createPullRefresh((r) => changes.push(r));
    ctl.start(() => Promise.resolve());
    expect(changes).toEqual([true]);
    await jest.advanceTimersByTimeAsync(MIN_REFRESH_MS - 1);
    expect(changes).toEqual([true]);
    await jest.advanceTimersByTimeAsync(1);
    expect(changes).toEqual([true, false]);
    expect(ctl.busy).toBe(false);
  });

  it('a refresh that returns nothing still shows the spinner for the minimum time', async () => {
    const changes: boolean[] = [];
    createPullRefresh((r) => changes.push(r)).start(() => undefined);
    await jest.advanceTimersByTimeAsync(100);
    expect(changes).toEqual([true]);
    await jest.advanceTimersByTimeAsync(MIN_REFRESH_MS);
    expect(changes).toEqual([true, false]);
  });

  it('a slow refresh keeps the spinner up until it settles, with no extra wait', async () => {
    const changes: boolean[] = [];
    const d = deferred();
    createPullRefresh((r) => changes.push(r)).start(() => d.promise);
    await jest.advanceTimersByTimeAsync(2000);
    expect(changes).toEqual([true]);
    d.resolve();
    await jest.advanceTimersByTimeAsync(0);
    expect(changes).toEqual([true, false]);
  });

  it('a second pull while one runs is ignored, so the spinner never goes off and on', async () => {
    const changes: boolean[] = [];
    const d = deferred();
    const second = jest.fn();
    const ctl = createPullRefresh((r) => changes.push(r));
    expect(ctl.start(() => d.promise)).toBe(true);
    expect(ctl.start(second)).toBe(false);
    expect(second).not.toHaveBeenCalled();
    d.resolve();
    await jest.advanceTimersByTimeAsync(MIN_REFRESH_MS);
    expect(changes).toEqual([true, false]);
    expect(ctl.start(second)).toBe(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('an error or a throw still hides the spinner', async () => {
    const changes: boolean[] = [];
    const ctl = createPullRefresh((r) => changes.push(r));
    ctl.start(() => Promise.reject(new Error('offline')));
    await jest.advanceTimersByTimeAsync(MIN_REFRESH_MS);
    ctl.start(() => {
      throw new Error('boom');
    });
    await jest.advanceTimersByTimeAsync(MIN_REFRESH_MS);
    expect(changes).toEqual([true, false, true, false]);
  });

  it('waits for every refetch when the refresh returns Promise.all', async () => {
    const changes: boolean[] = [];
    const a = deferred();
    const b = deferred();
    createPullRefresh((r) => changes.push(r)).start(() => Promise.all([a.promise, b.promise]));
    a.resolve();
    await jest.advanceTimersByTimeAsync(MIN_REFRESH_MS * 2);
    expect(changes).toEqual([true]);
    b.resolve();
    await jest.advanceTimersByTimeAsync(0);
    expect(changes).toEqual([true, false]);
  });
});
