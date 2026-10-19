import { type Api, Jellyfin } from '@jellyfin/sdk';
import { type AxiosInstance, create as createAxios, isAxiosError } from 'axios';

import { clientIdentity } from '@/auth/identity';
import { devOffline, offlineError } from '@/lib/dev-offline';

import { buildAuthHeader } from './auth-header';

const REQUEST_TIMEOUT_MS = 20_000;

let sdk: Jellyfin | null = null;

function getSdk(): Jellyfin {
  if (!sdk) {
    const id = clientIdentity();
    sdk = new Jellyfin({
      clientInfo: { name: id.client, version: id.version },
      deviceInfo: { id: id.deviceId, name: id.device },
    });
  }
  return sdk;
}

/** Called when the server rejects the token of a signed-in session. */
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

/** True when a URL is on the given server, so its credentials may go with it. */
function isForServer(url: string | undefined, baseUrl: string): boolean {
  if (!url) return false;
  return url === baseUrl || url.startsWith(`${baseUrl}/`) || url.startsWith(`${baseUrl}?`);
}

function makeAxios(baseUrl: string, token: string | null): AxiosInstance {
  // An instance of our own, so these interceptors never see unrelated requests.
  const instance = createAxios({ timeout: REQUEST_TIMEOUT_MS });
  instance.interceptors.request.use((config) => {
    if (devOffline()) throw offlineError();
    const url = config.baseURL ? `${config.baseURL}${config.url ?? ''}` : config.url;
    if (isForServer(url, baseUrl)) {
      config.headers.set('Authorization', buildAuthHeader(clientIdentity(), token));
    } else {
      config.headers.delete('Authorization');
    }
    return config;
  });
  instance.interceptors.response.use(undefined, (error: unknown) => {
    if (token && isAxiosError(error) && error.response?.status === 401) {
      onUnauthorized?.();
    }
    return Promise.reject(error);
  });
  return instance;
}

const cache = new Map<string, Api>();

/** Returns an SDK `Api` for a server and token. The same pair returns the same instance. */
export function getApi(baseUrl: string, token: string | null): Api {
  const key = `${baseUrl}|${token ?? ''}`;
  let api = cache.get(key);
  if (!api) {
    api = getSdk().createApi(baseUrl, token ?? undefined, makeAxios(baseUrl, token));
    cache.set(key, api);
  }
  return api;
}

export function dropApi(baseUrl: string, token: string | null): void {
  cache.delete(`${baseUrl}|${token ?? ''}`);
}
