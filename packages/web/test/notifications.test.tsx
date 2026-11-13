// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-151 | S15 | v0.1.0] Make the web app an installable PWA with Web Push ──
import { inflateSync } from 'node:zlib';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { png } from '../icons.mjs';
import { appRoute } from '../src/core/nav.js';
import { NotificationsView, type PushState } from '../src/notifications.js';
import { deviceName, notificationTarget, passThrough } from '../src/pwa.js';

const ORIGIN = 'https://pe.example.test';

const state: PushState = {
  publicKey: 'BKey',
  devices: [
    {
      id: 'd1',
      device: 'Chrome on Android',
      endpoint: 'https://fcm.googleapis.com/fcm/send/1',
      createdAt: '2026-10-01T10:00:00Z',
      lastOkAt: null,
    },
  ],
  preferences: { approvals: true, gates: false, deploys: true, mentions: true },
};
const view = (over: Partial<Parameters<typeof NotificationsView>[0]>): string =>
  renderToString(
    <NotificationsView
      state={state}
      support="ok"
      thisDevice={null}
      busy={false}
      error=""
      testResult=""
      onEnable={() => undefined}
      onDisable={() => undefined}
      onPrefs={() => undefined}
      onRemove={() => undefined}
      onTest={() => undefined}
      {...over}
    />,
  );

describe('the installable app', () => {
  it('never answers server data from the cache', () => {
    const u = (p: string): URL => new URL(p, ORIGIN);
    expect(passThrough(u('/api/workspaces'), ORIGIN)).toBe(true);
    expect(passThrough(u('/auth/me'), ORIGIN)).toBe(true);
    expect(passThrough(u('/live'), ORIGIN)).toBe(true);
    expect(passThrough(u('/openapi.json'), ORIGIN)).toBe(true);
    expect(passThrough(new URL('https://cdn.example/x.js'), ORIGIN)).toBe(true);
    expect(passThrough(u('/main.js?v=abc'), ORIGIN)).toBe(false);
    expect(passThrough(u('/projects/1'), ORIGIN)).toBe(false);
    expect(passThrough(u('/apiary'), ORIGIN)).toBe(false);
  });

  it('opens notification clicks only on pages of this app', () => {
    expect(notificationTarget('/runs/1', ORIGIN)).toBe(ORIGIN + '/runs/1');
    expect(notificationTarget('//evil.example/x', ORIGIN)).toBe(ORIGIN + '/');
    expect(notificationTarget('https://evil.example/', ORIGIN)).toBe(ORIGIN + '/');
    expect(notificationTarget(undefined, ORIGIN)).toBe(ORIGIN + '/');
  });

  it('draws real PNG icons of the asked size', () => {
    const file: Buffer = png(48);
    expect(file.subarray(1, 4).toString()).toBe('PNG');
    expect(file.readUInt32BE(16)).toBe(48);
    expect(file.readUInt32BE(20)).toBe(48);
    const idat = file.indexOf('IDAT');
    const raw = inflateSync(file.subarray(idat + 4, idat + 4 + file.readUInt32BE(idat - 4)));
    expect(raw).toHaveLength(48 * (48 * 4 + 1));
    // a corner of the "any" icon is see-through, its middle is the tile
    expect(raw[1 + 3]).toBe(0);
    const maskable = png(48, true);
    const mi = maskable.indexOf('IDAT');
    const mraw = inflateSync(maskable.subarray(mi + 4, mi + 4 + maskable.readUInt32BE(mi - 4)));
    expect(mraw[1 + 3]).toBe(255);
  });

  it('names devices so people recognise them', () => {
    expect(
      deviceName(
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
      ),
    ).toBe('Chrome on Android');
    expect(
      deviceName(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iOS');
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/129.0')).toBe(
      'Edge on Windows',
    );
  });
});

describe('notification settings', () => {
  it('has its own settings page', () => {
    expect(appRoute('/settings/notifications')).toEqual({
      kind: 'settings',
      section: 'notifications',
    });
  });

  it('offers to turn them on, shows the choices and the devices', () => {
    const html = view({});
    expect(html).toContain('Turn on notifications');
    expect(html).toContain('An agent waits for you');
    expect(html).toContain('A gate is ready to sign');
    expect(html).toContain('A deploy failed');
    expect(html).toContain('Someone mentions you');
    expect(html).toContain('Chrome on Android');
    expect(html).not.toContain('This device</span>');
    // gates is off
    expect((html.match(/checked=""/g) ?? []).length).toBe(3);
  });

  it('knows this device once it is subscribed, and offers a test', () => {
    const html = view({ thisDevice: 'https://fcm.googleapis.com/fcm/send/1' });
    expect(html).toContain('Send a test');
    expect(html).toContain('Turn off on this device');
    expect(html).toContain('This device');
  });

  it('says what is in the way: blocked, iPhone without install, or no server key', () => {
    expect(view({ support: 'denied' })).toContain('blocked for this site');
    expect(view({ support: 'needs-install' })).toContain('Add to Home Screen');
    expect(view({ state: { ...state, publicKey: null } })).toContain('ORQIVA_SECRET_KEY');
  });
});
