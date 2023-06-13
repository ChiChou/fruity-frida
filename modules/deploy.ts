import { constants, promises as fsp } from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';

import { Client } from 'ssh2';

import { Archive } from './ar.js';
import { packages } from "./cydia.js";
import { interactive } from './ssh.js';
import { write } from './scp.js';


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

async function getFridaDeb() {
  const cacheDir = path.join(os.homedir(), '.cache', 'frida');
  const url = await latest();
  const filename = path.basename(url.pathname);
  const cache = path.join(cacheDir, filename);

  const exists = (path: string) =>
    fsp.access(path, constants.F_OK)
      .then(() => true)
      .catch(() => false);

  if (!await exists(cacheDir)) {
    await fsp.mkdir(cacheDir, { recursive: true });
  }

  let ar: Buffer;

  if (!await exists(cache)) {
    console.log(`downloading frida-server from ${url}`);

    ar = await new Promise<Buffer>((resolve, reject) => {
      https.get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Unexpected status code: ${res.statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        res
          .on('data', (chunk) => chunks.push(chunk))
          .on('end', () => resolve(Buffer.concat(chunks)))
          .on('error', reject);
      });
    });

    await fsp.writeFile(cache, ar);
  } else {
    console.log('found cache');
    ar = await fsp.readFile(cache);
  }

  return findInAr(ar, 'data.tar.xz');
}

export async function deploy(client: Client, cwd: string = '/tmp/frida') {
  const dest = '/tmp/data.tar.xz';
  const xz = await getFridaDeb();

  // todo: check installation
  await write(client, xz, dest);

  const script = [
    `mkdir -p ${cwd}`,
    `cd ${cwd}`,
    `tar -xf ${dest} -C ${cwd}`,
    `exit`
  ];

  await interactive(client, script.join('\n'));
}

export async function start(client: Client) {
  // todo: configurable cwd
  const cwd = '/tmp/frida';
  await deploy(client);

  const script = [
    `CRYPTEX_MOUNT_PATH=${cwd} ${cwd}/usr/sbin/frida-server`
  ];

  await interactive(client, script.join('\n'));
}