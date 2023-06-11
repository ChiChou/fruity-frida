import { Command } from 'commander';

import useCommonArgs from '../middlewares/args';
import { getDeviceFromArg } from '../middlewares/device';
import { deploy } from '../modules/deploy';
import { connect } from '../modules/ssh';

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
