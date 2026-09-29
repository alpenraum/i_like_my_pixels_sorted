// deno task build  → type-checked, minified static site in dist/
// deno task dev    → rebuilds on change, serves public/ + dist/ on http://localhost:8000
import { copy } from '@std/fs';
import { serveDir } from '@std/http/file-server';
import { join } from '@std/path';

const dev = Deno.args.includes('--dev');
const port = Number(Deno.env.get('PORT') ?? 8000);

const bundles = [
  { entry: 'src/main.tsx', out: 'dist/app.js' },
  { entry: 'src/codec-worker.ts', out: 'dist/codec-worker.js' },
  { entry: 'src/sw.ts', out: 'dist/sw.js' },
];

await Deno.remove('dist', { recursive: true }).catch(() => {});

const flags = dev ? ['--sourcemap=linked', '--watch'] : ['--minify'];
const children = bundles.map(({ entry, out }) =>
  new Deno.Command(Deno.execPath(), {
    args: ['bundle', '--platform=browser', ...flags, '-o', out, entry],
  }).spawn()
);

if (dev) {
  await vendorLibRaw();
  Deno.serve({ port, hostname: '127.0.0.1' }, async (req) => {
    // public/ first: a `deno task build` run alongside dev leaves stale copies of it in dist/.
    const file = await serveDir(req, { fsRoot: 'public', quiet: true });
    const res = file.status === 404 ? await serveDir(req, { fsRoot: 'dist', quiet: true }) : file;
    res.headers.set('cache-control', 'no-cache');
    return res;
  });
} else {
  const results = await Promise.all(children.map((c) => c.status));
  if (results.some((r) => !r.success)) Deno.exit(1);
  await copy('public', 'dist', { overwrite: true });
  await vendorLibRaw();
  console.log('Built dist/');
}

// libraw-wasm fetches its worker and .wasm relative to its own URL, so it ships as files, not bundled.
async function vendorLibRaw() {
  const lock = JSON.parse(await Deno.readTextFile('deno.lock'));
  const version = Object.keys(lock.npm ?? {}).find((k) => k.startsWith('libraw-wasm@'))?.split('@')[1];
  if (!version) throw new Error('libraw-wasm missing from deno.lock; run `deno install`.');
  const info = await new Deno.Command(Deno.execPath(), { args: ['info', '--json'] }).output();
  const { npmCache } = JSON.parse(new TextDecoder().decode(info.stdout));
  const pkg = join(npmCache, 'registry.npmjs.org', 'libraw-wasm', version, 'dist');
  await Deno.mkdir('dist/vendor/libraw', { recursive: true });
  for (const file of ['index.js', 'worker.js', 'libraw.js', 'libraw.wasm']) {
    await Deno.copyFile(join(pkg, file), join('dist/vendor/libraw', file));
  }
}
