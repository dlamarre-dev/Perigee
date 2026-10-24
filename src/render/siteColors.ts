import type { LandingSite } from '../data/schemas';

/** Marker colour of a landing or impact site by type (Moon, Mars and solar views). */
export const SITE_COLORS: Readonly<Record<LandingSite['type'], string>> = {
  crewed: '#ffd54f',
  soft: '#aed581',
  'rover-last-known': '#4fc3f7',
  hard: '#ff8a65',
  impact: '#b0bec5',
};
