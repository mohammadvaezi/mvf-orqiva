// ── [PCODE-291 | S15 | v0.1.0] T30.5 Live component preview with the project's tokens and themes ──
//    Why:  the preview frame asks the server for the component in the chosen theme.
import { describe, expect, it } from 'vitest';
import { previewUrl } from '../src/v2/kitpreview.js';

describe('the preview address', () => {
  it('names the component and the theme', () => {
    expect(previewUrl('w', 'c', 'high contrast')).toBe(
      '/api/workspaces/w/components/c/preview?theme=high%20contrast',
    );
  });
});
