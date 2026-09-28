// deno task deploy runs this before `cf deploy`. It fails the deploy if the project could stop being a
// pure static-assets Worker (the only shape that is free and unlimited) or would hit Free-plan limits.
// Limits: https://developers.cloudflare.com/workers/platform/limits/#static-assets
import { walk } from 'jsr:@std/fs@^1/walk';
import { parse } from 'jsr:@std/jsonc@^1';

const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const config = parse(await Deno.readTextFile('wrangler.jsonc')) as Record<string, unknown>;
const assets = (config.assets ?? {}) as Record<string, unknown>;
const problems: string[] = [];

if ('main' in config) problems.push('"main" is set: a Worker script would run and count against request limits.');
if ('run_worker_first' in assets) problems.push('"assets.run_worker_first" is set: requests would invoke a Worker.');
if ('binding' in assets) problems.push('"assets.binding" only makes sense with a Worker script.');
for (const key of ['durable_objects', 'kv_namespaces', 'r2_buckets', 'd1_databases', 'queues', 'ai', 'containers']) {
  if (key in config) problems.push(`"${key}" is set: bound resources have their own quotas.`);
}

let files = 0;
for await (const entry of walk(String(assets.directory ?? './dist'), { includeDirs: false })) {
  files++;
  const { size } = await Deno.stat(entry.path);
  if (size > MAX_FILE_BYTES) problems.push(`${entry.path} is ${(size / 1048576).toFixed(1)} MiB (limit 25 MiB).`);
}
if (files === 0) problems.push('No built files found. Run `deno task build` first.');
if (files > MAX_FILES) problems.push(`${files} files (limit ${MAX_FILES}).`);

if (problems.length) {
  console.error('Refusing to deploy — this would leave the free, assets-only setup:\n- ' + problems.join('\n- '));
  Deno.exit(1);
}
console.log(`Free-tier check passed: assets only, ${files} files.`);
