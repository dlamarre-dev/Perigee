import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildApiDocuments } from '../src/engine/apiDocs';
import { resolve } from '../src/engine/objects';

const SITE = 'https://perigee.info/';
const docs = buildApiDocuments(
  SITE,
  { version: '0.0.0', commit: 'test', date: '2026-10-18' },
  readFileSync('public/llms.txt', 'utf8'),
);
const read = <T>(path: string): T => JSON.parse(docs[path] ?? 'null') as T;

type Obj = {
  id: string;
  kind: string;
  name: { en: string; fr: string };
  view: string;
  embed: string;
  image?: { url: string };
  model3d?: { url: string };
};

describe('machine documents', () => {
  const catalog = read<{ objects: Obj[]; disclaimer: string; count: number }>('api/catalog.json');

  it('lists every catalogue object once, under an id the engine resolves', () => {
    expect(catalog.count).toBe(catalog.objects.length);
    const ids = catalog.objects.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const o of catalog.objects) {
      expect(() => resolve(o.id)).not.toThrow();
      expect(o.name.en && o.name.fr).toBeTruthy();
      expect(o.view.startsWith(SITE)).toBe(true);
      expect(o.embed).toContain('embed=1');
    }
    expect(catalog.disclaimer).toMatch(/Educational/);
  });

  it('links images that exist in public/images', () => {
    const images = read<{ images: { id: string; licence: string; credit: string }[] }>(
      'api/images.json',
    ).images;
    expect(images.length).toBeGreaterThan(50);
    for (const i of images) {
      expect(() => readFileSync(`public/images/${i.id}.webp`)).not.toThrow();
      expect(i.licence).toBeTruthy();
      expect(i.credit).toBeTruthy();
    }
    expect(catalog.objects.some((o) => o.image?.url.endsWith('.webp'))).toBe(true);
  });

  it('links ESA models on SciFleet instead of copying them', () => {
    const linked = catalog.objects.filter((o) => o.model3d);
    expect(linked.map((o) => o.id)).toContain('juice');
    for (const o of linked)
      expect(o.model3d?.url).toMatch(/^https:\/\/scifleet\.esa\.int\/model\/[a-z0-9_]+\/$/);
    expect(docs['llms-full.txt']).toContain('3D model: https://scifleet.esa.int/model/juice/');
  });

  it('documents the interface with the set schema and the model accuracy', () => {
    const doc = read<{
      embed: { methods: { set: { params: { properties: object } } } };
      provenance: { models: object; states: object };
    }>('api/interface.json');
    expect(Object.keys(doc.embed.methods.set.params.properties)).toEqual([
      'view',
      'sel',
      'time',
      'rate',
      'frame',
      'lang',
      'follow',
      'observer',
    ]);
    expect(Object.keys(doc.provenance.models)).toContain('sgp4-gp');
    expect(Object.keys(doc.provenance.states)).toContain('extrapolated');
  });

  it('writes the glossary in both languages and a full text', () => {
    const terms = read<{ terms: { definition: { en: string; fr: string } }[] }>('api/glossary.json').terms;
    expect(terms.every((t) => t.definition.en && t.definition.fr)).toBe(true);
    const full = docs['llms-full.txt'] ?? '';
    expect(full.startsWith('# Perigee')).toBe(true);
    expect(full).toContain('## Missions beyond Earth orbit');
    expect(full).toContain('(id `lro`)');
    expect(full).toContain('## Glossary');
  });
});
