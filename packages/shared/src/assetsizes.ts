// ── [PCODE-293 | S15 | v0.1.0] T30.7 Generated asset sizes and a download portal ──
//    Why:  one source image becomes the files a platform asks for: scales for the web and apps, the app
//          icons of iOS and Android, favicons, social images. The plan says which files, at which size,
//          and how the source is fitted into each; the browser draws them and the server keeps them.

export const RENDITION_FORMATS = ['png', 'webp', 'jpeg'] as const;
export type RenditionFormat = (typeof RENDITION_FORMATS)[number];
export const RENDITION_MIME: Record<RenditionFormat, string> = {
  png: 'image/png',
  webp: 'image/webp',
  jpeg: 'image/jpeg',
};

/** contain: the whole source, centred, the rest left clear; cover: the box filled, the overflow cut. */
export type Fit = 'contain' | 'cover' | 'scale';

export interface RenditionPlan {
  /** the file name, folders allowed (mipmap-xxhdpi/ic_launcher.png) */
  name: string;
  width: number;
  height: number;
  format: RenditionFormat;
  fit: Fit;
}

export const RENDITION_PRESETS = [
  { key: 'scales', label: 'Scales 1x, 2x, 3x' },
  { key: 'web', label: 'Web widths 320 to 1600' },
  { key: 'ios-icon', label: 'iOS app icon' },
  { key: 'android-icon', label: 'Android app icon' },
  { key: 'favicon', label: 'Favicons' },
  { key: 'social', label: 'Social images' },
] as const;
export type RenditionPreset = (typeof RENDITION_PRESETS)[number]['key'];

const IOS_ICON = [1024, 180, 167, 152, 120, 87, 80, 76, 60, 58, 40, 29, 20];
const ANDROID_ICON: [string, number][] = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
];

const ext = (f: RenditionFormat): string => (f === 'jpeg' ? 'jpg' : f);

/** A file-safe base name of an asset: "Brand Logo.svg" → brand-logo. */
export function assetBase(name: string): string {
  return (
    name
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'asset'
  );
}

/** The files a preset makes of a source of this size. A raster source counts as the largest scale and
 *  is never enlarged; a vector source (SVG) is its 1x and draws sharp at any size. */
export function renditionPlan(
  preset: RenditionPreset,
  src: { name: string; width: number; height: number; vector: boolean },
  format: RenditionFormat = 'png',
): RenditionPlan[] {
  const base = assetBase(src.name);
  const w = Math.max(1, src.width);
  const h = Math.max(1, src.height);
  const out: RenditionPlan[] = [];
  const add = (name: string, width: number, height: number, fit: Fit, f = format): void => {
    if (!src.vector && (width > w || height > h) && fit === 'scale') return;
    out.push({ name, width: Math.round(width), height: Math.round(height), format: f, fit });
  };
  switch (preset) {
    case 'scales':
      for (const s of [1, 2, 3]) {
        const k = src.vector ? s : s / 3;
        add(
          base + (s === 1 ? '' : '@' + String(s) + 'x') + '.' + ext(format),
          w * k,
          h * k,
          'scale',
        );
      }
      break;
    case 'web':
      for (const width of [320, 640, 1024, 1600])
        if (src.vector || width <= w)
          add(base + '-' + String(width) + 'w.' + ext(format), width, (h * width) / w, 'scale');
      break;
    case 'ios-icon':
      // the App Store wants PNG without transparency at 1024; the others follow it
      for (const n of IOS_ICON) add('ios/AppIcon-' + String(n) + '.png', n, n, 'contain', 'png');
      break;
    case 'android-icon':
      for (const [d, n] of ANDROID_ICON)
        add('android/mipmap-' + d + '/ic_launcher.png', n, n, 'contain', 'png');
      add('android/playstore-icon.png', 512, 512, 'contain', 'png');
      break;
    case 'favicon':
      for (const n of [16, 32, 48]) add('favicon-' + String(n) + '.png', n, n, 'contain', 'png');
      add('apple-touch-icon.png', 180, 180, 'contain', 'png');
      for (const n of [192, 512]) add('icon-' + String(n) + '.png', n, n, 'contain', 'png');
      break;
    case 'social':
      add(base + '-og.' + ext(format), 1200, 630, 'cover');
      add(base + '-square.' + ext(format), 1080, 1080, 'cover');
      break;
  }
  return out;
}

/** Where the source goes on the target: the part of the source (s*) drawn into the box (d*). */
export function drawBox(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  fit: Fit,
): {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
} {
  if (fit === 'scale')
    return { sx: 0, sy: 0, sw: srcW, sh: srcH, dx: 0, dy: 0, dw: dstW, dh: dstH };
  if (fit === 'contain') {
    const k = Math.min(dstW / srcW, dstH / srcH);
    const dw = srcW * k;
    const dh = srcH * k;
    return { sx: 0, sy: 0, sw: srcW, sh: srcH, dx: (dstW - dw) / 2, dy: (dstH - dh) / 2, dw, dh };
  }
  const k = Math.max(dstW / srcW, dstH / srcH);
  const sw = dstW / k;
  const sh = dstH / k;
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh, dx: 0, dy: 0, dw: dstW, dh: dstH };
}

/** The sizes of a handoff export area: the mockup image is the largest scale, smaller scales shrink. */
export function areaRenditions(
  name: string,
  area: { w: number; h: number },
  scales: readonly number[],
  formats: readonly string[],
): RenditionPlan[] {
  const top = Math.max(...scales, 1);
  const base = assetBase(name);
  const out: RenditionPlan[] = [];
  for (const f of formats) {
    if (f === 'svg') continue; // a vector needs its source file, not a cut from an image
    const format: RenditionFormat = f === 'jpg' ? 'jpeg' : (f as RenditionFormat);
    for (const s of [...scales].sort((p, q) => p - q))
      out.push({
        name: base + (s === 1 ? '' : '@' + String(s) + 'x') + '.' + ext(format),
        width: Math.max(1, Math.round((area.w * s) / top)),
        height: Math.max(1, Math.round((area.h * s) / top)),
        format,
        fit: 'scale',
      });
  }
  return out;
}
