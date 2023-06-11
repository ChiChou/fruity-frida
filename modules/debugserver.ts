import path from 'path';
import readline from 'readline';

import { Client, ClientChannel } from 'ssh2';
import { upload } from './ssh';

const CANIDATES = [
  '/usr/libexec/debugserver', // iOS 16+
  '/Developer/usr/bin/debugserver',  // pre iOS 16
]

const DEBUGSERVER = '/tmp/debugserver';


function debugserver(client: Client, cmd: string): Promise<ClientChannel> {
  const keyword = 'Listening to port ';
  
  return new Promise((resolve, reject) => {
    client.shell((err, stream) => {
      if (err) reject(err);

      const rl = readline.createInterface({
        input: stream.stdout,
        terminal: false
      });

      rl.on('line', (line) => {
        console.info('remote >>', line);

        if (line.includes(keyword)) {
          resolve(stream);
          rl.close();
        }
      });

      stream.stdin.write('killall debugserver\n');
      stream.stdin.write(cmd + '\n');
    });
  })
}

// shell injection, but unvoidable
export async function spawn(client: Client, path: string, port: number): Promise<ClientChannel> {
  const cmd = `${DEBUGSERVER} -x backboard 127.1:${port} ${path}`;
  return debugserver(client, cmd);
}

export function attach(client: Client, target: number | string, port: number) {
  const cmd = `${DEBUGSERVER} 127.1:${port} -a ${target}`;
  return debugserver(client, cmd);
}

export async function deploy(client: Client) {
  function cmd(cmdline: string) {
    return new Promise((resolve) => {
      client.exec(cmdline, (err, stream) => {
        stream.on('exit', (code: number) => {
          resolve(!err && code === 0);

          stream.close();
        });
      })
    })
  }

  const entXML = path.join(__dirname, '..', 'resources', 'debugserver.ent.xml');
  const remoteXML = '/tmp/ent.xml';
  await upload(client, entXML, remoteXML);

  let found = false;
  for (const candiate of CANIDATES) {
    if (await cmd(`test -f ${candiate}`)) {
      await cmd(`cp ${candiate} ${DEBUGSERVER}`);
      await cmd(`ldid -S${remoteXML} ${DEBUGSERVER}`);
      found = true;

      console.log(`signed ${candiate} debugserver to ${DEBUGSERVER}`);
      break;
    }
  }

  return found;

}