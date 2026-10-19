/**
 * The person's side: find the server of an invite. Pure apart from the
 * probe, so it is unit-tested.
 *
 * The app sends the one-time password only to an address where the server
 * answers with the server Id of the invite.
 */
import { type AddressPick, pickAddress, type ProbeFn } from '@/servers/addresses';

import { type Invite, savedAddresses } from './payload';

export type Reach = { state: 'ok'; url: string } | { state: 'wrong-server' } | { state: 'unreachable' };

/** Every address at the same time; the first one in the invite's order that answers as the same server wins. */
export async function reachInvite(
  invite: Pick<Invite, 'serverId' | 'addresses'>,
  probe: ProbeFn,
  opts: { timeoutMs?: number; pageIsHttps?: boolean } = {},
): Promise<Reach> {
  const pick: AddressPick = await pickAddress(savedAddresses(invite), invite.serverId, probe, opts);
  if (pick.address) return { state: 'ok', url: pick.address.url };
  if (pick.results.some((r) => !r.ok && r.reason === 'wrong-server')) return { state: 'wrong-server' };
  return { state: 'unreachable' };
}
