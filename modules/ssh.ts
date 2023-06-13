import frida from 'frida';

import { Client } from 'ssh2';


export async function scan(device: frida.Device) {
  const canidates = [22, 44]
  for (const port of canidates) {
    const ok = await device.openChannel(`tcp:${port}`)
      .then((channel) => new Promise((resolve) => {
        channel
          .once('data', data => {
            resolve(data.readUInt32BE() === 0x5353482d); // SSH-
            channel.destroy();
          })
          .once('error', () => {
            resolve(false);
          });
      }))
      .catch(() => false);

    if (ok) return port;
  }

  throw Error('Port not found. Target device must be jailbroken and with sshd running.');
}

export async function connect(device: frida.Device, user = 'root', password = 'alpine') {
  const port = await scan(device);
  const channel = await device.openChannel(`tcp:${port}`);

  const client = new Client();
  return new Promise<Client>((resolve, reject) => {
    client
      .on('ready', () => resolve(client))
      .on('error', reject)
      .connect({
        sock: channel,
        username: user,
        password,
      });
  });
}


export async function interactive(client: Client, initialCommand?: string) {
  const { stdin, stdout, stderr } = process;
  const { isTTY } = stdout;

  return new Promise<void>((resolve, reject) => {
    client.shell({ term: process.env.TERM || 'vt100' }, (err, stream) => {
      if (err) {
        return reject(err);
      }

      if (isTTY && stdin.setRawMode) {
        stdin.setRawMode(true);
      }

      stream.pipe(stdout);
      stream.stderr.pipe(stderr);
      stdin.pipe(stream);

      if (initialCommand) stream.write(initialCommand + '\n');

      const onResize = () => {
        const [w, h] = process.stdout.getWindowSize();
        stream.setWindow(`${stdout.rows}`, `${stdout.columns}`, `${w}`, `${h}`)
      };

      const cleanup = () => {
        if (isTTY) {
          stdout.removeListener('resize', onResize);
          if (stdin.setRawMode) stdin.setRawMode(false);
        }

        stream.unpipe();
        stream.stderr.unpipe();
        stdin.unpipe();
      }

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      }

      if (isTTY) {
        stream.once('data', onResize);
        process.stdout.on('resize', onResize);
      }

      client.once('end', () => onError(new Error('Connection closed')));

      stream.on('error', onError).on('end', () => {
        resolve();
        cleanup();
      })
    });
  });
}
