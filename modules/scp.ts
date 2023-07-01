import { EventEmitter } from 'events';
import { PathLike, WriteStream, createWriteStream, promises as fsp, Stats, createReadStream } from 'fs';
import path from 'path';
import { Duplex } from 'stream';
import { promisify } from 'util';

import { Client } from 'ssh2';

import { getUsbDevice } from 'frida';
import { connect } from './ssh.js';


const State = {
  Init: 0,
  Readline: 1,
  Data: 2
}

class SCPReceiver extends Duplex {
  #state = State.Init;

  #remain = 0;
  #size = 0;

  output: WriteStream | null = null;

  mtime: Date | null = null;
  atime: Date | null = null;

  #dest;
  #recursive;

  #components: string[];

  #currentRemote = '';

  constructor(dest: string, recursive: boolean) {
    super();
    this.#dest = dest;
    this.#recursive = recursive;
    this.#components = [];
  }

  #localName(basename: string) {
    const parent = path.resolve(this.#dest, ...this.#components);
    const full = path.resolve(parent, basename);

    const relative = path.relative(parent, full);
    // no special charactor and inside parent
    if (basename !== path.basename(full) || relative !== basename)
      throw new Error('Invalid path');

    return full;
  }

  #remoteName(basename: string) {
    return [...this.#components, basename].join('/');
  }

  #ack() {
    this.push(Buffer.from([0]));
  }

  #pushd(name: string) {
    this.#components.push(name);
  }

  #popd() {
    this.#components.pop();
  }

  _read() {
    if (this.#state == State.Init) {
      this.#ack();
      this.#state = State.Readline;
    }
  }

  async #handleLine(line: string) {
    if (line == 'E') { // sink
      this.#state = State.Readline;
      this.#popd();
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

    const [strMode, strSize, ...tail] = line.split(' ');
    const basename = tail.join(' ');

    const mode = parseInt(strMode.slice(1), 8);
    const size = parseInt(strSize, 10);
    if (basename.includes('/')) throw new Error('Invalid path');

    const name = basename.trimEnd();
    const dest = this.#recursive ? this.#localName(name) : this.#dest;
    const src = this.#currentRemote = this.#remoteName(name);

    if (isFile) {
      this.emit('download', src, size);
      this.emit('progress', src, 0, size);
      this.#state = State.Data;
      this.output = createWriteStream(dest, { mode });
      this.#size = this.#remain = size;
    } else if (isDir) {
      this.emit('mkdir', src);
      await fsp.mkdir(dest, { recursive: true });
      if (this.atime && this.mtime) {
        await fsp.utimes(dest, this.atime, this.mtime);
      }
      this.#pushd(name);
    }
  }

  /**
   * 
   * @param {Buffer} chunk 
   * @param {BufferEncoding} encoding 
   * @param {function} callback
   */
  _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null | undefined) => void) {
    if (this.#state == State.Readline) {
      if (chunk[chunk.length - 1] !== 0x0A)
        return callback(new Error('Invalid protocol, expect \\n'));

      this.#handleLine(chunk.toString().trimEnd())
        .then(() => this.#ack());
    } else if (this.#state == State.Data) {
      if (!this.output)
        return callback(new Error('Invalid state'));

      const src = this.#currentRemote;
      if (chunk.length > this.#remain) {
        const current = this.output.path;
        const { mtime, atime } = this;
        if (atime && mtime) {
          this.output.once('finish', async () => {
            this.#ack();
            fsp.utimes(current, atime, mtime);
            this.emit('done', src);
          });
        }
        if (chunk[this.#remain] !== 0)
          return callback(new Error('Protocol Error'));
        this.output.end(chunk.slice(0, this.#remain));
        this.#state = State.Readline;
        this.#remain = 0;
        this.#size = 0;
      } else {
        this.output.write(chunk);
        this.#remain -= chunk.length;
      }

      this.emit('progress', src, this.output.bytesWritten, this.#size);
    } else {
      callback(new Error('Invalid state'));
    }
    callback();
  }
}

export function quote(name: string) {
  return `'${name.replace(/'/g, `'\\''`)}'`;
}

export class Pull extends EventEmitter {
  #client: Client;
  #recursive: boolean;
  #remote: PathLike;

  receiver: SCPReceiver;

  constructor(client: Client, remote: string, local = '.', recursive = true) {
    super();

    this.#client = client;
    this.#recursive = recursive;
    this.#remote = quote(remote);

    this.receiver = new SCPReceiver(local, recursive);
  }

  async execute() {
    const exec = promisify(this.#client.exec.bind(this.#client));
    const stream = await exec(`scp -v -f -p ${this.#recursive ? '-r' : ''} ${this.#remote}`);

    const receiver = this.receiver;
    stream.stdout.pipe(receiver);
    receiver.pipe(stream.stdin);

    // stream.stderr.pipe(process.stderr);

    await new Promise((resolve, reject) => {
      receiver
        .on('finish', resolve)
        .on('error', reject);
    });
  }

}

class SCPWriter extends Duplex {
  constructor(private local: string, private recursive: boolean) {
    super();
  }

  _read(size: number) {
    // do nothing
  }

  _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null | undefined) => void): void {
    if (chunk.length === 1 && chunk[0] === 0) {
      callback();
      return;
    }

    console.log(chunk)
    console.log(chunk.toString())
    callback();
    // callback(new Error('SCP responded non-zero status'));
  }

  begin() {
    this.#visit(this.local.toString());
  }

  async #visit(item: string) {
    const basename = path.basename(item);
    const stat = await fsp.stat(item);
    if (stat.isDirectory()) {
      this.#create(stat, basename);
      const files = await fsp.readdir(item);
      for (const file of files) {
        await this.#visit(path.join(item, file));
      }
      this.#popd();
    } else if (stat.isFile()) {
      this.#create(stat, basename);
      await new Promise((resolve, reject) => {
        createReadStream(item)
          .on('data', chunk => this.push(chunk))
          .on('end', resolve)
          .on('error', reject);
      });
      this.push(Buffer.from([0]));
    }
  }

  #create(stat: Stats, basename: string) {
    this.push(Buffer.from(stat.isDirectory() ? 'D' : 'C'));

    const mode = (stat.mode & 0o777).toString(8);
    const meta = `0${mode} ${stat.size} ${basename}\n`;
    this.push(Buffer.from(meta));

    const k = 1000;
    const mtime = stat.mtime.getTime();
    const atime = stat.atime.getTime();
    const ts = `T${Math.floor(mtime / k)} ${mtime % k} ${Math.floor(atime / k)} ${atime % k}\n`;
    this.push(Buffer.from(ts));
  }

  #popd() {
    this.push(Buffer.from('E\n'));
  }
}

export class Push extends EventEmitter {
  #client: Client;
  #recursive: boolean;
  #local: string;
  #remote: string;

  constructor(client: Client, local: string, remote: string, recursive = true) {
    super();

    this.#client = client;
    this.#recursive = recursive;
    this.#local = local;
    this.#remote = quote(remote);
  }

  async execute() {
    const exec = promisify(this.#client.exec.bind(this.#client));
    const stream = await exec(`scp -v -t ${this.#recursive ? '-r' : ''} ${this.#remote}`);

    const sender = new SCPWriter(this.#local, this.#recursive);
    stream.stdout.pipe(sender);
    sender.pipe(stream.stdin);

    sender.begin();

    stream.stderr.pipe(process.stderr);

    await new Promise((resolve, reject) => {
      sender
        .on('finish', resolve)
        .on('error', reject);
    });
  }

}

export async function write(client: Client, data: Buffer, remote: string) {
  const exec = promisify(client.exec.bind(client));
  const stream = await exec(`scp -t ${quote(remote)}`);
  const basename = path.basename(remote);
  const info = `C0644 ${data.length} ${basename}\n`;

  const { stdin } = stream;

  stdin.write(info);
  stdin.write(data);
  stdin.write('\x00');
}

(async () => {
  const dev = await getUsbDevice();
  const client = await connect(dev);
  await new Push(client, '/tmp/foo', '/tmp/bar').execute();
})()
