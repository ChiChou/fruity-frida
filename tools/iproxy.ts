import net from 'net';

import { Command } from 'commander';

import useCommonArgs from '../middlewares/args.js';
import { getDeviceFromArg } from '../middlewares/device.js';

async function main() {
  const program = useCommonArgs(new Command('iproxy-js'));

  program
    .argument('source', 'source port')
    .argument('destination', 'destination port')
    .action(async (source, destination) => {
      const src = parseInt(source, 10);
      const dst = parseInt(destination, 10);

      if (src.toString() !== source)
        throw Error('invalid source port');

      if (dst.toString() !== destination)
        throw Error('invalid destination port');

      const device = await getDeviceFromArg(program);
      net.createServer(async (socket) => {
        const channel = await device.openChannel(`tcp:${destination}`);
        socket
          .on('close', () => channel.destroy())
          .on('error', console.error.bind(console))
          .pipe(channel).pipe(socket);
      }).listen(src);

      console.log(`proxy ${source} -> ${destination}`);
    })
    .parse(process.argv);
}

main();