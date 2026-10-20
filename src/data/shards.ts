/**
 * Split copies of the large Earth datasets for the machine interfaces (src/engine): a request about one satellite
 * reads one small shard instead of the whole file, which a Worker's CPU budget cannot afford (CLAUDE.md §8). The
 * pipeline writes them with the dataset; the web app keeps reading the whole file.
 */
export const SHARD_COUNT = 256;

/** Shard of a NORAD catalogue number. */
export const shardOf = (norad: number, count: number): number => norad % count;

/** Path of one shard from the manifest's template (`earth/gp-active/{shard}.json.gz`). */
export const shardPath = (template: string, shard: number | 'index'): string =>
  template.replace('{shard}', String(shard));

/** One line of the name index: "NORAD\tNAME\tCOSPAR". */
export const nameLine = (norad: number, name: string, cospar: string): string =>
  `${norad}\t${name.replace(/[\t\n\r]/g, ' ')}\t${cospar.replace(/[\t\n\r]/g, ' ')}`;
