import { type ClaimState, createPageRegistry, MENU_KEY_MS, NO_KEY, pageMayTakeFocus, pageShouldTakeFocus } from '../page-focus';

describe('page registry', () => {
  it('has no visible page at first', () => {
    const r = createPageRegistry<string>();
    expect(r.active()).toBeNull();
    expect(r.isHidden('home')).toBe(false);
  });

  it('follows focus and blur in either order', () => {
    const r = createPageRegistry<string>();
    r.focus('home');
    // Settings opens: blur of Home first.
    r.blur('home');
    r.focus('settings');
    expect(r.active()).toBe('settings');
    // Back: focus of Home first, then blur of Settings.
    r.focus('home');
    r.blur('settings');
    expect(r.active()).toBe('home');
  });

  it('marks controls of other pages as hidden, never controls outside the pages', () => {
    const r = createPageRegistry<string>();
    r.focus('settings');
    expect(r.isHidden('home')).toBe(true);
    expect(r.isHidden('settings')).toBe(false);
    expect(r.isHidden(null)).toBe(false);
  });

  it('has no visible page while a full-screen page covers the tabs', () => {
    const r = createPageRegistry<string>();
    r.focus('item');
    r.blur('item');
    expect(r.active()).toBeNull();
    expect(r.isHidden('item')).toBe(false);
  });

  it('tells listeners about changes only', () => {
    const r = createPageRegistry<string>();
    const fn = jest.fn();
    const off = r.subscribe(fn);
    r.focus('home');
    r.focus('home');
    r.blur('other');
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    r.focus('search');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('pageMayTakeFocus', () => {
  const now = 10_000;

  it('allows it when the side menu does not have the focus', () => {
    expect(pageMayTakeFocus(false, { key: 'left', at: now }, now)).toBe(true);
  });

  it('keeps a focus the person just moved into the side menu', () => {
    expect(pageMayTakeFocus(true, { key: 'left', at: now - 200 }, now)).toBe(false);
    expect(pageMayTakeFocus(true, { key: 'down', at: now - MENU_KEY_MS }, now)).toBe(false);
  });

  it('takes back a focus Android put into the side menu (Back, a select, no key)', () => {
    expect(pageMayTakeFocus(true, NO_KEY, now)).toBe(true);
    expect(pageMayTakeFocus(true, { key: 'select', at: now - 100 }, now)).toBe(true);
    expect(pageMayTakeFocus(true, { key: 'left', at: now - MENU_KEY_MS - 1 }, now)).toBe(true);
  });
});

describe('pageShouldTakeFocus', () => {
  const base: ClaimState = {
    reason: 'open',
    focusOnPage: false,
    focusOnHiddenPage: false,
    focusNowhere: false,
    menuFocused: false,
    last: NO_KEY,
    now: 10_000,
  };

  it('takes the focus when a page opens or comes back', () => {
    expect(pageShouldTakeFocus(base)).toBe(true);
    expect(pageShouldTakeFocus({ ...base, reason: 'return', focusOnHiddenPage: true })).toBe(true);
  });

  it('asks again when the focus seems to be on the page (the guide keeps it where it is)', () => {
    expect(pageShouldTakeFocus({ ...base, focusOnPage: true })).toBe(true);
  });

  it('leaves a deliberate side menu focus alone', () => {
    expect(pageShouldTakeFocus({ ...base, menuFocused: true, last: { key: 'left', at: base.now - 300 } })).toBe(false);
  });

  it('lets late content take the focus only from a hidden page or from nowhere', () => {
    const mounted = { ...base, reason: 'controlMounted' as const };
    expect(pageShouldTakeFocus({ ...mounted, focusOnHiddenPage: true })).toBe(true);
    expect(pageShouldTakeFocus({ ...mounted, focusNowhere: true })).toBe(true);
    // The search field, the mini player or the page itself (its sheets) keep it.
    expect(pageShouldTakeFocus(mounted)).toBe(false);
    expect(pageShouldTakeFocus({ ...mounted, focusOnPage: true, focusNowhere: true })).toBe(false);
  });
});
