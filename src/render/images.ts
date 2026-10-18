import imagesJson from '../../catalog/images.json';
import { ImagesCatalogSchema, type ImageEntry } from '../data/schemas';
import { assetUrl } from './assetUrl';

const catalog = ImagesCatalogSchema.parse(imagesJson);
const byTarget = new Map<string, ImageEntry>(catalog.images.map((i) => [i.target, i]));

/** Panel image of a target without a 3D model: `mission:<id>`, `site:<id>`, `launch:<id>` or `norad:<n>`. */
export function imageFor(target: string): ImageEntry | undefined {
  return byTarget.get(target);
}

/** `{ image }` for a detail panel when the target has one (spread into DetailContent, like `withModel`). */
export function withImage(target: string): { image?: ImageEntry } {
  const image = byTarget.get(target);
  return image ? { image } : {};
}

/** URL of the resized WebP (tools/images): the panel size, or the enlarged view's. */
export function imageUrl(baseUrl: string, entry: ImageEntry, large = false): string {
  return assetUrl(baseUrl, `images/${entry.id}${large ? '-large' : ''}.webp`);
}

export { LICENCES } from '../data/licences';
