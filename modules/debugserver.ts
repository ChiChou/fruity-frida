import readline from 'readline';
import * as cp from 'child_process';
import { promises as fsp } from 'fs';

import { Client, ClientChannel } from 'ssh2';

import { write } from './scp.js';
import { resource } from '../lib/pathutil.js';
import { platform } from 'os';
import { mkdtemp, stat } from 'fs/promises';

const CANIDATES = [
  '/usr/libexec/debugserver', // iOS 16+
  '/Developer/usr/bin/debugserver',  // pre iOS 16
]

const DEBUGSERVER = '/var/root/debugserver';


function debugserver(client: Client, cmd: string): Promise<ClientChannel> {
  const keyword = 'Listening to port ';

  return new Promise((resolve, reject) => {
    client.shell((err, stream) => {
      if (err) reject(err);

      const rl = readline.createInterface({
        input: stream.stdout,
        terminal: false
      });

      rl.on('line', (line) => {
        console.info('remote >>', line);

        if (line.includes(keyword)) {
          resolve(stream);
          rl.close();
        }
      });

      stream.stdin.write(cmd + '\n');
    });
  })
}

function quote(filename: string) {
  return `'${filename.replace(/(['\\])/g, '\\$1')}'`
}

export async function spawn(client: Client, server: string, path: string, port: number): Promise<ClientChannel> {
  const cmd = `${server} 127.1:${port} ${quote(path)}`;
  return debugserver(client, cmd);
}

export async function backboard(client: Client, server: string, path: string, port: number): Promise<ClientChannel> {
  const cmd = `${server} -x backboard 127.1:${port} ${quote(path)}`;
  return debugserver(client, cmd);
}

export function attach(client: Client, server: string, target: number | string, port: number) {
  const cmd = `${server} 127.1:${port} -a ${quote(target.toString())}`;
  return debugserver(client, cmd);
}

export async function deploy(client: Client, version: string) {
  function cmd(cmdline: string) {
    return new Promise((resolve) => {
      client.exec(cmdline, (err, stream) => {
        stream.on('exit', (code: number) => {
          resolve(!err && code === 0);

          stream.close();
        });
      })
    })
  }

  const remoteXML = '/tmp/ent.xml';
  {
    const entXML = resource('debugserver.ent.xml');
    const content = await fsp.readFile(entXML);
    await write(client, content, remoteXML);
  }

  for (const candiate of CANIDATES) {
    if (await cmd(`test -f ${candiate}`)) {
      await cmd(`cp ${candiate} ${DEBUGSERVER}`);
      await cmd(`ldid -S${remoteXML} ${DEBUGSERVER}`);

      console.log(`signed ${candiate} debugserver to ${DEBUGSERVER}`);
      return DEBUGSERVER;
    }
  }

  if (platform() === 'darwin') {
    const shortVersion = version.split('.').slice(0, 2).join('.');

    let ddi = '';
    for (const suffix of ['', '-beta']) {
      const xcode = `/Applications/Xcode${suffix}.app`;
      const support = `${xcode}/Contents/Developer/Platforms/iPhoneOS.platform/DeviceSupport`;
      const dmg = `${support}/${shortVersion}/DeveloperDiskImage.dmg`;

      const exists = await stat(dmg).then(s => s.isFile()).catch(() => false);
      if (exists) {
        ddi = dmg;
        break;
      }
    }

    if (!ddi)
      throw new Error('Unable to find debugserver on device or Xcode.');

    const mountpoint = await mkdtemp('/tmp/DeveloperDiskImage');
    console.log(mountpoint);
    const hdiutil = (...args: string[]) => new Promise<void>((resolve, reject) => {
      const child = cp.execFile('/usr/bin/hdiutil', args);
      child.on('exit', (code, signal) => {
        console.log(code, signal);
        if (code === 0) resolve();
        else reject(new Error(`Unable to mount ${ddi}`));
      });
    });

    await hdiutil('attach', '-mountpoint', mountpoint, ddi);

    try {
      const server = `${mountpoint}/usr/bin/debugserver`;
      const content = await fsp.readFile(server);
      await write(client, content, DEBUGSERVER);
      await cmd(`ldid -S${remoteXML} ${DEBUGSERVER}`);
      console.log(`copied and signed debugserver from Xcode to ${DEBUGSERVER}`);
    } finally {
      await hdiutil('detach', mountpoint);
    }

    return DEBUGSERVER;
  }

  throw new Error('debugserver binary not found. Please make sure DDI is mounted.');
}
