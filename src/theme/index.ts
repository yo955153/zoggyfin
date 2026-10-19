/**
 * Design tokens. Dark first: the app forces the dark appearance for now.
 */
export const colors = {
  background: '#0B0B10',
  surface: '#15151C',
  surfaceRaised: '#1E1E27',
  separator: 'rgba(255,255,255,0.08)',
  text: '#F4F4F6',
  textSecondary: '#A3A3AE',
  textTertiary: '#6E6E7A',
  accent: '#8B7CFF',
  accentText: '#FFFFFF',
  danger: '#FF5D5D',
  progress: '#8B7CFF',
  progressTrack: 'rgba(255,255,255,0.22)',
  overlay: 'rgba(0,0,0,0.45)',
  /** Pressed or hovered row background. */
  pressedRow: 'rgba(255,255,255,0.06)',
  /** Text and icons drawn on images or accent fills. */
  onImage: '#FFFFFF',
  /** Generated art: the type icon and the title. */
  artIcon: 'rgba(255,255,255,0.55)',
  artText: 'rgba(255,255,255,0.92)',
  shadow: '#000000',
  /** The fade from a backdrop into the page, top to bottom. */
  heroFade: ['rgba(11,11,16,0.1)', 'rgba(11,11,16,0.35)', '#0B0B10'] as const,
} as const;

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  xs2: 6,
  sm: 8,
  sm2: 10,
  md: 12,
  row: 14,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
  bar: 2,
  logo: 20,
} as const;

export const type = {
  largeTitle: { fontSize: 32, fontWeight: '700', letterSpacing: 0.3 },
  title: { fontSize: 24, fontWeight: '700' },
  headline: { fontSize: 20, fontWeight: '700' },
  section: { fontSize: 19, fontWeight: '700' },
  body: { fontSize: 16, fontWeight: '400', lineHeight: 22 },
  bodyStrong: { fontSize: 16, fontWeight: '600' },
  callout: { fontSize: 14, fontWeight: '400', lineHeight: 19 },
  caption: { fontSize: 12, fontWeight: '500' },
  tileTitle: { fontSize: 13, fontWeight: '600' },
  tileSubtitle: { fontSize: 12, fontWeight: '400' },
  button: { fontSize: 17, fontWeight: '600' },
  buttonSmall: { fontSize: 15, fontWeight: '600' },
  chip: { fontSize: 14, fontWeight: '600' },
  eyebrow: { fontSize: 14, fontWeight: '600' },
  /** Small upper-case labels over fields and settings groups. */
  label: { fontSize: 12, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.6 },
  artTitle: { fontWeight: '700' },
  artTitleSmall: { fontSize: 12 },
  artTitleLarge: { fontSize: 15 },
  initial: { fontWeight: '700' },
  code: { fontSize: 44, fontWeight: '700', letterSpacing: 8, fontVariant: ['tabular-nums'] },
  number: { fontVariant: ['tabular-nums'] },
} as const;

/** Icon sizes in points. */
export const iconSize = {
  xs: 10,
  sm: 12,
  md: 16,
  lg: 18,
  xl: 20,
  hero: 34,
  state: 44,
} as const;

/** Fixed component sizes in points. */
export const size = {
  avatarSmall: 32,
  avatarLarge: 64,
  iconButton: 50,
  badge: 20,
  logo: 72,
  trackNumber: 28,
  progressBar: 4,
  progressBarThin: 3,
  indicator: 3,
  buttonHeight: 50,
  fieldHeight: 50,
  rowHeight: 48,
  trackRowHeight: 56,
  webFieldHeight: 44,
  stateMinHeight: 220,
  loadingMinHeight: 120,
  /** Max widths keep forms, sheets and pages readable on wide windows. */
  formMaxWidth: 440,
  sheetMaxWidth: 520,
  settingsMaxWidth: 640,
  messageMaxWidth: 320,
  playButtonMaxWidth: 260,
  contentMaxWidth: 1280,
  /** Inset of overlays (progress bar, played badge) inside a tile. */
  overlayInset: 8,
  badgeInset: 6,
  songSeparatorInset: 72,
} as const;

export const shadow = {
  art: { shadowColor: '#000000', shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
} as const;

/** Motion values in milliseconds. */
export const motion = {
  imageFade: 180,
  toastIn: 180,
  toastOut: 160,
  toastVisible: 2400,
  searchDebounce: 300,
} as const;

/** Side gutter for screens and rows. */
export const GUTTER = spacing.lg;
