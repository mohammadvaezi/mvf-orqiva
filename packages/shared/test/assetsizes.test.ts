// ── [PCODE-293 | S15 | v0.1.0] T30.7 Generated asset sizes and a download portal ──
//    Why:  presets give the files each platform asks for, a raster source is never enlarged, icons are
//          fitted whole and social images filled, and export areas count the mockup as the largest scale.
import { describe, expect, it } from 'vitest';
import { areaRenditions, assetBase, drawBox, renditionPlan } from '../src/index.js';

const sizes = (p: { name: string; width: number; height: number }[]) =>
  p.map((x) => x.name + ' ' + String(x.width) + 'x' + String(x.height));

describe('asset sizes', () => {
  it('plans scales from a raster as the largest, and from a vector upward', () => {
    expect(assetBase('Brand Logo (dark).SVG')).toBe('brand-logo-dark');
    expect(
      sizes(renditionPlan('scales', { name: 'Hero.png', width: 900, height: 300, vector: false })),
    ).toEqual(['hero.png 300x100', 'hero@2x.png 600x200', 'hero@3x.png 900x300']);
    expect(
      sizes(
        renditionPlan('scales', { name: 'mark.svg', width: 24, height: 24, vector: true }, 'webp'),
      ),
    ).toEqual(['mark.webp 24x24', 'mark@2x.webp 48x48', 'mark@3x.webp 72x72']);
    // web widths only up to the source
    expect(
      sizes(
        renditionPlan('web', { name: 'p.jpg', width: 1100, height: 550, vector: false }, 'jpeg'),
      ),
    ).toEqual(['p-320w.jpg 320x160', 'p-640w.jpg 640x320', 'p-1024w.jpg 1024x512']);
  });

  it('plans icons, favicons and social images in fixed sizes', () => {
    const ios = renditionPlan('ios-icon', { name: 'a', width: 1024, height: 1024, vector: false });
    expect(ios).toHaveLength(13);
    expect(ios[0]).toMatchObject({
      name: 'ios/AppIcon-1024.png',
      width: 1024,
      fit: 'contain',
      format: 'png',
    });
    expect(
      renditionPlan('android-icon', { name: 'a', width: 512, height: 512, vector: false }).map(
        (x) => x.name,
      ),
    ).toContain('android/mipmap-xxhdpi/ic_launcher.png');
    expect(
      renditionPlan('favicon', { name: 'a', width: 64, height: 64, vector: false }, 'jpeg').every(
        (x) => x.format === 'png',
      ),
    ).toBe(true);
    expect(
      sizes(renditionPlan('social', { name: 'Launch', width: 2000, height: 2000, vector: false })),
    ).toEqual(['launch-og.png 1200x630', 'launch-square.png 1080x1080']);
  });

  it('fits whole, fills or scales', () => {
    expect(drawBox(200, 100, 50, 50, 'contain')).toEqual({
      sx: 0,
      sy: 0,
      sw: 200,
      sh: 100,
      dx: 0,
      dy: 12.5,
      dw: 50,
      dh: 25,
    });
    expect(drawBox(200, 100, 50, 50, 'cover')).toEqual({
      sx: 50,
      sy: 0,
      sw: 100,
      sh: 100,
      dx: 0,
      dy: 0,
      dw: 50,
      dh: 50,
    });
    expect(drawBox(200, 100, 20, 10, 'scale')).toMatchObject({ sw: 200, dw: 20 });
  });

  it('sizes export areas with the mockup as the largest scale, no SVG from pixels', () => {
    expect(
      sizes(areaRenditions('Hero art', { w: 600, h: 300 }, [2, 1], ['png', 'svg', 'jpg'])),
    ).toEqual([
      'hero-art.png 300x150',
      'hero-art@2x.png 600x300',
      'hero-art.jpg 300x150',
      'hero-art@2x.jpg 600x300',
    ]);
  });
});
