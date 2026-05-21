// Twitter card reuses the Open Graph image — same brand, same dimensions.
// Next 16 cannot infer the `runtime` export from re-exports, so it must be
// declared inline. `default`, `alt`, `contentType`, and `size` re-export
// cleanly.
export const runtime = 'nodejs';
export { default, alt, contentType, size } from './opengraph-image';
