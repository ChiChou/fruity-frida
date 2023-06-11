import fs from 'fs';
import cp from 'child_process';
import os from 'os';

export async function unxz(src: string, dest: string) {
  const output = fs.createWriteStream(dest);

  if (os.platform() === 'win32') {
    return import('lzma-native')
      .then(lzma => new Promise<void>((resolve, reject) => {
        const decompressor = lzma.createDecompressor();
        const input = fs.createReadStream(src);
        input.pipe(decompressor).pipe(output)
          .on('finish', resolve).on('error', reject);
      }))
      .catch((_) => Promise.reject(
        new Error('Unable to import lzma-native, this is required on Windows')));
  }

  // lamz-native does not work on macOS, use gunzip instead
  // https://github.com/addaleax/lzma-native/issues/137

  return new Promise<void>((resolve, reject) => {
    const p = cp.spawn('gunzip', ['--to-stdout', src])
      .on('error', reject)
      .on('exit', (code) => {
        if (code === 0)
          resolve();
        else
          reject(new Error(`gunzip exited with code ${code}`));
      });

    p.stdout.pipe(output);
  });
}

// unxz('ios-universal.dylib.xz', 'ios-universal.dylib');
