/**
 * An in-memory nearby network for tests: devices with the native transport
 * contract (`NearbyLinkNative`), Bonjour services, control sockets with a
 * delay on the virtual clock, and drops (a device leaves the network).
 */
import type { LinkEvents, NearbyLinkNative } from '../link-native-types';
import type { VirtualClock } from './sim';

type Listener = (e: unknown) => void;

export class FakeNetwork {
  devices = new Map<string, FakeDevice>();
  /** serviceId → device name. */
  services = new Map<string, { device: string; txt: Record<string, string>; port: number }>();
  /** socketId → [deviceA, deviceB] (the socket id is the same on both ends here only by name prefix). */
  links = new Map<string, { a: string; b: string; aId: string; bId: string }>();
  private n = 0;

  constructor(
    readonly clock: VirtualClock,
    public delay = 2,
  ) {}

  device(name: string): FakeDevice {
    const d = new FakeDevice(name, this);
    this.devices.set(name, d);
    return d;
  }

  nextId(prefix: string): string {
    this.n += 1;
    return `${prefix}${this.n}`;
  }

  /** The device leaves the network: its sockets close on both ends, its services go. */
  drop(name: string): void {
    const d = this.devices.get(name);
    if (!d) return;
    d.online = false;
    for (const [id, s] of [...this.services]) {
      if (s.device === name) {
        this.services.delete(id);
        this.devices.forEach((o) => o.browsing && o.emit('onServiceLost', { serviceId: id }));
      }
    }
    for (const [key, l] of [...this.links]) {
      if (l.a === name || l.b === name) {
        this.links.delete(key);
        this.devices.get(l.a)?.emit('onSocketClosed', { socketId: l.aId, reason: 'lost' });
        this.devices.get(l.b)?.emit('onSocketClosed', { socketId: l.bId, reason: 'lost' });
      }
    }
  }

  /** The device comes back (its app keeps its state). */
  restore(name: string): void {
    const d = this.devices.get(name);
    if (d) d.online = true;
  }

  linkOf(device: string, socketId: string) {
    for (const l of this.links.values()) {
      if ((l.a === device && l.aId === socketId) || (l.b === device && l.bId === socketId)) return l;
    }
    return null;
  }
}

export class FakeDevice implements NearbyLinkNative {
  readonly platform = 'apple' as const;
  online = true;
  browsing = false;
  private listeners = new Map<string, Set<Listener>>();
  private server: { port: number; service: string } | null = null;
  shared = new Map<string, string>();
  sent: { socketId: string; text: string }[] = [];

  constructor(
    readonly name: string,
    private readonly net: FakeNetwork,
  ) {}

  emit(name: keyof LinkEvents, e: unknown): void {
    this.listeners.get(name)?.forEach((l) => l(e));
  }

  on<K extends keyof LinkEvents>(name: K, listener: LinkEvents[K]): { remove(): void } {
    const set = this.listeners.get(name) ?? new Set<Listener>();
    set.add(listener as Listener);
    this.listeners.set(name, set);
    return { remove: () => set.delete(listener as Listener) };
  }

  monotonicNow(): number {
    return this.net.clock.t;
  }

  randomBytes(n: number): string {
    return btoa(String.fromCharCode(...new Array<number>(n).fill(7)));
  }

  async startServer(serviceName: string, txt: Record<string, string>) {
    const port = 50000 + this.net.devices.size;
    this.server = { port, service: serviceName };
    this.net.services.set(serviceName, { device: this.name, txt, port });
    this.net.devices.forEach((d) => d.online && d.browsing && d.emit('onServiceFound', { serviceId: serviceName, name: serviceName, txt }));
    return this.server;
  }

  stopAdvertising(): void {
    if (!this.server) return;
    this.net.services.delete(this.server.service);
  }

  shareFile(urlPath: string, filePath: string): void {
    this.shared.set(urlPath, filePath);
  }

  unshareAll(): void {
    this.shared.clear();
  }

  stopServer(): void {
    this.stopAdvertising();
    this.server = null;
  }

  startBrowsing(): void {
    this.browsing = true;
    for (const [id, s] of this.net.services) {
      if (this.net.devices.get(s.device)?.online) this.emit('onServiceFound', { serviceId: id, name: id, txt: s.txt });
    }
  }

  stopBrowsing(): void {
    this.browsing = false;
  }

  private open(target: string | null): string {
    const id = this.net.nextId(`${this.name}-s`);
    this.net.clock.setTimeout(() => {
      const host = target ? this.net.devices.get(target) : null;
      if (!this.online || !host || !host.online || !host.server) {
        this.emit('onSocketClosed', { socketId: id, reason: 'unreachable' });
        return;
      }
      const remoteId = this.net.nextId(`${host.name}-s`);
      this.net.links.set(id, { a: this.name, b: host.name, aId: id, bId: remoteId });
      host.emit('onSocketOpen', { socketId: remoteId, inbound: true });
      this.emit('onSocketOpen', { socketId: id, inbound: false });
    }, this.net.delay);
    return id;
  }

  connect(serviceId: string): string {
    return this.open(this.net.services.get(serviceId)?.device ?? null);
  }

  connectAddress(host: string): string {
    return this.open(this.net.devices.has(host) ? host : null);
  }

  async mediaBase(serviceId: string | null, host: string | null, port: number): Promise<string> {
    return `http://${serviceId ?? host}:${port}`;
  }

  stopRelay(): void {}

  send(socketId: string, text: string): boolean {
    const l = this.net.linkOf(this.name, socketId);
    if (!l || !this.online) return false;
    this.sent.push({ socketId, text });
    const [other, otherId] = l.a === this.name ? [l.b, l.bId] : [l.a, l.aId];
    this.net.clock.setTimeout(() => {
      if (!this.net.links.has(l.aId)) return;
      const d = this.net.devices.get(other);
      d?.emit('onFrame', { socketId: otherId, text, receivedAt: this.net.clock.t });
    }, this.net.delay);
    return true;
  }

  close(socketId: string): void {
    const l = this.net.linkOf(this.name, socketId);
    if (!l) return;
    this.net.links.delete(l.aId);
    const [other, otherId] = l.a === this.name ? [l.b, l.bId] : [l.a, l.aId];
    this.net.clock.setTimeout(() => this.net.devices.get(other)?.emit('onSocketClosed', { socketId: otherId, reason: null }), this.net.delay);
  }

  async addresses() {
    return [{ name: 'en0', address: '10.0.0.2', kind: 'wifi' as const }];
  }

  stopAll(): void {
    this.stopServer();
    this.browsing = false;
    for (const l of [...this.net.links.values()]) {
      if (l.a === this.name) this.close(l.aId);
      else if (l.b === this.name) this.close(l.bId);
    }
  }

  mediaStats() {
    return { served: 0, requests: 0, relayed: 0 };
  }
}
