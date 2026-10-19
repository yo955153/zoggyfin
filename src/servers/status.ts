/** The status line of a server's connection. Pure, so it is unit-tested. */
import type { AddressKind, ProbeResult } from './addresses';

export interface ConnectionInfo {
  /** connected: an address answers; unreachable: none answers; unknown: not checked yet. */
  status: 'unknown' | 'connected' | 'unreachable';
  /** True while a check runs. The last result stays on screen meanwhile. */
  checking: boolean;
  url: string | null;
  kind: AddressKind | null;
  /** The kind that the Wi-Fi rule asked for, or null when no rule applied. */
  wanted: AddressKind | null;
  /** The last result of each address, by URL. */
  results: Record<string, ProbeResult>;
  checkedAt: number;
}

export const UNKNOWN_CONNECTION: ConnectionInfo = {
  status: 'unknown',
  checking: false,
  url: null,
  kind: null,
  wanted: null,
  results: {},
  checkedAt: 0,
};

/** Browsers block an http address from an https page (mixed content). */
export const MIXED_CONTENT_TEXT =
  'This page uses https, and the browser blocks http addresses (mixed content). Enter an https address of the server, or open the web app over http.';

export const KIND_LABEL: Record<AddressKind, string> = {
  internal: 'Home network (internal)',
  external: 'Internet (external)',
};

export interface StatusLine {
  text: string;
  /** A second line with a reason, or null. */
  detail: string | null;
  tone: 'ok' | 'warning' | 'muted';
}

export function connectionLine(info: ConnectionInfo | null | undefined): StatusLine {
  if (!info || info.status === 'unknown') {
    return { text: info?.checking ? 'Checking the addresses' : 'Not checked yet', detail: null, tone: 'muted' };
  }
  if (info.status === 'connected' && info.kind) {
    const fallback = info.wanted && info.wanted !== info.kind;
    return {
      text: `Connected through ${KIND_LABEL[info.kind]}`,
      detail: fallback
        ? `The Wi-Fi rule asks for the ${info.wanted} address, but it does not answer. The app uses the ${info.kind} address.`
        : null,
      tone: fallback ? 'warning' : 'ok',
    };
  }
  const results = Object.values(info.results);
  const mixed = results.length > 0 && results.every((r) => !r.ok && r.reason === 'mixed-content');
  const someMixed = results.some((r) => !r.ok && r.reason === 'mixed-content');
  const wrong = results.some((r) => !r.ok && r.reason === 'wrong-server');
  let detail = 'Check that this device is online and that the server runs.';
  if (mixed) detail = 'This page uses https, and the browser blocks http addresses (mixed content). Add an https address, or open the web app over http.';
  else if (someMixed) detail = 'The browser blocks the http addresses on this https page (mixed content). The other addresses do not answer.';
  else if (wrong) detail = 'A different Jellyfin server answers at one address. The app does not send your sign-in there.';
  return { text: 'No address answers', detail, tone: 'warning' };
}
