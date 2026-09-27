/**
 * KTX2 encoding with the official Basis Universal command-line encoder (Apache-2.0), in its WASI build, run by
 * Node's built-in WASI. The browser-oriented wrappers cap images at ~12 Mpixel; the CLI handles 8k maps.
 * The .wasm is downloaded once (pinned commit) into tools/textures/src/bin/ (git-ignored).
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WASI } from 'node:wasi';

const BASISU_COMMIT = '99f52d63aa6799cbdaecfe977111dc5ec3b31d47';
const BASISU_URL = `https://raw.githubusercontent.com/BinomialLLC/basis_universal/${BASISU_COMMIT}/bin/basisu_st.wasm`;

let module: Promise<WebAssembly.Module> | undefined;

async function basisuModule(cacheDir: string, userAgent: string): Promise<WebAssembly.Module> {
  const file = join(cacheDir, `basisu_st-${BASISU_COMMIT.slice(0, 8)}.wasm`);
  if (!existsSync(file)) {
    console.log(`fetch   ${BASISU_URL}`);
    const res = await fetch(BASISU_URL, { headers: { 'User-Agent': userAgent } });
    if (res.status !== 200) throw new Error(`HTTP ${res.status} for ${BASISU_URL}`);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  return WebAssembly.compile(await readFile(file));
}

/**
 * Encodes a PNG into ETC1S KTX2 (sRGB, full mip chain, rows flipped: compressed textures ignore `flipY`).
 * `workDir` is a scratch directory exposed to the WASI sandbox.
 */
export async function encodeKtx2(
  png: Buffer,
  outFile: string,
  options: {
    workDir: string;
    cacheDir: string;
    userAgent: string;
    /**
     * ETC1S (default): ~1 bit/texel, visible blocks under strong magnification. UASTC LDR 4x4 with RDO and
     * Zstandard: transcoded to BC7/ASTC, near-lossless, ~3× larger; used for close-up levels.
     */
    codec?: 'etc1s' | 'uastc';
  },
): Promise<void> {
  module ??= basisuModule(options.cacheDir, options.userAgent);
  await mkdir(options.workDir, { recursive: true });
  await writeFile(join(options.workDir, 'in.png'), png);
  const wasi = new WASI({
    version: 'preview1',
    args: [
      'basisu',
      '-ktx2',
      ...(options.codec === 'uastc'
        ? ['-uastc', '-quality', '70', '-effort', '3']
        : ['-etc1s', '-quality', '90', '-effort', '3']),
      '-srgb',
      '-mipmap',
      '-y_flip',
      '-output_file',
      '/w/out.ktx2',
      '/w/in.png',
    ],
    preopens: { '/w': options.workDir },
    returnOnExit: true,
  });
  const instance = await WebAssembly.instantiate(await module, wasi.getImportObject() as WebAssembly.Imports);
  const code = wasi.start(instance);
  if (code !== 0) throw new Error(`basisu exited with code ${code}`);
  await rename(join(options.workDir, 'out.ktx2'), outFile);
  await rm(join(options.workDir, 'in.png'));
}
