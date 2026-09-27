import { existsSync, lstatSync, readdirSync, realpathSync, rmdirSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const output = join(root, 'dist');

// Node 24.13 on this Windows/OneDrive workspace crashes in recursive rmSync.
// Unlink files individually, and never follow a link outside this project's dist.
function clearDirectory(directory) {
  const actual = realpathSync(directory);
  if (actual !== output && !actual.startsWith(output + sep)) {
    throw new Error('Refusing to clean outside the project dist directory.');
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      clearDirectory(target);
      rmdirSync(target);
    } else {
      unlinkSync(target);
    }
  }
}

if (existsSync(output)) {
  if (lstatSync(output).isSymbolicLink() || realpathSync(output) !== output) {
    throw new Error('The project dist directory must not be a symbolic link.');
  }
  clearDirectory(output);
}
await build({ root, build: { outDir: output, emptyOutDir: false } });
