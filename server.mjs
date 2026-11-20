import { createServer } from 'node:http';
import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { extname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url));
const BGM_DIR = process.env.BGM_DIR || join(ROOT_DIR, 'bgm');

const files = {
  '/': ['index.html', 'text/html'],
  '/app.mjs': ['app.mjs', 'text/javascript'],
  '/viewer.mjs': ['viewer.mjs', 'text/javascript'],
  '/audio.mjs': ['audio.mjs', 'text/javascript'],
  '/tournament.mjs': ['tournament.mjs', 'text/javascript'],
  '/arena-sim.mjs': ['arena-sim.mjs', 'text/javascript'],
  '/bot.py': ['bot.py', 'text/plain'],
  '/strategy.ts': ['strategy.ts', 'text/plain'],
  '/bot.html': ['bot.html', 'text/html'],
};

const pythonAssets = {
  'pyodide.js': 'text/javascript',
  'pyodide.asm.js': 'text/javascript',
  'pyodide.asm.wasm': 'application/wasm',
  'python_stdlib.zip': 'application/zip',
  'pyodide-lock.json': 'application/json',
};

const audioMimes = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
};

function scanBgmCatalog() {
  if (!existsSync(BGM_DIR)) return [];
  const entries = readdirSync(BGM_DIR).sort();
  const list = [];
  for (const name of entries) {
    const ext = extname(name).toLowerCase();
    if (!Object.hasOwn(audioMimes, ext)) continue;
    const fullPath = join(BGM_DIR, name);
    const title = basename(name, ext).replace(/[_-]+/g, ' ').trim();
    const id = encodeURIComponent(name);
    list.push({ id, title, mime: audioMimes[ext], path: fullPath });
  }
  return list;
}

const bgmCatalog = scanBgmCatalog();
const bgmById = new Map(bgmCatalog.map((t) => [t.id, t]));

async function serveAudio(req, res, track) {
  const info = await stat(track.path);
  const total = info.size;
  const range = req.headers.range;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', track.mime);
  res.setHeader('Cache-Control', 'no-store');
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
    if (start >= total || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` }).end();
      return;
    }
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': end - start + 1,
    });
    createReadStream(track.path, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': total });
    createReadStream(track.path).pipe(res);
  }
}

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (req.method === 'POST' && req.url === '/strip') {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 256 * 1024) {
          res.writeHead(413).end('Strategy exceeds 256 KiB.');
          return;
        }
        chunks.push(chunk);
      }
      const js = stripTypeScriptTypes(Buffer.concat(chunks).toString('utf8'), { mode: 'strip' });
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end(js);
    } else if (req.method === 'GET' && req.url === '/bgm/list') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(bgmCatalog.map(({ id, title }) => ({ id, title, url: `/bgm/${id}` }))));
    } else if (req.method === 'GET' && req.url.startsWith('/bgm/') && bgmById.has(req.url.slice(5))) {
      await serveAudio(req, res, bgmById.get(req.url.slice(5)));
    } else if (req.method === 'GET' && req.url.startsWith('/python/') && Object.hasOwn(pythonAssets, req.url.slice(8))) {
      res.writeHead(200, { 'Content-Type': pythonAssets[req.url.slice(8)], 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      res.end(await readFile(new URL('.' + req.url, import.meta.url)));
    } else if (req.method === 'GET' && Object.hasOwn(files, req.url)) {
      const [file, mime] = files[req.url];
      if (file === 'bot.html') {
        const assets = `http://127.0.0.1:${server.address().port}/python/`;
        res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob: data: ${assets}; worker-src blob:; connect-src ${assets}; form-action 'none'; base-uri 'none'`);
      }
      res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
      res.end(await readFile(new URL(file, import.meta.url)));
    } else {
      res.writeHead(404).end();
    }
  } catch (err) {
    if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end(err.message);
  }
});

server.listen(Number(process.env.PORT ?? 8787), '127.0.0.1', () => {
  console.log(`Open http://127.0.0.1:${server.address().port} (${bgmCatalog.length} BGM tracks loaded)`);
});
