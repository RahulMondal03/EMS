/* tests/static-server.js — zero-dependency static file server for the
   e2e suite. Serves the app in "ems 9/" (the space in the directory
   name is why the suite needs its own server rather than a one-liner).
   Port comes from PORT, default 4173. */

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "ems 9");
const PORT = Number(process.env.PORT) || 4173;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  let filePath = path.join(ROOT, urlPath);

  /* never serve outside the app directory */
  if (!path.resolve(filePath).startsWith(path.resolve(ROOT))) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }
  fs.readFile(filePath, (err, body) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found: " + urlPath);
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
    }).end(body);
  });
});

server.listen(PORT, () => console.log("VoltGrid app served on http://127.0.0.1:" + PORT));
