// Writes the README's Shields.io endpoint badges (https://shields.io/badges/endpoint-badge) into the Pages artifact,
// after the deploy workflow has copied the published data: data freshness, satellites tracked, missions tracked.
// Runs at every deployment, which follows every data update. Usage: npx tsx tools/badges/write-badges.ts dist
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ManifestSchema, MissionsCatalogSchema } from '../../src/data/schemas';

interface Badge {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
}

const dist = process.argv[2] ?? 'dist';
const manifest = ManifestSchema.parse(JSON.parse(await readFile(join(dist, 'data/manifest.json'), 'utf8')));
const catalog = MissionsCatalogSchema.parse(JSON.parse(await readFile('catalog/missions.json', 'utf8')));

const generated = new Date(manifest.generatedAt);
const satellites = manifest.datasets['earth.gp']?.count;
// Spacecraft beyond Earth orbit the app follows now: active or cruising (not planned, ended or natural bodies).
const missions = catalog.missions.filter(
  (m) => m.objectType === 'spacecraft' && (m.status === 'active' || m.status === 'cruise'),
).length;

const badges: Record<string, Badge> = {
  'data.json': {
    schemaVersion: 1,
    label: 'data updated',
    message: `${generated.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    color: 'brightgreen',
  },
  'missions.json': {
    schemaVersion: 1,
    label: 'space missions tracked',
    message: String(missions),
    color: 'blue',
  },
};
if (satellites !== undefined) {
  badges['satellites.json'] = {
    schemaVersion: 1,
    label: 'satellites tracked',
    message: satellites.toLocaleString('en-US'),
    color: 'blue',
  };
}

await mkdir(join(dist, 'badges'), { recursive: true });
for (const [file, badge] of Object.entries(badges)) {
  await writeFile(join(dist, 'badges', file), JSON.stringify(badge) + '\n');
}
console.log(`Badges: ${Object.keys(badges).join(', ')}`);
