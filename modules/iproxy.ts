import { createServer, Server } from 'net';
import { Device } from 'frida';

export async function findFreePort(device: Device) {
  for (let i = 1024; i < 65536; i++) {
    const ok = await device.openChannel(`tcp:${i}`).then(channel => {
      channel.end();
      return false;
    }).catch(err => /connection refused/.exec(err));

    if (ok) return i;
  }

  throw new Error('no free port found');
}

export async function proxy(dev: Device, port: number): Promise<Server> {
  const server = createServer(async (socket) => {
    const remote = await dev.openChannel(`tcp:${port}`);
    socket.pipe(remote).pipe(socket);
    const end = () => remote.end();
    socket.on('error', end).on('close', end);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.1', () => resolve(server));
  });
}
