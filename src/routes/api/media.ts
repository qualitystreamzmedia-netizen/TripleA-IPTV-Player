import { createFileRoute } from "@tanstack/react-router";

const MAX_URL = 12000;
const MAX_HOPS = 3;

function blockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1" ||
    host === "metadata.google.internal"
  ) {
    return true;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) {
    if (host.includes(":")) {
      const head = host.split(":").find(Boolean) ?? "";
      if (head.startsWith("fc") || head.startsWith("fd") || head.startsWith("fe80")) return true;
    }
    return false;
  }
  const a = Number(ipv4[1]);
  const b = Number(ipv4[2]);
  if ([a, b, Number(ipv4[3]), Number(ipv4[4])].some((n) => n > 255)) return true;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function publicUrl(raw: string): URL {
  if (raw.length > MAX_URL) throw new Error("URL is too long.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That address is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https addresses are allowed.");
  }
  if (blockedHost(url.hostname)) throw new Error("That address is not allowed.");
  return url;
}

async function pull(raw: string, hops = 0, range?: string | null, attempt = 0): Promise<{ response: Response; url: string }> {
  if (hops > MAX_HOPS) throw new Error("Too many redirects.");
  const url = publicUrl(raw);
  const headers: Record<string, string> = {
    accept: "*/*",
    "user-agent": "VLC/3.0.20 LibVLC/3.0.20",
  };
  if (range) headers.range = range;
  const response = await fetch(url, {
    redirect: "manual",
    headers,
  });
  if ((response.status === 429 || response.status === 503) && attempt < 3 && !range) {
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    return pull(raw, hops, range, attempt + 1);
  }
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) return { response, url: url.toString() };
    return pull(new URL(location, url).toString(), hops + 1, range, attempt);
  }
  return { response, url: url.toString() };
}

function absoluteRef(ref: string, base: string): string {
  try {
    return new URL(ref, base).toString();
  } catch {
    return ref;
  }
}

function rewritePlaylist(text: string, base: string, requestUrl = "", proxy = false): string {
  const wrap = (value: string) => {
    const absolute = absoluteRef(value, base);
    if (!proxy) return absolute;
    const next = new URL(requestUrl);
    next.search = "";
    next.searchParams.set("url", absolute);
    next.searchParams.set("engine", "vlc");
    return next.toString();
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/gi, (_match, uri: string) => `URI="${wrap(uri)}"`);
      }
      return wrap(trimmed);
    })
    .join("\n");
}

function headerSet(upstream: Response, type?: string): Headers {
  const headers = new Headers();
  const found = type || upstream.headers.get("content-type");
  if (found) headers.set("content-type", found);
  for (const name of ["content-range", "accept-ranges", "content-length"]) {
    const value = upstream.headers.get(name);
    if (value && !type) headers.set(name, value);
  }
  headers.set("cache-control", "no-store");
  headers.set("access-control-allow-origin", "*");
  return headers;
}

function relay(upstream: Response, body: BodyInit | null, type?: string): Response {
  return new Response(body, { status: upstream.status, headers: headerSet(upstream, type) });
}

function stitch(head: Uint8Array, reader: ReadableStreamDefaultReader<Uint8Array>): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream({
    async pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(head);
        return;
      }
      const next = await reader.read();
      if (next.done) controller.close();
      else if (next.value) controller.enqueue(next.value);
    },
    cancel() {
      void reader.cancel();
    },
  });
}

async function handle({ request }: { request: Request }): Promise<Response> {
  const raw = new URL(request.url).searchParams.get("url") ?? "";
  try {
    if (!raw) return new Response("Missing url.", { status: 400 });
    const proxy = new URL(request.url).searchParams.get("engine") === "vlc";
    const { response, url } = await pull(raw, 0, request.headers.get("range"));
    if (!response.body) return relay(response, null);
    const type = response.headers.get("content-type") ?? "";
    const path = url.split("?")[0] ?? url;
    const videoType = /\.mp4$|\.m4v$/i.test(path)
      ? "video/mp4"
      : /\.webm$/i.test(path)
        ? "video/webm"
        : /\.mov$/i.test(path)
          ? "video/quicktime"
          : /\.mkv$/i.test(path)
            ? "video/x-matroska"
            : "";
    if (videoType) return relay(response, response.body, videoType);
    const maybeList = /mpegurl|m3u8|octet-stream|text\/plain/i.test(type) || /\.(m3u8|ts)$/i.test(path);
    if (!maybeList) return relay(response, response.body);
    const reader = response.body.getReader();
    const first = await reader.read();
    if (first.done || !first.value?.length) return relay(response, null);
    const head = first.value;
    if (head[0] === 0x47) return relay(response, stitch(head, reader), "video/mp2t");
    const preview = new TextDecoder().decode(head.slice(0, 120));
    if (!preview.includes("#EXTM3U") && !preview.includes("#EXTINF")) {
      return relay(response, stitch(head, reader));
    }
    const chunks = [head];
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value) chunks.push(next.value);
    }
    const all = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      all.set(chunk, offset);
      offset += chunk.length;
    }
    const text = new TextDecoder().decode(all);
    return relay(response, rewritePlaylist(text, url, request.url, proxy), "application/vnd.apple.mpegurl");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not fetch that address.";
    return new Response(message, { status: 400, headers: { "content-type": "text/plain" } });
  }
}

export const Route = createFileRoute("/api/media")({
  server: { handlers: { GET: handle } },
});
