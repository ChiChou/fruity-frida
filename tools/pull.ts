import { Command } from 'commander';

import useCommonArgs from '../middlewares/args.js';
import { getDeviceFromArg } from '../middlewares/device.js';
import { Pull } from '../modules/scp.js';
import { connect } from '../modules/ssh.js';

async function main() {
  const program = useCommonArgs(new Command('ios-pull'))
    .usage('[options] <source1> [<source2> ...] [<destination>]')
    .parse(process.argv);

  const { args } = program;

  if (args.length === 1) {
    args.push('.');
  } else if (args.length === 0) {
    program.help();
  }

  const device = await getDeviceFromArg(program);
  const client = await connect(device);

  const sources = args.slice(0, -1);
  const destination = args[args.length - 1];

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