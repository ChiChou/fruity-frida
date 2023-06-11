import cp from 'child_process';
import { AddressInfo } from 'net';

import { Command } from 'commander';
import { Device } from 'frida';

import useCommonArgs from '../middlewares/args.js';
import { getDeviceFromArg } from '../middlewares/device.js';
import { attach, deploy, spawn } from '../modules/debugserver.js';
import { findFreePort, proxy } from '../modules/iproxy.js';
import { connect } from '../modules/ssh.js';
import { apps } from '../modules/installerproxy.js';

enum DebugMode {
  Spawn,
  Attach,
}

async function debug(device: Device, mode: DebugMode, target: string) {
  const client = await connect(device);
  try {
    await deploy(client);
    const port = await findFreePort(device);
    console.log('remote free port', port)

    async function getStream() {
      if (mode === DebugMode.Spawn) {
        const allApps = await apps(device);
        const app = allApps.find(app => app.CFBundleIdentifier === target || app.CFBundleName === target);
        if (!app) throw Error('app not found');
        const path = app.Path;
        return spawn(client, path, port);
      } else if (mode === DebugMode.Attach) {
        console.log(`attach to ${target}`);
        return attach(client, target, port);
      } else {
        throw Error('unknown mode');
      }
    }

    const stream = await getStream();
    const server = await proxy(device, port);
    const localPort = (server.address() as AddressInfo).port;
    const scripts = [
      '--one-line', `process connect connect://127.1:${localPort}`,
      '--one-line', 'bt',
      '--one-line', 'reg read'];

    const lldb = cp.spawn('lldb', scripts, { stdio: 'inherit' });
    await new Promise<void>((resolve) => {
      lldb.on('exit', () => {
        server.close();
        stream.end();
        resolve();
      });
    })

  } finally {
    client.end();
  }
}

async function main() {
  const program = new Command('Deploy frida-server');
  const args = useCommonArgs(program);
  const device = await getDeviceFromArg(args);

  program
    .command('attach <target>')
    .description('attach to process or pid')
    .action(async (target) => {
      debug(device, DebugMode.Attach, target);
    });

  program
    .command('app <target>')
    .description('spawn app')
    .action(async (target) => {
      debug(device, DebugMode.Spawn, target);
    });

  program
    .command('apps')
    .description('list apps')
    .action(async () => {
      const allApps = await apps(device);
      console.table(allApps.map(app => ({
        name: app.CFBundleDisplayName,
        bundleId: app.CFBundleIdentifier,
        version: app.CFBundleVersion,
      })));
    });

  program.parse(process.argv);
}

main();