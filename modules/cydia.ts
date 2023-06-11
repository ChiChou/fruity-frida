import https from 'https';

function getHTTPText(url: URL) {
  return new Promise<string>((resolve, reject) => {
    https.get(url, (res) => {
      const chunks: string[] = [];

      res.setEncoding('utf-8')
        .on('data', (chunk) => { chunks.push(chunk) })
        .on('end', () => resolve(chunks.join('')))
        .on('error', reject);
    });
  });
}

function* parse(packages: string) {
  const lines = packages.split('\n');
  let item: { [key: string]: string } = {};
  for (const line of lines) {
    if (!line.includes(':')) {
      if (Object.keys(item).length > 0) {
        yield item;
        item = {};
      }
    } else {
      const [key, value] = line.split(':', 2);
      item[key] = value.trim();
    }
  }
}

export async function* packages(repo: URL) {
  const packages = await getHTTPText(new URL('/Packages', repo));
  yield* parse(packages);
}
