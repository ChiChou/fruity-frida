import cp from 'child_process';
import { AddressInfo } from 'net';

import { Command } from 'commander';
import { Device } from 'frida';

import useCommonArgs from '../middlewares/args.js';
import { getDeviceFromArg } from '../middlewares/device.js';
import { attach, backboard, deploy, spawn } from '../modules/debugserver.js';
import { findFreePort, proxy } from '../modules/iproxy.js';
import { connect } from '../modules/ssh.js';
import { apps } from '../modules/installerproxy.js';

enum DebugMode {
  Spawn,
  Attach,
  Backboard,
}

async function debug(device: Device, mode: DebugMode, target: string) {
  const client = await connect(device);
  try {
    const serverPath = await deploy(client);
    const port = await findFreePort(device);
    console.log('remote free port', port)

    async function getStream() {
      if (mode === DebugMode.Backboard) {
        return backboard(client, serverPath, target, port);
      } else if (mode === DebugMode.Spawn) {
        return spawn(client, serverPath, target, port);
      } else if (mode === DebugMode.Attach) {
        console.log(`attach to ${target}`);
        return attach(client, serverPath, target, port);
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
  const program = new Command('ios-debug')
    .option('--ps', 'list processes')
    .option('--apps', 'list apps')
    .option('--attach <pid or program name>', 'attach to process')
    .option('-f, --spawn <path>', 'spawn executable (not recommended)')
    .option('--app <bundle-id>', 'debug app')
    .usage('[options] [target]')

  useCommonArgs(program);

  program.parse(process.argv);

  // check mutually exclusive options
  const count = ['attach', 'app', 'apps', 'ps']
    .reduce((acc, cur) => acc + (program.getOptionValue(cur) ? 1 : 0), 0);

  if (count > 1) {
    console.error('Error: Invalid options combination, please use one of --app, --apps, --ps')
    program.help();
  }

  const device = await getDeviceFromArg(program);
  if (program.getOptionValue('ps')) {
    const ps = await device.enumerateProcesses();
    for (const p of ps) {
      console.log(`${p.pid.toString().padStart(5)} ${p.name}`);
    }
  } else if (program.getOptionValue('apps')) {
    for (const app of await apps(device)) {
      console.log(`${app.CFBundleName} [${app.CFBundleIdentifier}] (${app.CFBundleVersion})`);
    }
  } else {
    let target: string | undefined = program.getOptionValue('app');
    let mode = DebugMode.Backboard;

    if (target) {
      const list = await apps(device);
      const app = list.find(app => app.CFBundleIdentifier === target || app.CFBundleName === target);

      if (!app) {
        console.error(`Error: app ${target} not found`);
        process.exit(1);
      }

      target = app.Path;
    } else {
      target = program.getOptionValue('spawn');
      mode = DebugMode.Spawn;
    }

    if (!target) {
      target = program.getOptionValue('attach') || program.args[0];
      mode = DebugMode.Attach;
    }

    if (target) {
      debug(device, mode, target);
    } else {
      console.error('Error: Missing target');
      program.help();
    }
  }
}

main();