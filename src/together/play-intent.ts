/**
 * What a guest shows on its play button: the group's play state, or the
 * control this device just sent until the group agrees with it.
 *
 * A guest's play or pause goes to the host (or the server) first, and the
 * group state comes back one round trip later. Until then the button shows
 * what the user asked, so a second tap toggles again instead of sending the
 * same control twice. A pause also holds the player at once (`holdsPause`):
 * it does not wait for the round trip. A control that the group does not
 * take (another member decided at the same moment) stops counting after
 * `PENDING_LIMIT`.
 */

/** A sent play or pause counts this long at most, ms. */
export const PENDING_LIMIT = 1500;

export class PlayIntent {
  private pending: boolean | null = null;
  private sentAt = 0;

  constructor(private readonly now: () => number) {}

  /** This device sent a play (true) or a pause (false). */
  sent(playing: boolean): void {
    this.pending = playing;
    this.sentAt = this.now();
  }

  /** The group state came: a sent control that it agrees with is done. */
  group(playing: boolean): void {
    if (this.pending === playing) this.pending = null;
  }

  /** Play or pause as the button shows it, from the group state (null: not known). */
  value(group: boolean | null): boolean | null {
    if (this.pending !== null && this.now() - this.sentAt > PENDING_LIMIT) this.pending = null;
    return this.pending ?? group;
  }

  /** True while a pause that this device sent waits for the group (the player holds still). */
  get holdsPause(): boolean {
    return this.value(null) === false;
  }

  clear(): void {
    this.pending = null;
  }
}
