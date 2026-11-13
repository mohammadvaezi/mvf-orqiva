// ── [PCODE-320 | S15 | v0.1.0] T32.5b The bug-capture browser extension for Chrome and Firefox ──
//    Why:  a captured bug carries its screenshot as a Markdown image in the description, which the task
//          page shows as text; the images of the workspace's own files are shown under it, each opening
//          full size. Images from elsewhere are not loaded.
import type { ReactNode } from 'react';

/** The description's images that are files of this server ("![alt](/api/workspaces/…/files/…/content)"). */
export function imagesIn(md: string): { alt: string; src: string }[] {
  const out: { alt: string; src: string }[] = [];
  for (const m of md.matchAll(
    /!\[([^\]]*)\]\((\/api\/workspaces\/[0-9a-f-]{36}\/files\/[0-9a-f-]{36}\/content)\)/g,
  ))
    out.push({ alt: m[1] || 'Image', src: m[2] ?? '' });
  return out;
}

export function DescriptionImages(props: { text: string }): ReactNode {
  const images = imagesIn(props.text);
  if (!images.length) return null;
  return (
    <div className="v2-desc-images" aria-label="Images in the description">
      {images.map((im, i) => (
        <a key={i} href={im.src} target="_blank" rel="noopener">
          <img src={im.src} alt={im.alt} loading="lazy" />
        </a>
      ))}
    </div>
  );
}
