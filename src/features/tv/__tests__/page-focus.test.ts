import { claimTarget, type ClaimState, createPageRegistry, MENU_KEY_MS, NO_KEY, pageMayTakeFocus, pageShouldTakeFocus } from '../page-focus';

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

describe('claimTarget', () => {
  it('gives an opening page the control that asks for the first focus', () => {
    expect(claimTarget('open', false, true)).toBe('preferred');
    expect(claimTarget('controlMounted', false, true)).toBe('preferred');
  });

  it('uses the guide when no control asks for the first focus', () => {
    expect(claimTarget('open', false, false)).toBe('guide');
  });

  it('keeps a focus the person already has on the page', () => {
    expect(claimTarget('open', true, true)).toBe('guide');
  });

  it('gives a page that comes back the control it had last', () => {
    expect(claimTarget('return', false, true)).toBe('guide');
  });

  it('moves the focus to a first tile that mounts after a chip took it', () => {
    expect(claimTarget('firstFocusMounted', true, true)).toBe('preferred');
  });
});

describe('a first tile that mounts late', () => {
  const base: ClaimState = {
    reason: 'firstFocusMounted',
    focusOnPage: true,
    focusOnHiddenPage: false,
    focusNowhere: false,
    menuFocused: false,
    last: NO_KEY,
    now: 10_000,
  };

  it('takes the focus from a chip the page gave it, before any key', () => {
    expect(pageShouldTakeFocus({ ...base, keyedSinceOpen: false })).toBe(true);
  });

  it('leaves a focus the person moved on the page (a tab of the strip)', () => {
    expect(pageShouldTakeFocus({ ...base, keyedSinceOpen: true })).toBe(false);
  });

  it('takes a focus that was lost or on a hidden page, keys or not', () => {
    expect(pageShouldTakeFocus({ ...base, focusOnPage: false, focusNowhere: true, keyedSinceOpen: true })).toBe(true);
    expect(pageShouldTakeFocus({ ...base, focusOnPage: false, focusOnHiddenPage: true, keyedSinceOpen: true })).toBe(true);
  });

  it('never takes the focus from the search field', () => {
    expect(pageShouldTakeFocus({ ...base, focusOnPage: false, textFocused: true, keyedSinceOpen: false })).toBe(false);
  });
});
