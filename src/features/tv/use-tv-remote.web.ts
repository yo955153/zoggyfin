import type { TVRemoteEvent } from 'react-native';

/** Web has no TV remote events: the web TV preview reads the keyboard (KeyInput). */
export function useTvRemote(_enabled: boolean, _onEvent: (e: TVRemoteEvent) => void): void {}
