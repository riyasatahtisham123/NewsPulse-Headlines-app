/* ============================================================
   server.js — local test server (sirf apke computer ke liye)
   Live Server / double-click me /api/news nahi chal sakta,
   kyunki woh sirf file serve karta hai. Yeh chhota server
   Vercel jaisa /api/news ko Node function ki tarah chalata hai.

   Chalane ka tareeka:  "Start News App" par double-click
   ya folder me  →  node server.js
   Browser apne aap khulega: http://127.0.0.1:3000
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const newsFn = require(path.join(ROOT, 'api', 'news.js'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf'
};

function runFunction(req, res, query) {
  const fakeRes = {
    setHeader: (k, v) => res.setHeader(k, v),
    status: code => { fakeRes.code = code; return fakeRes; },
    json: body => {
      res.writeHead(fakeRes.code, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    },
    end: text => { res.writeHead(fakeRes.code); res.end(text || ''); },
    code: 200
  };
  newsFn({ query, method: req.method, url: req.url }, fakeRes);
}

function serveStatic(req, res, pathname) {
  const file = path.resolve(ROOT, '.' + decodeURIComponent(pathname));
  // folder ke bahar nikalna roko (../ jaisi paths)
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
    res.writeHead(403); return res.end('forbidden');
  }
  const target = fs.existsSync(file) && fs.statSync(file).isDirectory() ? path.join(file, 'index.html') : file;
  if (!fs.existsSync(target)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/news') return runFunction(req, res, Object.fromEntries(u.searchParams));
  serveStatic(req, res, u.pathname === '/' ? '/index.html' : u.pathname);
}).listen(PORT, () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log('\n  News App chal raha hai → ' + url);
  console.log('  API live: ' + url + '/api/news?cat=top');
  console.log('  Band karne ke liye: Ctrl + C\n');
  if (!process.env.NO_OPEN) exec(`cmd /c start "" "${url}"`);
});
