/**
 * Turns any thrown value into a message a person can act on.
 * It reads only plain fields, so it does not depend on axios at runtime.
 */

export type ErrorKind = 'offline' | 'timeout' | 'auth' | 'forbidden' | 'notFound' | 'server' | 'unknown';

export interface DescribedError {
  kind: ErrorKind;
  title: string;
  message: string;
  status?: number;
}

interface ErrorLike {
  message?: unknown;
  code?: unknown;
  response?: { status?: unknown };
  status?: unknown;
}

function asErrorLike(e: unknown): ErrorLike {
  return typeof e === 'object' && e !== null ? (e as ErrorLike) : {};
}

export function describeError(e: unknown): DescribedError {
  const err = asErrorLike(e);
  const statusRaw = err.response?.status ?? err.status;
  const status = typeof statusRaw === 'number' ? statusRaw : undefined;
  const code = typeof err.code === 'string' ? err.code : undefined;
  const message = typeof err.message === 'string' ? err.message : '';

  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || /timeout/i.test(message)) {
    return { kind: 'timeout', title: 'The server is slow to answer', message: 'The request took too long. Check the connection and try again.' };
  }
  if (status === 401) {
    return { kind: 'auth', status, title: 'Sign-in needed', message: 'The server did not accept the credentials. Sign in again.' };
  }
  if (status === 403) {
    return { kind: 'forbidden', status, title: 'No access', message: 'This account does not have access to this item.' };
  }
  if (status === 404) {
    return { kind: 'notFound', status, title: 'Not found', message: 'The server does not have this item any more.' };
  }
  if (status !== undefined && status >= 500) {
    return { kind: 'server', status, title: 'Server error', message: `The server had a problem (HTTP ${status}). Try again in a moment.` };
  }
  if (code === 'ERR_NETWORK' || /network/i.test(message) || (status === undefined && code !== undefined)) {
    return { kind: 'offline', title: 'Cannot reach the server', message: 'Check that the phone is online and the server is running.' };
  }
  if (status !== undefined) {
    return { kind: 'unknown', status, title: 'Request failed', message: `The server answered with HTTP ${status}.` };
  }
  return { kind: 'unknown', title: 'Something went wrong', message: message || 'An unknown error occurred.' };
}
