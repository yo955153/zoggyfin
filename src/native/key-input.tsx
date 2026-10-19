import { type ReactNode, useEffect, useRef } from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';

import type { KeyPress } from './key-input-types';

function isTextTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const el = target as HTMLElement;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** Web: listens on the document while mounted. Text fields keep their keys. */
export function KeyInput({
  enabled = true,
  onKey,
  style,
  children,
}: {
  enabled?: boolean;
  onKey: (press: KeyPress) => void;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const handler = useRef(onKey);
  useEffect(() => {
    handler.current = onKey;
  });
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    // A button that kept focus (for example the Play button under the player)
    // would also get Space as a click. Drop that focus.
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && !isTextTarget(active)) active.blur();
    const swallowUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && !isTextTarget(e.target)) e.preventDefault();
    };
    const listener = (e: KeyboardEvent) => {
      if (isTextTarget(e.target) || e.ctrlKey) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const known = [' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape', 'f', 'm', 'c', 'k', 'j', 'l'];
      if (!known.includes(key)) return;
      e.preventDefault();
      if (key === ' ' && e.target instanceof HTMLElement && e.target !== document.body) e.target.blur();
      handler.current({ key, shift: e.shiftKey, meta: e.metaKey, alt: e.altKey });
    };
    document.addEventListener('keydown', listener);
    document.addEventListener('keyup', swallowUp);
    return () => {
      document.removeEventListener('keydown', listener);
      document.removeEventListener('keyup', swallowUp);
    };
  }, [enabled]);
  return <View style={style}>{children}</View>;
}
