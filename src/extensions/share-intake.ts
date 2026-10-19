/** Web and the Mac app: links come with `/share?url=` or by paste. Nothing to listen to. */
export function listenForShares(_onText: (text: string) => void): () => void {
  return () => {};
}
