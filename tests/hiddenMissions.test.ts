import { describe, expect, it } from 'vitest';
import missionsJson from '../catalog/missions.json';
import { parseHiddenMissions, writeHiddenMissions } from '../src/app/hiddenMissions';
import { MissionsCatalogSchema } from '../src/data/schemas';

const solar = MissionsCatalogSchema.parse(missionsJson).missions.filter((m) => m.centralBody === 'sun');
const roundTrip = (hidden: ReadonlySet<string>): string => {
  const p = new URLSearchParams();
  writeHiddenMissions(p, hidden, solar);
  return p.toString();
};

describe('hidden missions in the URL', () => {
  it('hides inactive spacecraft by default and keeps the URL empty for that default', () => {
    const hidden = parseHiddenMissions(new URLSearchParams(), solar);
    expect(hidden.has('pioneer-10')).toBe(true);
    expect(hidden.has('gaia')).toBe(true);
    expect(hidden.has('voyager-1')).toBe(false);
    expect(hidden.has('ceres')).toBe(false);
    expect(roundTrip(hidden)).toBe('');
  });

  it('writes only the departures: hidden active ones and shown inactive ones', () => {
    const hidden = parseHiddenMissions(new URLSearchParams('hide=voyager-1&show=pioneer-10,gaia'), solar);
    expect(hidden.has('voyager-1')).toBe(true);
    expect(hidden.has('pioneer-10')).toBe(false);
    expect(hidden.has('gaia')).toBe(false);
    expect(hidden.has('kepler')).toBe(true);
    expect(roundTrip(hidden)).toBe('hide=voyager-1&show=gaia%2Cpioneer-10');
  });
});
