/**
 * Global web styles. The expo-router web tab bar is a radix tab list with
 * fixed CSS; this moves it to a floating bar at the bottom (like the iOS 26
 * tab bar in the design mockups) and themes it with the active tokens.
 */
import { Asset } from 'expo-asset';

const ID = 'zoggyfin-web-styles';

/**
 * Noto Sans Arabic, bundled with the app (no font CDN). The unicode range
 * keeps the browser from loading it until a page shows Arabic text.
 */
const ARABIC_FACES: [weight: number, module: number][] = [
  [400, require('@expo-google-fonts/noto-sans-arabic/400Regular/NotoSansArabic_400Regular.ttf') as number],
  [600, require('@expo-google-fonts/noto-sans-arabic/600SemiBold/NotoSansArabic_600SemiBold.ttf') as number],
  [700, require('@expo-google-fonts/noto-sans-arabic/700Bold/NotoSansArabic_700Bold.ttf') as number],
];
const ARABIC_RANGE = 'U+0600-06FF, U+0750-077F, U+0870-08FF, U+FB50-FDFF, U+FE70-FEFF, U+200C-200F';

function arabicFontFaces(): string {
  return ARABIC_FACES.map(
    ([weight, mod]) =>
      `@font-face { font-family: 'Noto Sans Arabic'; font-style: normal; font-weight: ${weight}; font-display: swap; src: url('${Asset.fromModule(mod).uri}') format('truetype'); unicode-range: ${ARABIC_RANGE}; }`,
  ).join('\n');
}

export function applyWebStyles(vars: Record<string, string>): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = ID;
    document.head.appendChild(el);
  }
  const v = Object.entries(vars)
    .map(([k, val]) => `--zf-${k}: ${val};`)
    .join(' ');
  el.textContent = `
${arabicFontFaces()}
:root { ${v} }
html, body { background: var(--zf-bg); color-scheme: var(--zf-scheme); }
::selection { background: var(--zf-accentSoft); }
[role="tablist"][aria-label="Main"] {
  top: auto !important;
  bottom: max(16px, env(safe-area-inset-bottom)) !important;
  height: 52px !important;
  padding: 6px !important;
  border-radius: 999px !important;
  background: var(--zf-glass) !important;
  -webkit-backdrop-filter: blur(24px) saturate(1.6);
  backdrop-filter: blur(24px) saturate(1.6);
  box-shadow: 0 10px 20px var(--zf-shadow), 0 0 0 0.5px var(--zf-separator);
}
[role="tablist"][aria-label="Main"] [role="tab"] { padding: 0 18px !important; border-radius: 999px !important; }
[role="tablist"][aria-label="Main"] [role="tab"]:focus-visible { outline: 2px solid var(--zf-focus); outline-offset: 2px; }
`;
}
