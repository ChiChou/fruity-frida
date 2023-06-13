import { Command } from 'commander';

import useCommonArgs from '../middlewares/args.js';
import { getDeviceFromArg } from '../middlewares/device.js';
import { Pull } from '../modules/scp.js';
import { connect } from '../modules/ssh.js';

async function main() {
  const program = useCommonArgs(new Command('pull'))
    .parse(process.argv);

  if (program.args.length < 2) {
    program.help();
  }

  const device = await getDeviceFromArg(program);
  const client = await connect(device);

  const sources = program.args.slice(0, -1);
  const destination = program.args[program.args.length - 1];

  try {
    for (const source of sources) {
      const pull = new Pull(client, source, destination);
      pull.receiver.on('done', (src) => {
        console.info(`${src}`);
      });
      await pull.execute();
    }
  } finally {
    client.end();
  }
}

main();