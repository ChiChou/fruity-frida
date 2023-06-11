import { Command } from 'commander';

import useCommonArgs from '../middlewares/args.js';
import { getDeviceFromArg } from '../middlewares/device.js';
import { deploy } from '../modules/deploy.js';
import { connect } from '../modules/ssh.js';

async function main() {
  const program = new Command('Deploy frida-server');
  const args = useCommonArgs(program);
  const device = await getDeviceFromArg(args);

  const client = await connect(device);

  try {
    await deploy(client);
  } finally {
    client.end();
  }
}

main();
