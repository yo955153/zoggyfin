import type { BridgeReply, BridgeRequest } from '../bridge';

export interface PanelViewProps {
  /** The page to show. It is on the extension's origin. */
  url: string;
  /** The extension's base URL: messages from any other origin are ignored. */
  baseUrl: string;
  handle(req: BridgeRequest): Promise<BridgeReply>;
  onError(message: string): void;
}
