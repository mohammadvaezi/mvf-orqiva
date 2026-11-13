// ── [PCODE-320 | S15 | v0.1.0] T32.5b The bug-capture browser extension for Chrome and Firefox ──
//    Why:  the rings forget the oldest; elements are named the way people point at them and typed text is
//          never kept; the client signs in with the token, uploads and files, and says what went wrong in
//          words; the report leaves out what was switched off; each browser gets its own manifest.
import { describe, expect, it } from 'vitest';
import {
  Ring,
  consoleText,
  describeTarget,
  pathOf,
  type Collected,
  type ElementLike,
} from '../src/lib/collect.js';
import { dataUrlBytes, makeClient, reportBody, serverUrl } from '../src/lib/client.js';
import { manifestFor } from '../src/lib/manifest.js';

const el = (tagName: string, attrs: Record<string, string> = {}, text = ''): ElementLike => ({
  tagName,
  getAttribute: (n) => attrs[n] ?? null,
  textContent: text,
});

describe('what a page keeps', () => {
  it('keeps the last entries only', () => {
    const r = new Ring<number>(3);
    for (const n of [1, 2, 3, 4, 5]) r.push(n);
    expect(r.list()).toEqual([3, 4, 5]);
  });

  it('writes console calls as a line', () => {
    expect(consoleText(['total', 3, { a: 1 }, new TypeError('x is undefined'), undefined])).toBe(
      'total 3 {"a":1} TypeError: x is undefined undefined',
    );
  });

  it('names elements the way people point at them, never what was typed', () => {
    expect(describeTarget(el('BUTTON', {}, '  Pay\n now '))).toBe('button "Pay now"');
    expect(describeTarget(el('A', { 'aria-label': 'Open the cart' }, '🛒'))).toBe(
      'a "Open the cart"',
    );
    expect(describeTarget(el('INPUT', { type: 'email', name: 'email', value: 'ada@x.org' }))).toBe(
      'input[type=email][name=email]',
    );
    expect(describeTarget(el('TEXTAREA', { placeholder: 'Your note' }))).toBe(
      'textarea[name=Your note]',
    );
    expect(describeTarget(el('DIV', { id: 'checkout-panel' }))).toBe('div#checkout-panel');
    expect(describeTarget(el('SPAN', {}, 'x'.repeat(80)))).toBe('span "' + 'x'.repeat(39) + '…"');
    expect(pathOf('https://shop.test/checkout?mail=ada@x.org#pay')).toBe('/checkout#pay');
  });
});

describe('talking to the server', () => {
  const settings = { server: 'https://orqiva.test', token: 'orq_t', workspaceId: 'w1' };

  it('takes https, or http on this computer only', () => {
    expect(serverUrl(' https://orqiva.example.com/ ')).toBe('https://orqiva.example.com');
    expect(serverUrl('http://localhost:8480')).toBe('http://localhost:8480');
    expect(serverUrl('http://orqiva.example.com')).toBeNull();
    expect(serverUrl('orqiva')).toBeNull();
  });

  it('uploads and files with the token, and says what went wrong', async () => {
    const calls: { url: string; method: string; auth: string; type: string }[] = [];
    const fake = ((url: string, init: RequestInit) => {
      const h = init.headers as Record<string, string>;
      calls.push({
        url,
        method: init.method ?? 'GET',
        auth: h['authorization'] ?? '',
        type: h['content-type'] ?? '',
      });
      if (url.endsWith('/projects/bad/bug-reports'))
        return Promise.resolve(
          new Response('{"error":{"message":"Project not found"}}', { status: 404 }),
        );
      if (url.includes('/files?'))
        return Promise.resolve(new Response('{"id":"f1"}', { status: 201 }));
      return Promise.resolve(new Response('{"ref":"SHOP-7","url":"/items/i7"}', { status: 201 }));
    }) as unknown as typeof fetch;
    const c = makeClient(settings, fake);
    const png = dataUrlBytes('data:image/png;base64,iVBORw0KGgo=');
    expect([png.mime, png.data.length]).toEqual(['image/png', 8]);
    expect(await c.upload('p1', 'screenshot.png', png.mime, png.data)).toBe('f1');
    expect(await c.fileBug('p1', { title: 'x' })).toEqual({
      ref: 'SHOP-7',
      url: 'https://orqiva.test/items/i7',
    });
    await expect(c.fileBug('bad', {})).rejects.toThrow('Project not found');
    expect(calls[0]).toEqual({
      url: 'https://orqiva.test/api/workspaces/w1/files?name=screenshot.png&projectId=p1&read=0',
      method: 'POST',
      auth: 'Bearer orq_t',
      type: 'image/png',
    });
    const refused = makeClient(settings, () =>
      Promise.resolve(new Response('{}', { status: 401 })),
    );
    await expect(refused.projects()).rejects.toThrow(
      'The token was not accepted; check it in the options',
    );
    const away = makeClient(settings, () => Promise.reject(new Error('down')));
    await expect(away.projects()).rejects.toThrow('Cannot reach https://orqiva.test');
  });

  it('leaves out what was switched off', () => {
    const c: Collected = {
      page: { url: 'https://shop.test/', title: 'Shop' },
      device: {
        userAgent: 'UA',
        platform: 'Linux',
        language: 'en',
        viewport: { width: 1, height: 1 },
        screen: { width: 1, height: 1, pixelRatio: 1 },
        timeZone: 'UTC',
      },
      console: [{ level: 'error', text: 'boom', at: 't' }],
      network: [{ method: 'GET', url: '/x', status: 500, ms: 1, at: 't' }],
      actions: [{ kind: 'click', target: 'button "Pay"', at: 't' }],
    };
    const body = reportBody(
      ' Pay fails ',
      ' twice ',
      c,
      { console: true, network: false, actions: true },
      {
        screenshotFileId: 'f1',
      },
    );
    expect(body).toMatchObject({
      title: 'Pay fails',
      note: 'twice',
      network: [],
      console: [{ text: 'boom' }],
      screenshotFileId: 'f1',
    });
    expect('recordingFileId' in body).toBe(false);
  });
});

describe('the manifests', () => {
  it('gives Chrome a service worker and Firefox a background script and an id', () => {
    const chrome = manifestFor('chrome', '0.1.0');
    const firefox = manifestFor('firefox', '0.1.0');
    expect(chrome['background']).toEqual({ service_worker: 'background.js' });
    expect(firefox['background']).toEqual({ scripts: ['background.js'] });
    expect(firefox['browser_specific_settings']).toEqual({
      gecko: { id: 'capture@orqiva.app', strict_min_version: '128.0' },
    });
    expect(chrome['permissions']).toEqual(['activeTab', 'storage']);
    expect((chrome['content_scripts'] as { world?: string }[])[0]?.world).toBe('MAIN');
  });
});
