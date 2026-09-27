import { describe, expect, it } from 'vitest';
import launchSitesJson from '../catalog/launch-sites.json';
import { LaunchSitesSchema } from '../src/data/schemas';

describe('launch sites catalogue', () => {
  const catalog = LaunchSitesSchema.parse(launchSitesJson);

  it('has unique ids and SATCAT codes, each with a source', () => {
    const ids = catalog.sites.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const codes = catalog.sites.flatMap((s) => s.satcatCodes);
    expect(new Set(codes).size).toBe(codes.length);
    for (const s of catalog.sites) expect(s.sources.length, s.id).toBeGreaterThan(0);
  });

  it('includes the major spaceports', () => {
    const ids = new Set(catalog.sites.map((s) => s.id));
    for (const id of ['cape-canaveral', 'kourou', 'baikonur', 'jiuquan', 'sriharikota'])
      expect(ids.has(id), id).toBe(true);
  });
});
