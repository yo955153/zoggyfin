import { handleActionResponse, phaseOf, readTaskStatus, type ResponseEffects } from '../response';

function fx() {
  return { toast: jest.fn(), startTask: jest.fn(), refreshItem: jest.fn(), refreshLibrary: jest.fn() } satisfies ResponseEffects;
}

describe('handleActionResponse', () => {
  it('shows the toast and refreshes the library', () => {
    const f = fx();
    handleActionResponse({ toast: 'Started', refresh: 'library' }, f, 'Sent');
    expect(f.toast).toHaveBeenCalledWith('Started', 'ok');
    expect(f.refreshLibrary).toHaveBeenCalled();
    expect(f.refreshItem).not.toHaveBeenCalled();
  });
  it('starts a task with no fallback toast', () => {
    const f = fx();
    handleActionResponse({ task: { id: 't', title: 'Downloading', statusUrl: '/s/t' } }, f, 'Sent');
    expect(f.startTask).toHaveBeenCalledWith({ id: 't', title: 'Downloading', statusUrl: '/s/t' });
    expect(f.toast).not.toHaveBeenCalled();
  });
  it('accepts a toast object and an item refresh', () => {
    const f = fx();
    handleActionResponse({ toast: { text: 'Renamed' }, refresh: 'item' }, f, 'Sent');
    expect(f.toast).toHaveBeenCalledWith('Renamed', 'ok');
    expect(f.refreshItem).toHaveBeenCalled();
  });
  it('shows the fallback for an empty or unknown answer', () => {
    const f = fx();
    handleActionResponse(null, f, 'Sent');
    handleActionResponse({ refresh: 'everything' }, f, 'Sent');
    expect(f.toast).toHaveBeenCalledTimes(2);
    expect(f.toast).toHaveBeenLastCalledWith('Sent', 'ok');
    expect(f.refreshLibrary).not.toHaveBeenCalled();
  });
});

describe('task status', () => {
  it('reads states and progress', () => {
    const s = readTaskStatus({ state: 'running', progress: 0.5 });
    expect(s && phaseOf(s)).toBe('running');
    expect(phaseOf(readTaskStatus({ state: 'queued' })!)).toBe('running');
    expect(phaseOf(readTaskStatus({ state: 'done', refresh: 'library' })!)).toBe('done');
  });
  it('refuses progress over 1 and unknown states', () => {
    expect(readTaskStatus({ state: 'running', progress: 50 })).toBeNull();
    expect(readTaskStatus({ state: 'paused' })).toBeNull();
  });
});
