/**
 * The addresses that go into an invite. Pure, so it is unit-tested.
 *
 * The person is often away from the server's home network, so an invite has
 * the internet, Tailscale and VPN addresses by default and leaves out home
 * network addresses. The admin can change the choice.
 */
import { addressNetwork, type ServerAddress } from '@/servers/addresses';

import type { AddressLabel, InviteAddress } from './payload';

export const LABEL_TEXT: Record<AddressLabel, string> = {
  internet: 'Internet',
  tailscale: 'Tailscale',
  vpn: 'VPN',
  home: 'Home network',
};

/**
 * The label of a saved address. A private address that the admin saved as
 * external, or marked as VPN here, is a VPN address (for example WireGuard).
 */
export function labelFor(address: ServerAddress, markedVpn: ReadonlySet<string> = new Set()): AddressLabel {
  const net = addressNetwork(address.url);
  if (net === 'tailscale') return 'tailscale';
  if (net === 'internet') return 'internet';
  return address.kind === 'external' || markedVpn.has(address.url) ? 'vpn' : 'home';
}

export interface AddressChoice extends InviteAddress {
  /** In the invite by default. */
  include: boolean;
}

/** All saved addresses with their labels, in the saved order. Home network addresses are not included by default. */
export function addressChoices(addresses: readonly ServerAddress[], markedVpn: ReadonlySet<string> = new Set()): AddressChoice[] {
  return addresses.map((a) => {
    const label = labelFor(a, markedVpn);
    return { url: a.url, label, include: label !== 'home' };
  });
}

/** The addresses for the payload: the chosen ones, in the saved order. */
export function chosenAddresses(choices: readonly AddressChoice[], chosen: ReadonlySet<string>): InviteAddress[] {
  return choices.filter((c) => chosen.has(c.url)).map(({ url, label }) => ({ url, label }));
}

/**
 * The warning for the admin. `none`: no address is chosen. `home-only`: no
 * chosen address works away from home. Null: at least one works away from home.
 */
export function addressWarning(list: readonly InviteAddress[]): 'none' | 'home-only' | null {
  if (!list.length) return 'none';
  return list.some((a) => a.label !== 'home') ? null : 'home-only';
}
