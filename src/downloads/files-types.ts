/** File operations the download manager needs. Paths are relative to the document directory. */
export interface DownloadFiles {
  /** The document directory as a file:// URI, or null where there is none (web). */
  documentsDir(): string | null;
  /** An absolute path (no scheme) for a relative path, for the native downloader. */
  absolutePath(relative: string): string;
  ensureDir(relative: string): void;
  exists(relative: string): boolean;
  /** Size in bytes of a file, or 0. */
  size(relative: string): number;
  /** Size in bytes of a file, or 0, read from the disk (the desktop app cannot read it synchronously). */
  statSize(relative: string): Promise<number>;
  remove(relative: string): void;
  writeText(relative: string, text: string): void;
  readText(relative: string): string | null;
  /** Reads a text file by its local URI (`localExtraUri`: subtitles, lyrics). */
  readUriText(uri: string): Promise<string | null>;
  /** Downloads a small file (image, subtitle) in the foreground. */
  fetchFile(url: string, relative: string, headers?: Record<string, string>): Promise<number>;
  /** Free and total bytes on the device, or null when unknown. */
  diskSpace(): { free: number; total: number } | null;
  /** Folders under the downloads root. */
  listDirs(relative: string): string[];
  /** Keeps a folder out of iCloud and iTunes backups, where the platform allows it. */
  excludeFromBackup(relative: string): void;
}
