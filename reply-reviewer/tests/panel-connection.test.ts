import { afterEach, expect, it, vi } from 'vitest';
import { PanelConnection } from '../lib/panelConnection';

function harness() {
  const ports: ReturnType<typeof makePort>[] = [];
  function makePort() {
    let dead = false;
    const listeners = new Set<() => void>();
    return {
      postMessage: vi.fn(() => { if (dead) throw new Error('Attempting to use a disconnected port object'); }),
      disconnect: vi.fn(() => { dead = true; }),
      onDisconnect: { addListener: (fn: () => void) => listeners.add(fn), removeListener: (fn: () => void) => listeners.delete(fn) },
      remoteDisconnect: () => { dead = true; for (const fn of [...listeners]) fn(); },
      listeners,
    };
  }
  const connect = vi.fn(() => { const port = makePort(); ports.push(port); return port as unknown as chrome.runtime.Port; });
  vi.stubGlobal('chrome', { runtime: { lastError: undefined } });
  return { ports, connect, channel: new PanelConnection(connect) };
}
afterEach(() => vi.unstubAllGlobals());
it('establishes a channel only when scanning and reuses a healthy port', () => {
  const { channel, connect, ports } = harness();
  expect(connect).not.toHaveBeenCalled();
  expect(channel.track(7)).toBe(true); expect(channel.track(8)).toBe(true);
  expect(connect).toHaveBeenCalledTimes(1);
  expect(ports[0]!.postMessage).toHaveBeenLastCalledWith({ tabId: 8 });
});
it('reconnects on the next scan after the worker disconnects', () => {
  const { channel, connect, ports } = harness();
  channel.track(7); ports[0]!.remoteDisconnect();
  expect(channel.track(7)).toBe(true);
  expect(connect).toHaveBeenCalledTimes(2);
  expect(ports[0]!.postMessage).toHaveBeenCalledTimes(1);
  expect(ports[0]!.listeners.size).toBe(0);
});
it('recovers when postMessage throws before onDisconnect arrives', () => {
  const { channel, connect, ports } = harness();
  channel.track(7); ports[0]!.disconnect();
  expect(channel.track(7)).toBe(true);
  expect(connect).toHaveBeenCalledTimes(2);
  expect(ports[1]!.postMessage).toHaveBeenCalledWith({ tabId: 7 });
});
it('bounds connection retries and never throws into capture', () => {
  const { channel, connect } = harness();
  connect.mockImplementation(() => { throw new Error('Extension context invalidated.'); });
  expect(channel.track(7)).toBe(false); expect(connect).toHaveBeenCalledTimes(2);
  expect(channel.track(7)).toBe(false); expect(connect).toHaveBeenCalledTimes(4);
});
it('disposing removes listeners and prevents later reconnection', () => {
  const { channel, connect, ports } = harness();
  channel.track(7); channel.dispose(); channel.dispose();
  ports[0]!.remoteDisconnect();
  expect(ports[0]!.listeners.size).toBe(0);
  expect(channel.track(7)).toBe(false); expect(connect).toHaveBeenCalledTimes(1);
});
