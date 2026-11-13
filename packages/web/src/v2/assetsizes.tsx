// ── [PCODE-440 | S15 | v0.1.0] T37 Consistency: errors and loading are announced everywhere ──
// ── [PCODE-293 | S15 | v0.1.0] T30.7 Generated asset sizes and a download portal ──
//    Why:  an asset's sizes are drawn here, in the browser that reads every image format, from a preset
//          (scales, app icons, favicons, social images), uploaded and kept with the asset; the server checks
//          each against its header. Export areas of a mockup become assets the same way. The client portal
//          shows the shared assets with their sizes and a ZIP of all.
import {
  RENDITION_FORMATS,
  RENDITION_MIME,
  RENDITION_PRESETS,
  areaRenditions,
  drawBox,
  renditionPlan,
  type RenditionFormat,
  type RenditionPlan,
  type RenditionPreset,
} from '@orqiva/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../core/api.js';
import { PIcon } from '../preview/picons.js';
import { Button, Card, Chip } from '../preview/ui.js';
import { sizeText, uploadFile } from './files.js';

export interface Rendition {
  id: string;
  name: string;
  preset: string;
  format: string;
  width: number;
  height: number;
  sizeBytes: number;
  url: string;
}

/** An image element of a URL, loaded. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      reject(new Error('The image could not be read'));
    };
    img.src = url;
  });
}

/** Draws one planned size from a source (or a part of it) and gives the file. */
export async function drawRendition(
  img: CanvasImageSource,
  src: { x: number; y: number; w: number; h: number },
  plan: RenditionPlan,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('This browser cannot draw images');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  // JPEG has no transparency: a white ground instead of black
  if (plan.format === 'jpeg') {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, plan.width, plan.height);
  }
  const b = drawBox(src.w, src.h, plan.width, plan.height, plan.fit);
  g.drawImage(img, src.x + b.sx, src.y + b.sy, b.sw, b.sh, b.dx, b.dy, b.dw, b.dh);
  const blob = await new Promise<Blob | null>((r) => {
    canvas.toBlob(r, RENDITION_MIME[plan.format], 0.9);
  });
  if (!blob || blob.type !== RENDITION_MIME[plan.format])
    throw new Error('This browser cannot write ' + plan.format.toUpperCase());
  return blob;
}

/** Draws, uploads and keeps the planned sizes of an asset; gives what failed, if anything. */
export async function makeRenditions(p: {
  workspaceId: string;
  projectId: string;
  assetId: string;
  img: CanvasImageSource;
  src: { x: number; y: number; w: number; h: number };
  plans: RenditionPlan[];
  preset: string;
  onProgress?: (done: number) => void;
}): Promise<string | null> {
  let done = 0;
  for (const plan of p.plans) {
    let blob: Blob;
    try {
      blob = await drawRendition(p.img, p.src, plan);
    } catch (e) {
      return e instanceof Error ? e.message : 'Drawing failed';
    }
    const file = new File([blob], plan.name.replace(/\//g, '-'), { type: blob.type });
    const up = await uploadFile(p.workspaceId, p.projectId, file);
    if (!up.ok) return up.error.message;
    const r = await api(
      'POST',
      '/api/workspaces/' + p.workspaceId + '/assets/' + p.assetId + '/renditions',
      {
        fileId: up.data.id,
        name: plan.name,
        preset: p.preset,
        width: plan.width,
        height: plan.height,
      },
    );
    if (!r.ok) return plan.name + ': ' + r.error.message;
    done += 1;
    p.onProgress?.(done);
  }
  return null;
}

/** The sizes of one asset: generate from a preset, download each or all, share with the client. */
export function AssetSizes(props: {
  workspaceId: string;
  projectId: string;
  asset: {
    id: string;
    name: string;
    mime: string;
    url: string;
    expired: boolean;
    clientVisible?: boolean;
  };
  canEdit: boolean;
  onChanged: () => void;
}): ReactNode {
  const A = '/api/workspaces/' + props.workspaceId + '/assets/' + props.asset.id;
  const [list, setList] = useState<Rendition[] | null>(null);
  const [preset, setPreset] = useState<RenditionPreset>('scales');
  const [format, setFormat] = useState<RenditionFormat>('png');
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [busy, setBusy] = useState<string>('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const r = await api<Rendition[]>('GET', A + '/renditions');
    if (r.ok) setList(r.data);
  }, [A]);
  useEffect(() => {
    void load();
  }, [load]);
  const vector = props.asset.mime.includes('svg');
  const image = props.asset.mime.startsWith('image/');
  useEffect(() => {
    if (!image) return;
    void loadImage(props.asset.url).then(
      (img) => {
        // an SVG without its own size counts as 512 px wide, square
        setNatural({ w: img.naturalWidth || 512, h: img.naturalHeight || img.naturalWidth || 512 });
      },
      () => {
        setNatural(null);
      },
    );
  }, [image, props.asset.url]);
  const plans = natural
    ? renditionPlan(
        preset,
        { name: props.asset.name, width: natural.w, height: natural.h, vector },
        format,
      )
    : [];
  const generate = async (): Promise<void> => {
    if (!natural) return;
    setError('');
    setBusy('0 of ' + String(plans.length));
    try {
      const img = await loadImage(props.asset.url);
      const failed = await makeRenditions({
        workspaceId: props.workspaceId,
        projectId: props.projectId,
        assetId: props.asset.id,
        img,
        src: { x: 0, y: 0, w: natural.w, h: natural.h },
        plans,
        preset,
        onProgress: (n) => {
          setBusy(String(n) + ' of ' + String(plans.length));
        },
      });
      if (failed) setError(failed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The sizes could not be made');
    }
    setBusy('');
    await load();
    props.onChanged();
  };
  const share = async (): Promise<void> => {
    const r = await api('PUT', A + '/client', { shared: !props.asset.clientVisible });
    setError(r.ok ? '' : r.error.message);
    props.onChanged();
  };
  return (
    <div className="v2-asset-sizes">
      <div className="v2-inline">
        <a className="pv-btn pv-btn--ghost pv-btn--sm" href={A + '/zip'} download>
          ZIP with all sizes
        </a>
        {props.canEdit ? (
          <Button
            size="sm"
            kind="ghost"
            icon="clients"
            disabled={props.asset.expired && !props.asset.clientVisible}
            onClick={() => void share()}
          >
            {props.asset.clientVisible
              ? 'In the client portal · stop'
              : 'Offer in the client portal'}
          </Button>
        ) : null}
      </div>
      {props.canEdit && image ? (
        <div className="v2-inline v2-mt">
          <select
            className="pv-select"
            aria-label="Sizes to make"
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value as RenditionPreset);
            }}
          >
            {RENDITION_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            className="pv-select"
            aria-label="Format"
            value={format}
            onChange={(e) => {
              setFormat(e.target.value as RenditionFormat);
            }}
          >
            {RENDITION_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f.toUpperCase()}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            kind="primary"
            disabled={!plans.length || Boolean(busy)}
            onClick={() => void generate()}
          >
            {busy
              ? 'Making ' + busy + '…'
              : 'Make ' + String(plans.length) + ' file' + (plans.length === 1 ? '' : 's')}
          </Button>
        </div>
      ) : null}
      {props.canEdit && image && natural && !plans.length ? (
        <p className="pv-small pv-muted">
          The source is {natural.w} × {natural.h} px: too small for these sizes, and a picture is
          never enlarged.
        </p>
      ) : null}
      {error ? (
        <p className="v2-error pv-small" role="alert">
          {error}
        </p>
      ) : null}
      {list?.length ? (
        <ul className="pv-rows pv-rows--tight v2-mt">
          {list.map((r) => (
            <li key={r.id} className="pv-row pv-row--static">
              <span className="pv-row-main">
                <a
                  className="pv-row-title v2-mono"
                  href={r.url}
                  download={r.name.replace(/\//g, '-')}
                >
                  {r.name}
                </a>
                <span className="pv-row-sub">
                  {r.width} × {r.height} px · {r.format.toUpperCase()} · {sizeText(r.sizeBytes)}
                </span>
              </span>
              {props.canEdit ? (
                <button
                  type="button"
                  className="pv-link-btn pv-small"
                  onClick={() =>
                    void api(
                      'DELETE',
                      '/api/workspaces/' + props.workspaceId + '/asset-renditions/' + r.id,
                    ).then(async () => {
                      await load();
                      props.onChanged();
                    })
                  }
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : list ? (
        <p className="pv-small pv-muted v2-mt">No sizes made yet.</p>
      ) : null}
    </div>
  );
}

/** Turns the export areas of a handoff into assets with their sizes, cut from the mockup image. */
export async function assetsFromAreas(p: {
  workspaceId: string;
  projectId: string;
  imageUrl: string;
  mockupTitle: string;
  version: number;
  areas: {
    name: string;
    x: number;
    y: number;
    w: number;
    h: number;
    formats: string[];
    scales: number[];
  }[];
  onProgress?: (text: string) => void;
}): Promise<{ made: number; skipped: number; error: string | null }> {
  const img = await loadImage(p.imageUrl);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  // an area that already has an asset of its name is skipped: running it again adds nothing twice
  const have = await api<{ name: string }[]>(
    'GET',
    '/api/workspaces/' + p.workspaceId + '/projects/' + p.projectId + '/assets',
  );
  const taken = new Set(have.ok ? have.data.map((x) => x.name) : []);
  let made = 0;
  let skipped = 0;
  for (const a of p.areas) {
    if (taken.has(a.name)) {
      skipped += 1;
      continue;
    }
    const src = {
      x: Math.round(a.x * W),
      y: Math.round(a.y * H),
      w: Math.round(a.w * W),
      h: Math.round(a.h * H),
    };
    if (src.w < 1 || src.h < 1) continue;
    p.onProgress?.(a.name);
    // the cut at the image's own size is the asset; its scales are its sizes
    const cut = await drawRendition(img, src, {
      name: a.name + '.png',
      width: src.w,
      height: src.h,
      format: 'png',
      fit: 'scale',
    });
    const up = await uploadFile(
      p.workspaceId,
      p.projectId,
      new File([cut], a.name + '.png', { type: 'image/png' }),
    );
    if (!up.ok) return { made, skipped, error: up.error.message };
    const asset = await api<{ id: string }>(
      'POST',
      '/api/workspaces/' + p.workspaceId + '/projects/' + p.projectId + '/assets',
      {
        fileId: up.data.id,
        name: a.name,
        kind: 'image',
        licence: 'Own work',
        rights: 'Cut from the mockup ' + p.mockupTitle + ', version ' + String(p.version),
      },
    );
    if (!asset.ok) return { made, skipped, error: asset.error.message };
    const failed = await makeRenditions({
      workspaceId: p.workspaceId,
      projectId: p.projectId,
      assetId: asset.data.id,
      img,
      src,
      plans: areaRenditions(a.name, src, a.scales, a.formats),
      preset: 'handoff',
    });
    if (failed) return { made, skipped, error: failed };
    made += 1;
  }
  return { made, skipped, error: null };
}

// ── the client portal ──
interface PortalAsset {
  id: string;
  name: string;
  kind: string;
  licence: string;
  rights: string;
  expiresOn: string | null;
  mime: string;
  sizeBytes: number;
  url: string;
  zipUrl: string;
  sizes: Rendition[];
}

export function PortalAssets(props: { base: string; qs: string; clientName: string }): ReactNode {
  const [data, setData] = useState<{ zipUrl: string; assets: PortalAsset[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<{ zipUrl: string; assets: PortalAsset[] }>(
      'GET',
      props.base + '/portal/assets' + props.qs,
    ).then((r) => {
      if (r.ok) setData(r.data);
      else setError(r.error.message);
    });
  }, [props.base, props.qs]);
  if (error)
    return (
      <Card>
        <div className="pv-empty">
          <PIcon name="lock" size={28} />
          <strong>{error}</strong>
          <span>Ask your team if you need it here.</span>
        </div>
      </Card>
    );
  if (!data) return null;
  if (!data.assets.length)
    return (
      <Card>
        <div className="pv-empty">
          <PIcon name="uikit" size={28} />
          <strong>No assets to download yet.</strong>
          <span>Logos, icons and images your team offers show here, in every size you need.</span>
        </div>
      </Card>
    );
  return (
    <div className="pv-stack">
      <div className="v2-inline">
        <a className="pv-btn pv-btn--primary pv-btn--sm" href={data.zipUrl} download>
          Download all as ZIP
        </a>
        <span className="pv-small pv-muted">
          Each asset comes with its licence and where it may be used.
        </span>
      </div>
      <div className="v2-assets">
        {data.assets.map((a) => (
          <Card key={a.id}>
            <div className="v2-asset">
              {a.mime.startsWith('image/') && !a.mime.includes('svg') ? (
                <img src={a.url} alt={a.name} className="v2-asset-img" />
              ) : (
                <PIcon name="uikit" size={28} />
              )}
              <strong>{a.name}</strong>
              <span className="v2-inline">
                <Chip>{a.kind}</Chip>
                {a.expiresOn ? <Chip>until {a.expiresOn}</Chip> : null}
              </span>
              <span className="pv-small pv-muted">
                {a.licence || 'no licence noted'}
                {a.rights ? ' · ' + a.rights : ''}
              </span>
              <span className="v2-inline">
                <a className="pv-link pv-small" href={a.url} download>
                  Original · {sizeText(a.sizeBytes)}
                </a>
                <a className="pv-link pv-small" href={a.zipUrl} download>
                  ZIP{a.sizes.length ? ' with ' + String(a.sizes.length) + ' sizes' : ''}
                </a>
              </span>
              {a.sizes.length ? (
                <details className="pv-small">
                  <summary>{a.sizes.length} sizes</summary>
                  <ul className="v2-handoff-list v2-mt">
                    {a.sizes.map((r) => (
                      <li key={r.id}>
                        <a className="pv-link v2-mono" href={r.url} download>
                          {r.name}
                        </a>{' '}
                        <span className="pv-muted">
                          {r.width} × {r.height}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
      <p className="pv-small pv-muted">Shared with {props.clientName} by your team.</p>
    </div>
  );
}
