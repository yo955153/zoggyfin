/**
 * The local day ("YYYY-MM-DD") for daily Home choices. It is read again
 * when the app comes to the front, so a Home left open overnight moves to
 * the new day then, and never while the user looks at it.
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { dayKey } from './daily';

export function useDay(): string {
  const [day, setDay] = useState(() => dayKey(new Date()));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setDay(dayKey(new Date()));
    });
    return () => sub.remove();
  }, []);
  return day;
}
