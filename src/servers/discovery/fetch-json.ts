import type { FetchJson } from './scan';

/** `fetch` with a timeout. An HTTP error status throws an error with `status`. */
export const fetchJson: FetchJson = async (url, timeoutMs, signal) => {
  const ctl = new AbortController();
  const abort = () => ctl.abort();
  const timer = setTimeout(abort, timeoutMs);
  if (signal.aborted) ctl.abort();
  else signal.addEventListener('abort', abort);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return await res.json();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
};
