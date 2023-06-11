import { fileURLToPath } from 'url';
import { sep, dirname, basename, join } from 'path';

const __root = findRoot();

function findRoot() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const parent = dirname(__dirname);

  return basename(parent) === 'out' ? dirname(parent) : parent;
}

/**
 * get the root directory of the project
 */
export function root() {
  return __root;
}

/**
 * locate a resource file
 * @param components path components
 * @returns the full path
 */
export function resource(...components: string[]) {
  return join(__root, 'resources', ...components);
}
