import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/**
 * The drawer is opened by a window event so any coin row can trigger it without threading a
 * setter through every server component. That indirection is worth pinning down, since a
 * typo in the event name would silently stop every entry point from working — the drawer
 * would simply never open, with no error anywhere.
 *
 * Node has EventTarget and CustomEvent built in, so this exercises the real mechanism
 * without a browser.
 */

const bus = new EventTarget();

beforeAll(() => {
  vi.stubGlobal('window', {
    dispatchEvent: (event: Event) => bus.dispatchEvent(event),
    addEventListener: (type: string, listener: EventListener) => bus.addEventListener(type, listener),
    removeEventListener: (type: string, listener: EventListener) => bus.removeEventListener(type, listener),
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const { openCoinDrawer, OPEN_COIN_DRAWER_EVENT } = await import('@/lib/coin-drawer-event');

describe('coin drawer event bus', () => {
  it('dispatches the documented event name', () => {
    // Guards against a rename on one side only.
    expect(OPEN_COIN_DRAWER_EVENT).toBe('openstock:open-coin-drawer');
  });

  it('carries the coin id as the event detail', () => {
    const received: string[] = [];
    const handler = (event: Event) => received.push((event as CustomEvent<string>).detail);
    bus.addEventListener(OPEN_COIN_DRAWER_EVENT, handler);

    openCoinDrawer('bitcoin');

    bus.removeEventListener(OPEN_COIN_DRAWER_EVENT, handler);
    expect(received).toEqual(['bitcoin']);
  });

  it('fires once per call, so opening two coins queues two opens', () => {
    let count = 0;
    const handler = () => {
      count += 1;
    };
    bus.addEventListener(OPEN_COIN_DRAWER_EVENT, handler);

    openCoinDrawer('bitcoin');
    openCoinDrawer('ethereum');

    bus.removeEventListener(OPEN_COIN_DRAWER_EVENT, handler);
    expect(count).toBe(2);
  });

  it('ignores an empty id rather than opening an empty drawer', () => {
    let count = 0;
    const handler = () => {
      count += 1;
    };
    bus.addEventListener(OPEN_COIN_DRAWER_EVENT, handler);

    openCoinDrawer('');

    bus.removeEventListener(OPEN_COIN_DRAWER_EVENT, handler);
    expect(count).toBe(0);
  });

  it('does not throw when there is no window (server render)', () => {
    vi.stubGlobal('window', undefined);
    expect(() => openCoinDrawer('bitcoin')).not.toThrow();
    // Restore for any later test in this file.
    vi.stubGlobal('window', {
      dispatchEvent: (event: Event) => bus.dispatchEvent(event),
      addEventListener: (type: string, listener: EventListener) => bus.addEventListener(type, listener),
      removeEventListener: (type: string, listener: EventListener) => bus.removeEventListener(type, listener),
    });
  });
});
