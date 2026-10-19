/** A key press. `key` follows the web `KeyboardEvent.key` values (" ", "ArrowLeft", "f"). */
export interface KeyPress {
  key: string;
  shift: boolean;
  meta: boolean;
  alt: boolean;
}
