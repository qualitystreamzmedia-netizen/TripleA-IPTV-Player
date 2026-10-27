import { previewAsset } from "@/lib/preview-path-prefix";

export type StreamKind = "hls" | "ts" | "file";

function proxied(target: string): string {
  if (target.includes("/api/media?url=")) return target;
  return `${previewAsset("/api/media")}?url=${encodeURIComponent(target)}`;
}

function resolve(line: string, base: string): string {
  try {
    return new URL(line, base).toString();
  } catch {
    return line;
  }
}

export async function sniffStream(target: string): Promise<{ kind: StreamKind; playUrl: string }> {
  const named = /\.(mp4|m4v|webm|ogg|mov)(\?|$)/i.test(target)
    ? "file"
    : /\.(ts|mts|m2ts)(\?|$)/i.test(target)
      ? "ts"
      : /\.m3u8(\?|$)/i.test(target)
        ? "hls"
        : "";
  try {
    const response = await fetch(proxied(target), { headers: { Range: "bytes=0-8191" } });
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (size < 8192) {
        const next = await reader.read();
        if (next.done) break;
        chunks.push(next.value);
        size += next.value.length;
      }
      await reader.cancel().catch(() => undefined);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if (bytes[0] === 0x47) return { kind: "ts", playUrl: target };
    const text = new TextDecoder().decode(bytes);
    const type = response.headers.get("content-type") ?? "";
    if (text.includes("#EXTM3U") || /mpegurl/i.test(type)) {
      const media = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith("#"));
      const standard = /#EXTINF|#EXT-X-STREAM-INF|#EXT-X-TARGETDURATION/i.test(text);
      if (!standard && media) {
        const playUrl = resolve(media, target);
        return { kind: /\.m3u8(\?|$)/i.test(playUrl) ? "hls" : "ts", playUrl };
      }
      return { kind: "hls", playUrl: target };
    }
    if (named === "file") return { kind: "file", playUrl: target };
  } catch {
    /* Use the address itself. */
  }
  if (named) return { kind: named, playUrl: target };
  return { kind: "ts", playUrl: target };
}
