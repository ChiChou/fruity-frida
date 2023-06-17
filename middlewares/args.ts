import { Command } from 'commander';

import pkg from '../package.json' assert { type: "json" };

export interface Options {
  usb: boolean;
  remote: boolean;
  device: string;
  host: string;
}

export type Program = Command & Options;

export default function useCommonArgs(program: Command) {
  return program
    .version(pkg.version)
    .option('-U, --usb', 'connect to USB device')
    .option('-R, --remote', 'connect to remote frida-server')
    .option('-D, --device <uuid>', 'connect to device with the given ID')
    .option('-H, --host <host>', 'connect to remote frida-server on HOST')
}
