import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, isAbsolute, normalize, relative, resolve } from 'node:path';

const port = Number(process.argv[2] || 31828);
const root = process.cwd();

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  if (url.pathname === '/favicon.ico') {
    res.writeHead(204, { 'cache-control': 'no-store' });
    res.end();
    return;
  }

  let requestedPath;
  try {
    requestedPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  const filePath = resolve(root, `.${normalize(requestedPath)}`);
  const relPath = relative(root, filePath);

  if (relPath.startsWith('..') || isAbsolute(relPath) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  res.writeHead(200, {
    'content-type': contentTypes[extname(filePath)] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(filePath).pipe(res);
});

server.listen(port, '127.0.0.1');

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
