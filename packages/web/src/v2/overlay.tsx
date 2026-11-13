// ── [PCODE-294 | S15 | v0.1.0] T30.8a Overlay compare of mockup versions, client pins in the portal ──
//    Why:  side by side hides small changes; on top of each other they show: an overlay with an opacity
//          slider, a swipe that uncovers one version over the other, and a difference where only what
//          changed lights up. Both images share the first one's size, as versions of one screen do.
import { useEffect, useState, type ReactNode } from 'react';

export type CompareMode = 'side' | 'overlay' | 'swipe' | 'difference';
export const COMPARE_MODES: { key: CompareMode; label: string }[] = [
  { key: 'side', label: 'Side by side' },
  { key: 'overlay', label: 'Overlay' },
  { key: 'swipe', label: 'Swipe' },
  { key: 'difference', label: 'Difference' },
];

/** The slider's meaning per mode: how much of the top image shows. */
export function sliderLabel(mode: CompareMode, value: number): string {
  if (mode === 'overlay') return String(value) + ' % of the newer one';
  if (mode === 'swipe') return 'Newer one on the left ' + String(value) + ' %';
  return '';
}

export function CompareImages(props: {
  mode: Exclude<CompareMode, 'side'>;
  /** below */
  base: { url: string; label: string };
  /** on top */
  top: { url: string; label: string };
}): ReactNode {
  const [size, setSize] = useState({ w: 1600, h: 1000 });
  const [value, setValue] = useState(50);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight)
        setSize({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = props.base.url;
  }, [props.base.url]);
  const { w, h } = size;
  const cut = (w * value) / 100;
  const clipId = 'v2-swipe-' + props.top.url.replace(/[^a-z0-9]/gi, '').slice(-16);
  return (
    <figure className="v2-pinned">
      <svg
        viewBox={'0 0 ' + String(w) + ' ' + String(h)}
        className="v2-pinned-svg v2-compare-svg"
        role="img"
        aria-label={props.top.label + ' compared with ' + props.base.label + ', ' + props.mode}
      >
        {props.mode === 'swipe' ? (
          <defs>
            <clipPath id={clipId}>
              <rect x="0" y="0" width={cut} height={h} />
            </clipPath>
          </defs>
        ) : null}
        <image href={props.base.url} x="0" y="0" width={w} height={h} />
        {props.mode === 'overlay' ? (
          <image href={props.top.url} x="0" y="0" width={w} height={h} opacity={value / 100} />
        ) : props.mode === 'swipe' ? (
          <>
            <image
              href={props.top.url}
              x="0"
              y="0"
              width={w}
              height={h}
              clipPath={'url(#' + clipId + ')'}
            />
            <line
              className="v2-swipe-line"
              x1={cut}
              y1="0"
              x2={cut}
              y2={h}
              strokeWidth={Math.max(2, w / 500)}
            />
          </>
        ) : (
          <image className="v2-blend-diff" href={props.top.url} x="0" y="0" width={w} height={h} />
        )}
      </svg>
      <figcaption className="pv-small pv-muted v2-inline">
        {props.mode === 'difference' ? (
          <span>
            {props.top.label} against {props.base.label}: black is the same, light is what changed.
          </span>
        ) : (
          <>
            <span>{props.base.label}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={value}
              aria-label={sliderLabel(props.mode, value)}
              className="v2-grow"
              onChange={(e) => {
                setValue(Number(e.target.value));
              }}
            />
            <span>{props.top.label}</span>
          </>
        )}
      </figcaption>
    </figure>
  );
}
