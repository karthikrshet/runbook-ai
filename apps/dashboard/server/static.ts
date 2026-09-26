import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Serves the built client from `root`; unknown extensionless paths fall back to index.html. */
export function createStaticHandler(root: string) {
  const base = resolve(root);
  const index = join(base, 'index.html');

  return async (url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    const candidate = resolve(base, `.${pathname}`);
    if (pathname.includes('\0') || (candidate !== base && !candidate.startsWith(base + sep))) {
      res.writeHead(404).end('Not found');
      return;
    }

    let file = candidate;
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      if (extname(pathname) !== '') {
        res.writeHead(404).end('Not found');
        return;
      }
      file = index;
    }

    const immutable = file.startsWith(join(base, 'assets') + sep);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  };
}
