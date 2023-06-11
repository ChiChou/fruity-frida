import * as frida from "frida";

import { Options } from './args.js';

export function getDeviceFromArg(opt: Options): Promise<frida.Device> {
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
