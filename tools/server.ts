
import { Command } from 'commander';

import useCommonArgs from '../middlewares/args.js';
import { getDeviceFromArg } from '../middlewares/device.js';
import { start } from '../modules/deploy.js';
import { connect } from '../modules/ssh.js';

async function main() {
  const program = useCommonArgs(new Command('run-frida-server'));
  program.option('-f, --force', 'force upgrade');

  const device = await getDeviceFromArg(program.parse(process.argv));

  // check existing frida-server
  try {
    const remote = await device.openChannel('tcp:27042');
    remote.end();

    console.log('frida-server is already running. Exiting...');
    return;
  } catch(_) {

  }

  const client = await connect(device);

  try {
    await start(client, program.getOptionValue('force'));
  } finally {
    client.end();
  }
}

main();
