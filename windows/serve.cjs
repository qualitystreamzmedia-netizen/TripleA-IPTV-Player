const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const root = path.resolve(__dirname, "..");
const web = path.join(root, "web");
const port = Number(process.env.TRIPLEA_PORT || 4173);

function send(res, status, body, headers) {
  const extra = Object.assign(
    {
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "credentialless",
      "cross-origin-resource-policy": "cross-origin",
    },
    headers || {},
  );
  res.writeHead(status, extra);
  if (body) res.end(body);
  else res.end();
}

function blocked(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "0.0.0.0" || host === "::" || host === "::1") return true;
  const parts = host.split(".").map(Number);
  if (parts.length === 4 && parts.every((n) => n >= 0 && n <= 255)) {
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

async function pull(raw, hops, range, attempt) {
  if (hops > 3) throw new Error("Too many redirects");
  let target;
  try {
    target = new URL(raw);
  } catch {
    throw new Error("Bad address");
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("Only http and https");
  if (blocked(target.hostname)) throw new Error("That address is not allowed");
  const headers = { accept: "*/*", "user-agent": "VLC/3.0.20 LibVLC/3.0.20" };
  if (range) headers.range = range;
  const response = await fetch(target, { redirect: "manual", headers });
  if ((response.status === 429 || response.status === 503) && attempt < 3 && !range) {
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    return pull(raw, hops, range, attempt + 1);
  }
  if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
    await response.body?.cancel();
    return pull(new URL(response.headers.get("location"), target).toString(), hops + 1, range, attempt);
  }
  return { response, url: target.toString() };
}

function rewritePlaylist(text, base, requestUrl) {
  const wrap = (value) => {
    let absolute = value;
    try {
      absolute = new URL(value, base).toString();
    } catch {
      /* keep the line */
    }
    const next = new URL(requestUrl);
    next.search = "";
    next.searchParams.set("url", absolute);
    return next.toString();
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) return line.replace(/URI="([^"]+)"/gi, (_match, uri) => `URI="${wrap(uri)}"`);
      return wrap(trimmed);
    })
    .join("\n");
}

function videoType(urlPath) {
  if (/\.mp4$|\.m4v$/i.test(urlPath)) return "video/mp4";
  if (/\.webm$/i.test(urlPath)) return "video/webm";
  if (/\.mov$/i.test(urlPath)) return "video/quicktime";
  if (/\.mkv$/i.test(urlPath)) return "video/x-matroska";
  return "";
}

async function pipeRest(res, reader, first) {
  if (first && first.length) {
    if (!res.write(first)) await new Promise((resolve) => res.once("drain", resolve));
  }
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    const chunk = Buffer.from(next.value);
    if (!chunk.length) continue;
    if (!res.write(chunk)) await new Promise((resolve) => res.once("drain", resolve));
  }
  res.end();
}

async function handleMedia(req, res, requestUrl) {
  const raw = requestUrl.searchParams.get("url") || "";
  if (!raw) return send(res, 400, "Missing url");
  let pulled;
  try {
    pulled = await pull(raw, 0, req.headers.range, 0);
  } catch (error) {
    return send(res, 502, error instanceof Error ? error.message : "Could not fetch");
  }
  const upstream = pulled.response;
  if (!upstream.body) return send(res, upstream.status || 502, "Empty stream");
  const reader = upstream.body.getReader();
  const abort = () => {
    reader.cancel().catch(() => undefined);
  };
  res.on("close", abort);
  const chunks = [];
  let size = 0;
  while (size < 512) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(Buffer.from(next.value));
    size += next.value.byteLength;
  }
  const head = chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
  const type = upstream.headers.get("content-type") || "";
  const finalPath = pulled.url.split("?")[0] || pulled.url;
  const preview = head.slice(0, 180).toString("utf8");
  const isTs = head.length > 0 && head[0] === 0x47;
  const listed = /mpegurl|m3u8|octet-stream|text\/plain/i.test(type) || /\.(m3u8)(\?|$)/i.test(finalPath);
  const playlist = !isTs && listed && (preview.includes("#EXTM3U") || preview.includes("#EXTINF"));
  if (playlist) {
    const all = [head];
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      all.push(Buffer.from(next.value));
    }
    const text = Buffer.concat(all).toString("utf8");
    const body = rewritePlaylist(text, pulled.url, requestUrl.toString());
    return send(res, upstream.status || 200, body, {
      "content-type": "application/vnd.apple.mpegurl",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
  }
  const headers = {
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "content-type": isTs ? "video/mp2t" : videoType(finalPath) || type || "application/octet-stream",
  };
  if (upstream.status === 206) {
    const length = upstream.headers.get("content-length");
    const range = upstream.headers.get("content-range");
    const accept = upstream.headers.get("accept-ranges");
    if (length) headers["content-length"] = length;
    if (range) headers["content-range"] = range;
    if (accept) headers["accept-ranges"] = accept;
  }
  res.writeHead(upstream.status || 200, headers);
  try {
    await pipeRest(res, reader, head);
  } catch {
    if (!res.writableEnded) res.end();
  }
}

function serveFile(res, file) {
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) return send(res, 404, "Not found");
    const ext = path.extname(file).toLowerCase();
    const types = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".jpg": "image/jpeg",
      ".ico": "image/x-icon",
      ".wasm": "application/wasm",
      ".ttf": "font/ttf",
    };
    res.writeHead(200, {
      "content-type": types[ext] || "application/octet-stream",
      "cache-control": "no-store",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "credentialless",
      "cross-origin-resource-policy": "cross-origin",
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname === "/api/media") {
    handleMedia(req, res, url).catch((error) => {
      if (!res.headersSent) send(res, 502, error instanceof Error ? error.message : "Could not fetch");
      else res.end();
    });
    return;
  }
  let file = path.join(web, decodeURIComponent(url.pathname));
  if (url.pathname === "/pip" || url.pathname === "/pip/") file = path.join(web, "pip.html");
  else if (url.pathname === "/" || url.pathname === "") file = path.join(web, "index.html");
  if (!file.startsWith(web)) return send(res, 403, "Forbidden");
  fs.stat(file, (error, stat) => {
    if (!error && stat.isDirectory()) file = path.join(file, "index.html");
    if (error || !fs.existsSync(file)) file = path.join(web, "index.html");
    serveFile(res, file);
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`ready ${port}\n`);
});
