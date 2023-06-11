import commander from 'commander';

export interface Options {
  usb: boolean;
  remote: boolean;
  device: string;
  host: string;
}

export type Program = commander.Command & Options;

export default function useCommonArgs(program: commander.Command) {
  program
    .option('-U, --usb', 'connect to USB device')
    .option('-R, --remote', 'connect to remote frida-server')
    .option('-D, --device <uuid>', 'connect to device with the given ID')
    .option('-H, --host <host>', 'connect to remote frida-server on HOST')
    .parse(process.argv);

  const opt = program as Program;

  let count = 0;
  if (opt.usb) count++;
  if (opt.device) count++;
  if (opt.host) count++;
  if (opt.remote) count++;

  if (count === 0) {
    opt.usb = true;
    count++;
  }
  
  if (count !== 1) {
    program.help();
  }

  const args: Options = {
    usb: opt.usb,
    device: opt.device,
    host: opt.host,
    remote: opt.remote,
  };

  return args;
}
