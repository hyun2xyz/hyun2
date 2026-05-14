import { cp, mkdir, rm } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await mkdir(new URL('src/', dist), { recursive: true });

await cp(new URL('index.html', root), new URL('index.html', dist));
await cp(new URL('styles.css', root), new URL('styles.css', dist));
await cp(new URL('src/app.js', root), new URL('src/app.js', dist));
await cp(new URL('src/supabase-client.js', root), new URL('src/supabase-client.js', dist));
await cp(new URL('src/supabase-config.js', root), new URL('src/supabase-config.js', dist));
