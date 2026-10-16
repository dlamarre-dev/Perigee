import imagesJson from '../../catalog/images.json';
import { ImagesCatalogSchema, type ImageEntry, type ImageLicence } from '../data/schemas';
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

/** Short licence name and its deed (the attribution links to it). */
export const LICENCES: Readonly<Record<ImageLicence, { readonly name: string; readonly url?: string }>> = {
  'public-domain': { name: 'public domain' },
  cc0: { name: 'CC0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  'cc-by-2.0': { name: 'CC BY 2.0', url: 'https://creativecommons.org/licenses/by/2.0/' },
  'cc-by-3.0': { name: 'CC BY 3.0', url: 'https://creativecommons.org/licenses/by/3.0/' },
  'cc-by-3.0-de': { name: 'CC BY 3.0 DE', url: 'https://creativecommons.org/licenses/by/3.0/de/' },
  'cc-by-4.0': { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
  'cc-by-sa-3.0': { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/' },
  'cc-by-sa-3.0-igo': {
    name: 'CC BY-SA 3.0 IGO',
    url: 'https://creativecommons.org/licenses/by-sa/3.0/igo/',
  },
  'cc-by-sa-4.0': { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  'godl-india': { name: 'GODL-India', url: 'https://www.data.gov.in/Godl' },
  'kogl-1': { name: 'KOGL Type 1', url: 'https://www.kogl.or.kr/info/licenseType1.do' },
};
