/**
 * Global web styles. The expo-router web tab bar is a radix tab list with
 * fixed CSS; this moves it to a floating bar at the bottom (like the iOS 26
 * tab bar in the design mockups) and themes it with the active tokens.
 */
const ID = 'zoggyfin-web-styles';

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
