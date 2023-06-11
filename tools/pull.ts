import { Command } from 'commander';

import { connect, download } from '../modules/ssh.js';
import useCommonArgs from '../middlewares/args.js';
import { getDeviceFromArg } from '../middlewares/device.js';

async function main() {
  const program = useCommonArgs(new Command('pull'));

  const device = await getDeviceFromArg(program.parse(process.argv));
  const client = await connect(device);

  try {
    await download(client, '/private/var/containers/Bundle/Application/EB6E9437-2E30-4618-A7E3-53012E663E8E/stable.app', './stable.app', true);
  } finally {
    client.end();
  }
}

main();