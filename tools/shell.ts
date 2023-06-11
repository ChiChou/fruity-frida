import { Command } from 'commander';

import { connect, interactive } from '../modules/ssh.js';
import useCommonArgs from '../middlewares/args.js';
import { getDeviceFromArg } from '../middlewares/device.js';

async function main() {
  const program = new Command('Shell');
  const args = useCommonArgs(program);
  const device = await getDeviceFromArg(args);
  const client = await connect(device);

  try {
    await interactive(client);
  } finally {
    client.end();
  }
}

main();