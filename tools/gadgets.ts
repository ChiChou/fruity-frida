import fs, { PathLike } from 'fs';
import os from 'os';
import path from 'path';

import colors from 'ansi-colors';
import * as progress from 'cli-progress';

import { DownloadDelegate, download } from '../modules/github.js';
import { unxz } from '../modules/xz.js';
import { root } from '../lib/pathutil.js';

const getToken = (() => {
  let token: string | undefined;
  return async () => {
    if (token) return token;

    token = process.env.GITHUB_TOKEN;
    if (token) return token;

    const filename = path.join(root(), '.github-token');
    token = (await fs.promises.readFile(filename)).toString();
    if (token) return token;
  }
})();


function humanFileSize(size: number) {
  const i = size == 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024));
  const unit = ['B', 'kB', 'MB', 'GB', 'TB'][i];
  if (!unit) throw new Error('Out of range');
  const val = (size / Math.pow(1024, i)).toFixed(2);
  return `${val} ${unit}`;
}

class Delegate implements DownloadDelegate {
  bar: progress.SingleBar;
  size: string = 'N/A';

  constructor() {
    this.bar = new progress.SingleBar({
      format: 'Download |' + colors.green('{bar}') + '| {percentage}% || {downloaded}/{totalSize}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });
  }

  onProgress(downloaded: number): void {
    this.bar.update(downloaded, {
      downloaded: humanFileSize(downloaded),
      totalSize: this.size
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onReady(size: number, filename: string): void {
    this.size = humanFileSize(size);
    this.bar.start(size, 0, {
      downloaded: 'N/A',
      totalSize: this.size,
    })
  }

  onEnd() {
    this.bar.stop();
  }
}

async function main() {
  // this script currently only downloads iOS gadget

  const suffix = 'ios-universal.dylib.xz';
  const name = 'gadget-ios.dylib';

  const fridaCache = path.join(os.homedir(), '.cache', 'frida');
  const dylib = path.join(fridaCache, name);
  const xz = path.join(fridaCache, suffix);

  await fs.promises.mkdir(fridaCache, { recursive: true });
  process.chdir(fridaCache);

  const exists = (fullpath: PathLike) =>
    fs.promises.stat(fullpath).then(() => true).catch(() => false);

  if (await exists(dylib)) {
    console.info(`${dylib} already exists, skip`);
    return;
  }

  if (!await exists(xz)) {
    const predicate = (filename: string) =>
      filename.startsWith('frida-gadget-') && filename.endsWith(suffix);

    const auth = await getToken();
    if (!auth) throw new Error('failed to get auth token');

    const delegate = new Delegate();
    await download({ auth, filename: suffix }, predicate, delegate);
  }

  await unxz(suffix, dylib);
  console.info('Saved to', dylib);
}

main();