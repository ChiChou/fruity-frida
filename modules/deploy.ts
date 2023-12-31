import { PathLike, createWriteStream, promises as fsp } from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';

import { Client } from 'ssh2';

import { Archive } from './ar.js';
import { packages } from "./cydia.js";
import { interactive } from './ssh.js';
import { quote, write } from './scp.js';


async function latest() {
  const REPO_URL = new URL('https://build.frida.re');
  for await (const item of packages(REPO_URL)) {
    if (item['Package'] === 're.frida.server') {
      return new URL(item['Filename'], REPO_URL);
    }
  }

  throw new Error('Unable to find the latest package');
}

function findInAr(data: Buffer, name: string) {
  const ar = new Archive(data);

  for (const file of ar.getFiles()) {
    if (file.name() === name) {
      return file.fileData();
    }
  }

  throw new Error('Unable to find the data.tar.xz');
}

function downloadTo(url: URL, dest: PathLike) {
  return new Promise<void>((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Unexpected status code: ${res.statusCode}`));
        return;
      }

      let total = 0;
      const stream = createWriteStream(dest);
      res
        .on('data', (chunk: Buffer) => {
          total += chunk.length;
          process.stdout.write(`\rDownloaded ${total} bytes`)
        })
        .on('end', () => {
          resolve();
          console.log('\nDownload finished');
        })
        .on('error', reject)
        .pipe(stream);
    });
  });
}

async function getFridaDeb(force: boolean) {
  const cacheDir = path.join(os.homedir(), '.cache', 'frida');

  const dirExists = (p: PathLike) => fsp.stat(p).then(
    stats => stats.isDirectory()).catch(() => false);

  const fileExists = (p: PathLike) => fsp.stat(p).then(
    stats => stats.isFile()).catch(() => false);

  let download: boolean | undefined = undefined;

  if (force) {
    download = true;
  }

  if (!await dirExists(cacheDir)) {
    await fsp.mkdir(cacheDir, { recursive: true });
    download = true;
  }

  const defaultName = path.join(cacheDir, 're.frida.server.deb');
  if (!download && await fileExists(defaultName)) {
    return defaultName;
  }

  const url = await latest();
  const filename = path.basename(url.pathname);
  const cache = path.join(cacheDir, filename);

  if (await fileExists(cache) && !download) {
    console.log('found cache');
  } else {
    console.log(`downloading frida-server from ${url}`);

    await downloadTo(url, cache);
    if (await fileExists(defaultName)) await fsp.rm(defaultName);
    await fsp.symlink(cache, defaultName);
  }
  return cache;
}

export async function deploy(client: Client, root: string, upgrade: boolean) {
  const dest = '/tmp/data.tar.xz';
  const deb = await getFridaDeb(upgrade);
  const ar = await fsp.readFile(deb);
  const xz = findInAr(ar, 'data.tar.xz');

  // todo: use unxz() locally and finish scp push function
  await write(client, xz, dest);

  const quoted = quote(root);
  const script = [
    `mkdir -p ${quoted}`,
    `cd ${quoted}`,
    `tar -xf ${dest} -C ${quoted}`,
    `exit`
  ];

  await interactive(client, script.join('\n'));
}

export async function start(client: Client, root: string, upgrade = false) {
  const quoted = quote(root);
  const server = quote(root + '/usr/sbin/frida-server');

  let override = upgrade;

  if (!upgrade) {
    // check existing frida-server
    const installed = await new Promise<boolean>((resolve) => {
      client.exec(`[ -x ${server} ]`, (err, stream) => {
        if (err) return resolve(false);
        stream.on('exit', code => resolve(code === 0));
      });
    });

    override = !installed;
  }

  if (override)
    await deploy(client, root, upgrade);

  const script = [
    `CRYPTEX_MOUNT_PATH=${quoted} ${server}`
  ];

  await interactive(client, script.join('\n'));
}