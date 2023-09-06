import { Command } from 'commander';

import { connect, interactive } from '../modules/ssh.js';
import useCommonArgs from '../middlewares/args.js';
import { getDeviceFromArg } from '../middlewares/device.js';

async function main() {
  const program = useCommonArgs(new Command('ios-shell'));
  const device = await getDeviceFromArg(program.parse(process.argv));
 
  // get the environment variable named SSH_USERNAME
  var user_name = process.env.SSH_USERNAME
  if (user_name == undefined || user_name == '') {
      user_name = 'root'
  }
  const client = await connect(device,user_name);

  try {
    await interactive(client);
  } finally {
    client.end();
  }
}

main();
