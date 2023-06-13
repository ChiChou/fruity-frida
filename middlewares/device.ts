import * as frida from "frida";

import { Command } from "commander";
import { Program } from './args.js';

export function getDeviceFromArg(cmd: Command): Promise<frida.Device> {
  const opt = cmd as Program;

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
    cmd.help();
  }

  if (opt.usb) {
    return frida.getUsbDevice();
  } else if (opt.device) {
    return frida.getDevice(opt.device);
  } else if (opt.remote) {
    return frida.getRemoteDevice();
  } else if (opt.host) {
    return frida.getDeviceManager().addRemoteDevice(opt.host);
  }

  throw new Error('invalid options');
}
