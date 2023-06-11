
import fs from 'fs';
import https from 'https';

import { Octokit } from '@octokit/rest';

const OWNER = 'frida';
const REPO = 'frida';

interface DownloadOptions {
  auth?: string;
  filename?: string;
}

export interface DownloadDelegate {
  onProgress(downloaded: number): void;
  onReady(size: number, filename: string): void;
  onEnd(): void;
}

function get302Dest(url: string, httpOpt: https.RequestOptions) {
  return new Promise<string>((resolve, reject) => {
    https.get(url, httpOpt, (res) => {
      if (res.statusCode === 302 && res.headers.location) {
        resolve(res.headers.location);
      } else {
        reject(new Error(`Unexpected response ${res.statusCode}`));
      }
      res.resume();
    });
  });
}

export async function download(opt: DownloadOptions, predicate: (filename: string) => boolean, delegate?: DownloadDelegate) {
  const octokit = new Octokit({ auth: opt.auth });
  const { data } = await octokit.repos.getLatestRelease({
    owner: OWNER,
    repo: REPO,
  });

  const asset = data.assets.find(e => predicate(e.name));
  if (!asset) return;

  const httpOpt = opt.auth ? { headers: { Authorization: `Bearer ${opt.auth}` } } : {};
  const redirect = await get302Dest(asset.browser_download_url, httpOpt)

  return new Promise<void>((resolve, reject) => {
    https.get(redirect, opt, (res) => {
      const contentLength = res.headers['content-length'];
      const preferedName = opt.filename || asset.name;

      if (res.statusCode !== 200 || !contentLength) {
        reject(new Error(`Unexpected response ${res.statusCode}`));
        return;
      }

      const len = parseInt(contentLength, 10);
      let count = 0;

      if (delegate) delegate.onReady(len, preferedName);
      const s = fs.createWriteStream(preferedName)
        .on('error', err => reject(err))
        .on('finish', () => resolve());

      res
        .on('data', chunk => {
          count += chunk.length;
          if (delegate) delegate.onProgress(count);
        })
        .on('error', err => reject(err))
        .pipe(s);
    });
  }).then(() => {
    if (delegate) delegate.onEnd();
  });
}
