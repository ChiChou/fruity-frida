import { Command } from 'commander';

import { connect, interactive } from '../modules/ssh.js';
import useCommonArgs from '../middlewares/args.js';
import { getDeviceFromArg } from '../middlewares/device.js';

async function main() {
  const program = useCommonArgs(new Command('ios-shell'));
  const device = await getDeviceFromArg(program.parse(process.argv));
  const client = await connect(device);

  try {
    await interactive(client);
  } finally {
    client.end();
  }
}

main();
