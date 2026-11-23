import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const publicFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? publicFiles(join(dir, e.name)) : [join(dir, e.name)],
  );

/** Writes sw.js into the build with the list of files to precache, so the app works offline. */
function serviceWorker(): Plugin {
  return {
    name: 'notes-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const hash = createHash('sha256');
      for (const [name, out] of Object.entries(bundle)) {
        if (name.endsWith('.map')) continue;
        hash.update(name).update(out.type === 'chunk' ? out.code : out.source);
      }
      const pub = publicFiles('public').map((f) => {
        hash.update(f).update(readFileSync(f));
        return relative('public', f).split('\\').join('/');
      });
      const files = [...Object.keys(bundle), ...pub].filter((f) => !f.endsWith('.map') && f !== 'index.html');
      const urls = ['./', ...files.map((f) => `./${f}`)];
      const version = hash.digest('hex').slice(0, 10);
      const source = readFileSync('sw/sw.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(urls, null, 2));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // Relative paths so the build can be hosted from any folder.
  base: './',
  plugins: [react(), serviceWorker()],
});
