
import { Command } from 'commander';

import useCommonArgs from '../middlewares/args.js';
import { getDeviceFromArg } from '../middlewares/device.js';
import { start } from '../modules/deploy.js';
import { connect } from '../modules/ssh.js';

async function main() {
  const program = useCommonArgs(new Command('Deploy and start frida-server'));

  const device = await getDeviceFromArg(program.parse(process.argv));
  const client = await connect(device);

  try {
    await start(client);
  } finally {
    client.end();
  }
}

main();
