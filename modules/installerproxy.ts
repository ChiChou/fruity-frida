import { Duplex } from 'stream';

import { Device } from 'frida';

import BPlistCreator from 'bplist-creator';
import BPlistParser from 'bplist-parser';


enum STATE {
  GET_LENGTH,
  READ_BODY,
}

interface App {
  CFBundleVersion: string;
  CFBundleIdentifier: string;
  CFBundleDisplayName: string;
  CFBundleExecutable: string;
  CFBundleName: string;
  CFBundleShortVersionString: string;
  Path: string;
  Container: string;
}

interface Response {
  Status: 'BrowsingApplications' | 'Complete';
  CurrentList: App[];
  CurrentIndex: number;
  CurrentAmount: number;
}

class PacketWrapper extends Duplex {
  sum = 0;
  buffer = Buffer.alloc(0);

  state: STATE = STATE.GET_LENGTH;
  expected = 4;

  _write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= this.expected) {
      this.digest();
    }

    callback();
  }

  digest() {
    if (this.state == STATE.GET_LENGTH) {
      this.expected = this.buffer.readUInt32BE();
      this.state = STATE.READ_BODY;
      this.buffer = this.buffer.slice(4);
    } else {
      const tail = this.buffer.slice(this.expected);
      this.emit('response', this.buffer.slice(0, this.expected));
      this.expected = 4;
      this.state = STATE.GET_LENGTH;
      this.buffer = tail;
    }
  }

  send(packet: Buffer) {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(packet.length);
    this.push(header);
    this.push(packet);
  }

  _read(): void {

  }
}

export async function apps(dev: Device): Promise<App[]> {
  const remote = await dev.openChannel(`lockdown:com.apple.mobile.installation_proxy`);

  const wrapper = new PacketWrapper();
  remote.pipe(wrapper);
  wrapper.pipe(remote);

  const msg = BPlistCreator({
    Command: 'Browse',
    ClientOptions: {
      ApplicationType: 'Any',
      ReturnAttributes: [
        'CFBundleDisplayName',
        'CFBundleExecutable',
        'CFBundleIdentifier',
        'CFBundleName',
        'CFBundleVersion',
        'CFBundleShortVersionString',
        'Path',
        'Container'
      ]
    }
  });

  return new Promise<App[]>(resolve => {
    const allApps: App[] = [];
    wrapper.on('response', (msg: Buffer) => {
      const parsed = BPlistParser.parseBuffer<Response>(msg);
      const result = parsed[0];

      if (result.Status == 'Complete') {
        resolve(allApps);
        remote.destroy();
      } else if (result.Status == 'BrowsingApplications') {
        allApps.push(...result.CurrentList);
      }
    });
    wrapper.send(msg);
  });
}
