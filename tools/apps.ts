import { Command } from "commander";

import useCommonArgs from "../middlewares/args.js";
import { getDeviceFromArg } from "../middlewares/device.js";
import { apps } from "../modules/installerproxy.js";

async function main() {
  const program = new Command('Deploy frida-server');
  const args = useCommonArgs(program);
  const device = await getDeviceFromArg(args);
  
  for (const app of await apps(device)) {
    console.log(app);
  }
}

main();
