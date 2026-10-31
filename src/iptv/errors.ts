/**
 * IPTV errors as short messages a person can act on. A message never holds
 * a URL, a user name or a password: provider URLs carry credentials.
 * Pure, so it is unit-tested.
 */

export type IptvErrorKind =
  | 'blocked'
  | 'network'
  | 'http'
  | 'denied'
  | 'expired'
  | 'disabled'
  | 'notM3u'
  | 'notXmltv'
  | 'empty'
  | 'tooLarge'
  | 'badAddress'
  | 'answer';

export class IptvError extends Error {
  constructor(
    readonly kind: IptvErrorKind,
    readonly status?: number,
  ) {
    super(kind);
    this.name = 'IptvError';
  }
}

const TEXT: Record<IptvErrorKind, string> = {
  blocked:
    'The browser blocked the provider. Most IPTV providers do not allow web pages to read their lists. Use the app on a phone, a TV or a Mac, or a provider that allows it.',
  network: 'Cannot reach the provider. Check the address and the connection.',
  http: 'The provider did not send the list.',
  denied: 'The provider did not accept the user name or password.',
  expired: 'The subscription at this provider has expired.',
  disabled: 'The provider has turned this account off.',
  notM3u: 'This address does not give an M3U playlist.',
  notXmltv: 'The guide address does not give an XMLTV guide.',
  empty: 'The provider sent no channels.',
  tooLarge: 'The list is too large for this device.',
  badAddress: 'Type an address that starts with http:// or https://.',
  answer: 'The provider sent an answer the app cannot read.',
};

/** The message for any thrown value. Unknown errors get a general text, never their own message (it can hold a URL). */
export function iptvErrorText(e: unknown): string {
  if (e instanceof IptvError) {
    if (e.kind === 'http' && e.status) {
      if (e.status === 401 || e.status === 403) return TEXT.denied;
      if (e.status === 404) return 'The provider does not have this list (HTTP 404).';
      return `The provider did not send the list (HTTP ${e.status}).`;
    }
    return TEXT[e.kind];
  }
  if (e instanceof Error && /too large/i.test(e.message)) return TEXT.tooLarge;
  return TEXT.network;
}

/** True for a URL the app may fetch (http or https). */
export function isHttpUrl(url: string): boolean {
  return /^https?:\/\/[^\s/?#]+/i.test(url.trim());
}
