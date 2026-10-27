import { previewAsset } from "@/lib/preview-path-prefix";

export function vlcReady(): boolean {
  return typeof window !== "undefined" && window.crossOriginIsolated;
}

export function vlcMediaUrl(target: string): string {
  if (target.includes("/api/media?url=")) {
    return target.includes("engine=vlc") ? target : `${target}${target.includes("?") ? "&" : "?"}engine=vlc`;
  }
  return `${previewAsset("/api/media")}?url=${encodeURIComponent(target)}&engine=vlc`;
}

type Engine = import("libvlc-wasm").VLC;

let shared: Promise<Engine> | null = null;

export function sharedVlc(): Promise<Engine> {
  if (!shared) {
    shared = import("libvlc-wasm").then((mod) =>
      mod.createVLC({
        threads: 6,
        logLevel: "error",
        args: ["--no-lua"],
      }),
    );
  }
  return shared;
}
