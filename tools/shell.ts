import commander from 'commander';

import { connect, interactive } from '../modules/ssh';
import useCommonArgs from '../middlewares/args';
import { getDeviceFromArg } from '../middlewares/device';

async function main() {
  const program = new commander.Command('Shell');
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