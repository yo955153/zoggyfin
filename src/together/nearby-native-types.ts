export type PeerState = 'connecting' | 'connected' | 'notConnected';

export interface NearbyEvents {
  onPeerFound: (e: { peerId: string; name: string; info: Record<string, string> }) => void;
  onPeerLost: (e: { peerId: string }) => void;
  onInvitation: (e: { inviteId: string; peerId: string; name: string; context: string }) => void;
  onPeerState: (e: { peerId: string; name: string; state: PeerState }) => void;
  /** `receivedAt`: the native monotonic clock (ms) when the data arrived. */
  onMessage: (e: { peerId: string; text: string; receivedAt: number }) => void;
  onError: (e: { message: string }) => void;
}

export interface NearbyNative {
  monotonicNow(): number;
  startHosting(displayName: string, info: Record<string, string>): void;
  startBrowsing(displayName: string): void;
  stopAdvertising(): void;
  stopBrowsing(): void;
  invite(peerId: string, context: string): boolean;
  respond(inviteId: string, accept: boolean): void;
  send(text: string, peerIds: string[] | null, reliable: boolean): boolean;
  stop(): void;
  startMediaServer(): Promise<{ port: number; service: string }>;
  shareFile(urlPath: string, filePath: string, mimeType: string): void;
  stopMediaServer(): void;
  startRelay(service: string): Promise<number>;
  stopRelay(): void;
  mediaStats(): { served: number; requests: number; relayed: number };
  on<K extends keyof NearbyEvents>(name: K, listener: NearbyEvents[K]): { remove(): void };
}
