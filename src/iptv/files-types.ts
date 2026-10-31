/**
 * Where the channel lists and guides of the providers live. Paths are
 * relative (`iptv/<providerId>/channels.json`): native puts them under the
 * app's documents folder, the Mac app under its data folder, and the plain
 * web keeps a small copy in the browser's storage.
 */
export interface IptvFiles {
  /** False on the plain web: a large list lives only in memory until the page reloads. */
  readonly persistent: boolean;
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  /** Removes a file or a folder. */
  remove(path: string): Promise<void>;
}
