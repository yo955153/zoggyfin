import { FLOATING_MINI_HEIGHT, tabBarOverlap } from '../tab-bar-inset';
import { spacing } from '@/theme';

const base = { tv: false, safeBottom: 0, floatingMini: false, autoInset: true };
const mini = FLOATING_MINI_HEIGHT + spacing.sm;

describe('tabBarOverlap', () => {
  it('Android: the tab screen already ends above the bar, so only the mini player counts', () => {
    expect(tabBarOverlap({ ...base, os: 'android', safeBottom: 48 })).toBe(0);
    expect(tabBarOverlap({ ...base, os: 'android', safeBottom: 48, floatingMini: true })).toBe(mini);
  });

  it('iOS: automatic insets clear the bar; other scroll views add the bar and the home indicator', () => {
    expect(tabBarOverlap({ ...base, os: 'ios', safeBottom: 34 })).toBe(0);
    expect(tabBarOverlap({ ...base, os: 'ios', safeBottom: 34, autoInset: false })).toBe(34 + 49);
    expect(tabBarOverlap({ ...base, os: 'ios', safeBottom: 34, floatingMini: true })).toBe(mini);
  });

  it('web: the floating bar sits 16 px over the content', () => {
    expect(tabBarOverlap({ ...base, os: 'web' })).toBe(68);
    expect(tabBarOverlap({ ...base, os: 'web', floatingMini: true })).toBe(68 + mini);
  });

  it('TV has no bottom bar', () => {
    expect(tabBarOverlap({ ...base, os: 'android', tv: true, floatingMini: true })).toBe(0);
  });
});
