import frida from 'frida';
import path from 'path';

import { WriteStream, createReadStream, createWriteStream, promises as fsp } from 'fs';
import { Client } from 'ssh2';
import { promisify } from 'util';
import { Duplex } from 'stream';


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


export async function write(client: Client, data: Buffer, remote: string) {
  const exec = promisify(client.exec.bind(client));
  const stream = await exec(`scp -t ${remote}`);
  const basename = path.basename(remote);
  const info = `C0644 ${data.length} ${basename}\n`;

  const { stdin } = stream;

  stdin.write(info);
  stdin.write(data);
  stdin.write('\x00');
}


export async function upload(client: Client, local: string, remote: string) {
  const exec = promisify(client.exec.bind(client));
  const stream = await exec(`scp -t ${remote}`);

  const { mode, size } = await fsp.stat(local);
  const oct = (mode & 0o777).toString(8);
  const basename = path.basename(remote);
  const info = `C0${oct} ${size} ${basename}\n`;
  stream.stdin.write(info);

  await new Promise((resolve, reject) => {
    createReadStream(local)
      .once('end', resolve)
      .once('error', reject)
      .pipe(stream.stdin);
  });

  stream.stdin.write('\x00');
}

enum State {
  Init,
  Readline,
  Data,
}

class SCPReceiver extends Duplex {
  state: State = State.Init;
  remain = 0;

  components: string[] = [];
  trunks: Buffer[] = [];
  output: WriteStream | null = null;

  mtime: Date | null = null;
  atime: Date | null = null;
  current: string | null = null;

  private ok = Buffer.from([0]);

  constructor(private dest: string, private recursive: boolean) {
    super();

    this.components = [dest];
  }

  private path(basename: string) {
    const parent = path.resolve(...this.components);
    const full = path.resolve(parent, basename);

    const relative = path.relative(parent, full);
    // no special charactor and inside parent
    if (basename !== path.basename(full) || relative !== basename)
      throw new Error('Invalid path');

    return full;
  }

  private ack() {
    this.push(this.ok);
  }

  private pushd(name: string) {
    this.components.push(name);
  }

  private popd() {
    this.components.pop();
  }

  _read() {
    if (this.state == State.Init) {
      this.ack();
      this.state = State.Readline;
    }
  }

  private async handleLine(line: string) {
    if (line === 'E') { // sink
      this.state = State.Readline;
      this.popd();
      return;
    }

    if (line.startsWith('T')) { // time
      const values = line.substring(1).split(' ').map(str => parseInt(str, 10));
      if (values.length !== 4)
        throw new Error(`Protocol Error, response: ${line}`);

      const [mtime, mtimeNsec, atime, atimeNsec] = values;
      if (mtimeNsec > 999999 || atimeNsec > 999999)
        throw new Error(`time out of range: ${line}`);

      this.mtime = new Date(mtime * 1000 + mtimeNsec / 1000000);
      this.atime = new Date(atime * 1000 + atimeNsec / 1000000);
      return;
    }

    const isFile = line.startsWith('C');
    const isDir = line.startsWith('D');

    if (!isFile && !isDir) {
      throw new Error(`Protocol Error, response: ${line}`);
    }

    const [strMode, strSize, basename] = line.split(' ');
    const mode = parseInt(strMode.slice(1), 8);
    const size = parseInt(strSize, 10);
    if (basename.includes('/')) throw new Error('Invalid path');

    const name = basename.trimEnd();
    const dest = this.recursive ? this.path(name) : this.dest;

    if (isFile) {
      this.state = State.Data;
      this.output = createWriteStream(dest, { mode });
      this.current = dest;
      this.remain = size;
    } else if (isDir) {
      await fsp.mkdir(dest, { recursive: true });
      if (this.atime && this.mtime) {
        await fsp.utimes(dest, this.atime, this.mtime);
      }
      this.pushd(name);
    }
  }

  _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null | undefined) => void): void {
    if (this.state == State.Readline) {
      const index = chunk.indexOf(0x0A); // \n
      if (index > -1) {
        this.trunks.push(chunk.slice(0, index));
        const line = Buffer.concat(this.trunks).toString();
        this.trunks = [chunk.slice(index + 1)];
        this.handleLine(line);
        this.ack();
      } else {
        this.trunks.push(chunk);
      }
    } else if (this.state == State.Data) {
      if (!this.output || !this.current) throw new Error('Invalid state');
      if (chunk.length > this.remain) {
        const current = this.current;
        const mtime = this.mtime;
        const atime = this.atime;

        if (atime && mtime) {
          this.output.once('finish', () => {
            fsp.utimes(current, atime, mtime);
          });
        }

        this.output.end(chunk.slice(0, this.remain));
        this.state = State.Readline;
        if (chunk[this.remain] !== 0) throw new Error('Protocol Error');
        this.trunks = [chunk.slice(this.remain + 1)];
        this.ack();
        this.remain = 0;
      } else {
        this.output.write(chunk);
        this.remain -= chunk.length;
      }
    } else {
      throw new Error('Invalid state');
    }

    callback();
  }
}

export async function download(client: Client, remote: string, local?: string, recursive = false) {
  const exec = promisify(client.exec.bind(client));
  const stream = await exec(`scp -v -f -p ${recursive ? '-r' : ''} ${remote}`);

  // stream.stdout.pipe(process.stdout);

  const duplex = new SCPReceiver(local || '.', recursive);
  stream.stdout.pipe(duplex);
  duplex.pipe(stream.stdin);

  await new Promise<void>((resolve, reject) => {
    duplex
      .on('finish', resolve)
      .on('error', reject);
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
