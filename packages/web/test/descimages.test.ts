// ── [PCODE-320 | S15 | v0.1.0] T32.5b The bug-capture browser extension for Chrome and Firefox ──
//    Why:  only this server's own file images are shown under a description, never an outside address.
import { describe, expect, it } from 'vitest';
import { imagesIn } from '../src/v2/descimages.js';

const id = '79d52062-f4ed-40cf-bf06-025cc476675d';
describe('images in a description', () => {
  it('finds the workspace’s file images and nothing else', () => {
    const md =
      '## Screenshot\n\n![Screenshot](/api/workspaces/' +
      id +
      '/files/' +
      id +
      '/content)\n' +
      '![tracker](https://evil.example/pixel.png) and [a link](/api/workspaces/' +
      id +
      '/files/' +
      id +
      '/content)';
    expect(imagesIn(md)).toEqual([
      { alt: 'Screenshot', src: '/api/workspaces/' + id + '/files/' + id + '/content' },
    ]);
    expect(imagesIn('no images')).toEqual([]);
  });
});
