import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { LoaderCallbacks, LoaderConfiguration, LoaderContext } from "hls.js";
import { Maximize2, Minimize2, Pause, PictureInPicture2, Play, SkipBack, SkipForward, Undo2, Volume2, VolumeX, X } from "lucide-react";
import { previewAsset } from "@/lib/preview-path-prefix";
import { deleteClip, listClips, readClip, saveClip, type SavedClip } from "@/lib/recordings";
import { sniffStream } from "@/lib/stream-kind";
import { sharedVlc, vlcMediaUrl } from "@/lib/vlc-engine";
import type { Player as VlcPlayer } from "libvlc-wasm";

type Status = "loading" | "playing" | "error" | "tap";
type Driver = "vlc" | "hls" | "mpegts" | "browser";

const DRIVERS: Driver[] = ["vlc", "hls", "mpegts", "browser"];

function driverLabel(driver: Driver): string {
  if (driver === "vlc") return "VLC";
  if (driver === "hls") return "HLS";
  if (driver === "mpegts") return "TS";
  return "Web";
}

const VOLUME_KEY = "triplea-iptv-v1-volume";
const PLAYER_KEY = "triplea-iptv-v1-channel-players";

function onAndroid(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

function safePlayback(): boolean {
  return typeof window !== "undefined" && /(?:\?|&)safe=1(?:&|$)/.test(window.location.search);
}

function preferredDriver(driver: Driver): Driver {
  return driver;
}

function isDriver(value: unknown): value is Driver {
  return value === "vlc" || value === "hls" || value === "mpegts" || value === "browser";
}

function playerMap(): Record<string, Driver> {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLAYER_KEY) || "{}") as Record<string, unknown>;
    const saved: Record<string, Driver> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isDriver(value)) saved[key] = value;
    }
    return saved;
  } catch {
    return {};
  }
}

function startingDriver(url: string, preferred: Driver, vod = false): Driver {
  if (safePlayback() && preferred === "browser") return "browser";
  const prefer = preferredDriver(preferred);
  if (!vod) {
    const saved = playerMap()[url];
    if (saved) return saved;
  }
  return prefer;
}

function rememberPlayer(url: string, driver: Driver) {
  if (!url) return;
  try {
    const saved = playerMap();
    if (saved[url] === driver) return;
    saved[url] = driver;
    const keys = Object.keys(saved);
    while (keys.length > 400) {
      const oldest = keys.shift();
      if (oldest) delete saved[oldest];
    }
    localStorage.setItem(PLAYER_KEY, JSON.stringify(saved));
  } catch {
    /* the browser kept the choice for this visit */
  }
}

function loadVolume(): number {
  try {
    const value = Number(localStorage.getItem(VOLUME_KEY));
    if (Number.isFinite(value) && value >= 0 && value <= 100) return value;
  } catch {
    /* keep the default */
  }
  return 80;
}

let rememberedVolume = loadVolume();
let lastAudible = rememberedVolume > 0 ? rememberedVolume : 80;

export function currentVolume(): number {
  return rememberedVolume;
}

export function publishVolume(next: number) {
  const value = Math.min(100, Math.max(0, Math.round(next)));
  rememberedVolume = value;
  if (value > 0) lastAudible = value;
  try {
    localStorage.setItem(VOLUME_KEY, String(value));
  } catch {
    /* the browser kept the in-session volume */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("triplea-volume", { detail: value }));
  }
}

export function LiveStamp({ className }: { className?: string }) {
  const [text, setText] = useState("--:--:--");
  useEffect(() => {
    const tick = () => {
      const date = new Date();
      const pad = (value: number) => String(value).padStart(2, "0");
      setText(`${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className={className}>{text}</span>;
}

export function toggleSharedMute() {
  publishVolume(rememberedVolume === 0 ? lastAudible : 0);
}

function mediaUrl(target: string): string {
  if (target.includes("/api/media?url=")) return target;
  return `${previewAsset("/api/media")}?url=${encodeURIComponent(target)}`;
}

type NativePicture = {
  open: (direct: string, proxied: string, mode: string) => void;
  close: () => void;
  place: (left: number, top: number, width: number, height: number, cssW: number, cssH: number) => void;
  volume: (value: number) => void;
  play: () => void;
  pause: () => void;
};

function nativePicture(): NativePicture | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { TripleANative?: NativePicture }).TripleANative;
  if (!bridge || typeof bridge.open !== "function") return null;
  return bridge;
}

function playableAddresses(target: string): string[] {
  const list = [target];
  if (/\.m3u8(?=($|\?|#))/i.test(target)) list.push(target.replace(/\.m3u8/i, ".ts"));
  else if (/\.ts(?=($|\?|#))/i.test(target)) list.push(target.replace(/\.ts/i, ".m3u8"));
  return list;
}

function webCanOpen(target: string): boolean {
  return /\.(mp4|m4v|webm|ogg)(?=($|\?|#))/i.test(target);
}

function nativeKind(driver: Driver, vod: boolean): string {
  if (vod) return "vod";
  if (driver === "mpegts") return "ts";
  if (driver === "hls") return "hls";
  return "vlc";
}

export function PreviewPlayer({
  url,
  title,
  onPrevious,
  onNext,
  onRecall,
  onClose,
  onPin,
  pinned = false,
  floatIndex,
  detached = false,
  audible = true,
  ownVolume = false,
  initialVolume,
  onVolume,
  timeline = false,
  vlc = true,
  player = "mpegts",
}: {
  url: string;
  title: string;
  onPrevious?: () => void;
  onNext?: () => void;
  onRecall?: () => void;
  onClose?: () => void;
  onPin?: () => void;
  pinned?: boolean;
  floatIndex?: number;
  /** Fills a separate window. Own volume, no in-page drag frame. */
  detached?: boolean;
  /** False mutes this window. Multi-view windows stay audible and use their own slider. */
  audible?: boolean;
  /** This window keeps a slider that does not change the others. */
  ownVolume?: boolean;
  /** Volume to start from, usually the parent window's level. */
  initialVolume?: number;
  onVolume?: (value: number) => void;
  timeline?: boolean;
  vlc?: boolean;
  player?: Driver;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vlcRef = useRef<VlcPlayer | null>(null);
  const [driver, setDriver] = useState<Driver>(() => startingDriver(url, player, timeline));
  const [nativeBlocked, setNativeBlocked] = useState(false);
  const engine = driver === "vlc" ? "vlc" : "internal";
  const urlRef = useRef(url);
  const playerRef = useRef(player);
  if (urlRef.current !== url || playerRef.current !== player) {
    const urlChanged = urlRef.current !== url;
    urlRef.current = url;
    const chosen = playerRef.current !== player;
    playerRef.current = player;
    const next = preferredDriver(chosen && !urlChanged ? player : startingDriver(url, player, timeline));
    if (driver !== next) setDriver(next);
  }
  const boxRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef(initialVolume ?? loadVolume());
  const [volume, setVolume] = useState(volumeRef.current);
  const onVolumeRef = useRef(onVolume);
  onVolumeRef.current = onVolume;
  const [status, setStatus] = useState<Status>("loading");
  const [mode, setMode] = useState<"normal" | "pip" | "full">("normal");
  const [paused, setPaused] = useState(true);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [behind, setBehind] = useState(0);
  const [recording, setRecording] = useState(false);
  const [clips, setClips] = useState<SavedClip[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [clipUrl, setClipUrl] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const hlsRef = useRef<{ startLoad: (position?: number) => void } | null>(null);
  const floating = floatIndex !== undefined || mode === "pip";
  const ownAudio = floating || detached || ownVolume || !audible;
  const skipNative = floating || ownVolume || !audible;
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  const [pipWidth, setPipWidth] = useState(288);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const dragOrigin = useRef({ x: 0, y: 0 });
  const moved = useRef(false);
  const clickTimer = useRef<number | null>(null);
  const resize = useRef<{ x: number; width: number } | null>(null);
  const scrubbing = useRef(false);
  const wanted = useRef<number | null>(null);
  const seekTries = useRef(0);
  const seekTimer = useRef<number | null>(null);
  const hold = useRef(false);
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;

  useEffect(() => {
    function apply(value: number) {
      const next = Math.min(100, Math.max(0, Math.round(value)));
      volumeRef.current = next;
      setVolume(next);
      const vlc = vlcRef.current;
      if (vlc) {
        vlc.volume = next / 100;
        vlc.muted = next === 0;
      }
      const video = ref.current;
      if (video) {
        video.volume = next / 100;
        video.muted = next === 0;
      }
      if (!ownAudio) nativePicture()?.volume(next);
      onVolumeRef.current?.(next);
    }
    if (ownAudio) {
      apply(volumeRef.current);
      return;
    }
    apply(rememberedVolume);
    function onVolume(event: Event) {
      apply((event as CustomEvent<number>).detail);
    }
    window.addEventListener("triplea-volume", onVolume);
    return () => window.removeEventListener("triplea-volume", onVolume);
  }, [ownAudio]);

  function changeVolume(next: number) {
    if (ownAudio) {
      const value = Math.min(100, Math.max(0, Math.round(next)));
      volumeRef.current = value;
      setVolume(value);
      const vlc = vlcRef.current;
      if (vlc) {
        vlc.volume = value / 100;
        vlc.muted = value === 0;
      }
      const video = ref.current;
      if (video) {
        video.volume = value / 100;
        video.muted = value === 0;
      }
      onVolumeRef.current?.(value);
      return;
    }
    publishVolume(next);
  }

  function toggleOwnVolume() {
    if (ownAudio) changeVolume(volumeRef.current === 0 ? 80 : 0);
    else toggleSharedMute();
  }

  function play() {
    hold.current = false;
    const vlc = vlcRef.current;
    if (vlc) {
      vlc.volume = volumeRef.current / 100;
      vlc.muted = volumeRef.current === 0;
      void vlc.play().then(
        () => setStatus("playing"),
        () => setStatus("error"),
      );
      return;
    }
    if (!skipNative && onAndroid() && driver !== "browser" && !nativeBlocked) {
      const native = nativePicture();
      if (native) {
        native.volume(volumeRef.current);
        native.play();
        setPaused(false);
        setStatus("playing");
        return;
      }
    }
    const video = ref.current;
    if (!video) return;
    hold.current = false;
    video.volume = volumeRef.current / 100;
    video.muted = volumeRef.current === 0;
    void video.play().then(
      () => setStatus("playing"),
      () => setStatus("error"),
    );
  }

  function pause() {
    hold.current = true;
    const vlc = vlcRef.current;
    if (vlc) {
      void vlc.pause();
      setPaused(true);
      return;
    }
    if (!skipNative && onAndroid() && driver !== "browser" && !nativeBlocked && nativePicture()) {
      nativePicture()?.pause();
      setPaused(true);
      return;
    }
    ref.current?.pause();
    setPaused(true);
  }

  function bufferRange(): { start: number; end: number } | null {
    const video = ref.current;
    if (!video || video.buffered.length === 0) return null;
    return {
      start: video.buffered.start(0),
      end: video.buffered.end(video.buffered.length - 1),
    };
  }

  function nudge(seconds: number) {
    const video = ref.current;
    const range = bufferRange();
    if (!video || !range) return;
    const next = Math.min(range.end - 1, Math.max(range.start, (video.currentTime || 0) + seconds));
    video.currentTime = next;
    setBehind(Math.max(0, range.end - next));
    if (video.paused) play();
  }

  function goLive() {
    const video = ref.current;
    hold.current = false;
    hlsRef.current?.startLoad(-1);
    const range = bufferRange();
    if (video && range) video.currentTime = Math.max(range.start, range.end - 1);
    setBehind(0);
    play();
  }

  async function refreshClips() {
    try {
      setClips(await listClips());
    } catch {
      setClips([]);
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setRecording(false);
  }

  function startRecording() {
    stopRecording();
    const started = Date.now();
    const label = title || "Recording";
    const video = ref.current;
    const canvas = canvasRef.current;
    const source = (engine === "vlc" ? canvas : video) as { captureStream?: (rate?: number) => MediaStream } | null;
    const stream = source?.captureStream?.(engine === "vlc" ? 25 : undefined);
    if (!stream) return;
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
      ? "video/webm;codecs=vp8,opus"
      : "video/webm";
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: mime });
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime });
      if (blob.size < 1) return;
      void saveClip(`${label} ${new Date(started).toLocaleString()}`, blob).then(() => refreshClips());
    };
    recorderRef.current = recorder;
    recorder.start(1000);
    setRecording(true);
  }

  useEffect(() => {
    if (timeline || floating) return;
    const id = window.setInterval(() => {
      const range = bufferRange();
      const video = ref.current;
      if (!range || !video) {
        setBehind(0);
        return;
      }
      setBehind(Math.max(0, range.end - (video.currentTime || 0)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [timeline, floating, url]);

  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && recorder.state !== "inactive") recorder.stop();
    };
  }, [url]);

  function seek(value: number) {
    const vlc = vlcRef.current;
    if (vlc) {
      wanted.current = value;
      scrubbing.current = true;
      setPosition(value);
      void vlc.seek(value).finally(() => {
        scrubbing.current = false;
      });
      return;
    }
    const video = ref.current;
    if (!video || !Number.isFinite(value)) return;
    wanted.current = value;
    scrubbing.current = true;
    seekTries.current = 0;
    setPosition(value);
    const place = () => {
      const node = ref.current;
      if (!node || wanted.current !== value) return;
      if (Math.abs((node.currentTime || 0) - value) > 1) node.currentTime = value;
    };
    place();
    window.setTimeout(place, 350);
  }

  function previewSeek(value: number) {
    wanted.current = value;
    scrubbing.current = true;
    setPosition(value);
    if (seekTimer.current) window.clearTimeout(seekTimer.current);
    seekTimer.current = window.setTimeout(() => seek(value), 180);
  }

  async function closeScreen() {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    if (document.pictureInPictureElement) await document.exitPictureInPicture().catch(() => undefined);
    setMode("normal");
    pause();
    onClose?.();
  }

  async function togglePip() {
    if (onPin) {
      onPin();
      return;
    }
    const video = ref.current;
    if (!video && !vlcRef.current) return;
    if (video && (mode === "pip" || document.pictureInPictureElement === video)) {
      if (document.pictureInPictureElement) await document.exitPictureInPicture().catch(() => undefined);
      setMode("normal");
      return;
    }
    if (video && document.pictureInPictureEnabled) {
      try {
        await video.requestPictureInPicture();
        return;
      } catch {
        /* The preview frame blocks the browser window, so float the player instead. */
      }
    }
    setMode("pip");
  }

  async function toggleFull() {
    const box = boxRef.current;
    if (mode === "full" || document.fullscreenElement) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      setMode("normal");
      return;
    }
    setMode("full");
    try {
      await box?.requestFullscreen();
    } catch {
      /* In-page full screen is already on. */
    }
  }

  useEffect(() => {
    if (driver !== "vlc") return;
    if (!skipNative && onAndroid() && nativePicture()) return;
    const forcedOff =
      typeof window !== "undefined" && new URLSearchParams(window.location.search).get("engine") === "internal";
    if (forcedOff) {
      try {
        localStorage.setItem("triplea-iptv-v1-vlc", "0");
      } catch {
        /* the browser blocked storage */
      }
      setDriver("hls");
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    let dead = false;
    let player: VlcPlayer | null = null;
    let opened = false;
    setStatus("loading");
    setPosition(0);
    setDuration(0);
    function handOff() {
      if (dead || opened) return;
      dead = true;
      vlcRef.current = null;
      void player?.destroy();
      setStatus("error");
    }
    void (async () => {
      try {
        const vlc = await sharedVlc();
        if (dead) return;
        player = await vlc.createPlayer({ canvas, fit: "cover", keepAwake: false });
        if (dead) {
          await player.destroy();
          return;
        }
        vlcRef.current = player;
        player.volume = volumeRef.current / 100;
        player.muted = volumeRef.current === 0;
        const markOpen = () => {
          opened = true;
        };
        player.on("playing", () => {
          markOpen();
          const context = player?.audioContext;
          if (context?.state === "suspended") void context.resume();
          const audio = player?.tracks.filter((track) => track.type === "audio") ?? [];
          if (audio.length && !audio.some((track) => track.selected)) {
            const best = [...audio].sort((a, b) => (b.channels ?? 0) - (a.channels ?? 0))[0];
            if (best) void player?.selectTrack(best);
          }
          if (!dead) {
            setStatus("playing");
            setPaused(false);
          }
        });
        player.on("paused", () => {
          if (!dead) setPaused(true);
        });
        const addresses = playableAddresses(url).flatMap((target) => [vlcMediaUrl(target), target]);
        let address = 0;
        player.on("error", () => {
          if (opened || dead) return;
          if (address < addresses.length) return;
          handOff();
        });
        player.on("timeupdate", (time) => {
          if (time > 0) markOpen();
          if (dead || scrubbing.current || !timelineRef.current) return;
          setPosition(time);
          if (player && player.duration > 0) setDuration(player.duration);
        });
        player.on("durationchange", (length) => {
          if (!dead && timelineRef.current && length > 0) setDuration(length);
        });
        for (const target of addresses) {
          if (dead || opened) break;
          address += 1;
          try {
            await player.open(target, {
              autoplay: true,
              options: [":network-caching=3000", ":live-caching=3000", ":http-reconnect=true", ":no-spu"],
            });
          } catch {
            continue;
          }
          if (dead || opened || player.state !== "error") break;
        }
        if (dead) return;
        if (!opened && player.state === "error") handOff();
      } catch {
        handOff();
      }
    })();
    return () => {
      dead = true;
      vlcRef.current = null;
      void player?.destroy();
    };
  }, [driver, url, skipNative]);

  useEffect(() => {
    if (driver === "vlc") return;
    if (!skipNative && onAndroid() && driver !== "browser" && !nativeBlocked && nativePicture()) return;
    const video = ref.current;
    if (!video) return;
    let dead = false;
    let hls: {
      destroy: () => void;
      startLoad: (startPosition?: number) => void;
      stopLoad: () => void;
      loadSource: (source: string) => void;
      recoverMediaError: () => void;
    } | null = null;
    let transport: { destroy: () => void } | null = null;
    let fellBack = false;
    let started = false;
    setStatus("loading");
    setPosition(0);
    setDuration(0);

    const onPlaying = () => {
      started = true;
      video.volume = volumeRef.current / 100;
      video.muted = volumeRef.current === 0;
      if (!dead) {
        setStatus("playing");
        setPaused(false);
      }
    };
    const onPause = () => {
      if (!dead) setPaused(true);
    };
    let lastEnded = 0;
    let endedBurst = 0;
    const keepGoing = () => {
      if (dead || timelineRef.current || hold.current) return;
      const now = Date.now();
      if (now - lastEnded < 4000) endedBurst += 1;
      else endedBurst = 0;
      lastEnded = now;
      if (endedBurst > 2) {
        setStatus("error");
        return;
      }
      if (hls) hls.startLoad();
      void video.play().catch(() => undefined);
    };
    const start = () => {
      video.volume = volumeRef.current / 100;
      video.muted = volumeRef.current === 0;
      video.play().then(
        () => {
          if (!dead) setStatus("playing");
        },
        () => {
          if (!dead) setStatus("tap");
        },
      );
    };
    const onTime = () => {
      if (dead || !timelineRef.current) return;
      const length = video.duration;
      if (Number.isFinite(length) && length > 0) setDuration(length);
      const pending = wanted.current;
      if (pending != null) {
        if (Math.abs((video.currentTime || 0) - pending) < 1.5) {
          wanted.current = null;
          scrubbing.current = false;
          setPosition(video.currentTime || 0);
        } else if (!video.seeking && pending > 5 && (video.currentTime || 0) + 2 < pending && seekTries.current < 5) {
          seekTries.current += 1;
          video.currentTime = pending;
        }
        return;
      }
      if (scrubbing.current || video.seeking) return;
      setPosition(video.currentTime || 0);
    };

    video.volume = volumeRef.current / 100;
    video.muted = volumeRef.current === 0;
    video.addEventListener("playing", onPlaying);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", keepGoing);
    const onSeeked = () => {
      scrubbing.current = false;
    };
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("durationchange", onTime);
    const hideCaptions = () => {
      const tracks = video.textTracks;
      for (let i = 0; i < tracks.length; i += 1) tracks[i].mode = "disabled";
    };
    hideCaptions();
    video.textTracks.addEventListener("addtrack", hideCaptions);
    video.addEventListener("seeked", onSeeked);

    let lastTime = 0;
    let lastMove = Date.now();
    let reloads = 0;
    let openTransport: (playUrl: string) => Promise<void> = async () => undefined;
    const restartLive = () => {
      if (dead || timelineRef.current) return;
      if (reloads > 5) {
        setStatus("error");
        return;
      }
      reloads += 1;
      lastMove = Date.now();
      if (hls) {
        hls.stopLoad();
        hls.startLoad();
        void video.play().catch(() => undefined);
        return;
      }
      if (transport) {
        transport.destroy();
        transport = null;
        fellBack = false;
        started = false;
        void openTransport(url);
        return;
      }
      video.src = mediaUrl(url);
      void video.play().catch(() => undefined);
    };
    const watch = window.setInterval(() => {
      if (dead || hold.current || video.seeking || timelineRef.current) return;
      const time = video.currentTime || 0;
      if (time + 0.2 < lastTime) lastTime = time;
      if (time > lastTime + 0.15) {
        lastTime = time;
        lastMove = Date.now();
        return;
      }
      if (Date.now() - lastMove < 12000) return;
      restartLive();
    }, 2000);

    (async () => {
      openTransport = async (playUrl: string) => {
        if (dead || fellBack || started) return;
        fellBack = true;
        hls?.destroy();
        hls = null;
        const loaded = (await import("../../vendor/mpegts-entry.js")) as unknown as {
          default?: {
            isSupported: () => boolean;
            createPlayer: (
              source: { type: string; isLive: boolean; url: string },
              config: Record<string, unknown>,
            ) => { attachMediaElement: (node: HTMLVideoElement) => void; load: () => void; destroy: () => void; on: (name: string, fn: () => void) => void };
            Events: { ERROR: string };
          };
        };
        const mpegts = loaded.default;
        if (!mpegts?.isSupported()) {
          if (!dead) setStatus("error");
          return;
        }
        video.removeAttribute("src");
        const player = mpegts.createPlayer(
          { type: "mpegts", isLive: !timelineRef.current, url: mediaUrl(playUrl) },
          {
            enableWorker: false,
            liveBufferLatencyChasing: false,
            liveBufferLatencyMaxLatency: 300,
            stashInitialSize: 128,
          },
        );
        transport = player;
        player.on(mpegts.Events.ERROR, () => {
          if (dead) return;
          if (reloads <= 5) restartLive();
          else setStatus("error");
        });
        player.attachMediaElement(video);
        player.load();
        start();
      };
      if (driver === "browser") {
        if (onAndroid() && !webCanOpen(url)) {
          if (!dead) setStatus("error");
          return;
        }
        video.src = timelineRef.current && /^https?:\/\//i.test(url) ? url : mediaUrl(url);
        const fail = () => {
          if (!dead) setStatus("error");
        };
        video.addEventListener("error", fail, { once: true });
        video.addEventListener("loadeddata", start, { once: true });
        void video.play().catch(() => undefined);
        return;
      }
      if (driver === "mpegts") {
        const direct = playableAddresses(url).find((item) => /\.ts(?=($|\?|#))/i.test(item)) ?? url;
        await openTransport(direct);
        return;
      }
      const sniffed = await sniffStream(url);
      if (dead) return;
      if (sniffed.kind === "ts") {
        if (!dead) setStatus("error");
        return;
      }
      const hlsUrl = sniffed.kind === "hls";
      if (hlsUrl) {
        const { default: Hls } = await import("hls.js");
        if (dead) return;
        if (Hls.isSupported()) {
          const BaseLoader = Hls.DefaultConfig.loader;
          class ProxyLoader extends BaseLoader {
            load(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>) {
              if (context?.url && !context.url.includes("/api/media?url=")) context.url = mediaUrl(context.url);
              super.load(context, config, callbacks);
            }
          }
          const player = new Hls({
            enableWorker: false,
            lowLatencyMode: false,
            capLevelToPlayerSize: false,
            maxBufferLength: 60,
            maxMaxBufferLength: 120,
            backBufferLength: 300,
            maxBufferHole: 0.5,
            nudgeMaxRetry: 2,
            liveSyncDurationCount: 6,
            liveMaxLatencyDurationCount: 24,
            maxLiveSyncPlaybackRate: 1,
            liveDurationInfinity: !timelineRef.current,
            enableCEA708Captions: false,
            enableWebVTT: false,
            renderTextTracksNatively: false,
            manifestLoadingTimeOut: 20000,
            manifestLoadingMaxRetry: 6,
            levelLoadingTimeOut: 20000,
            levelLoadingMaxRetry: 8,
            fragLoadingTimeOut: 30000,
            fragLoadingMaxRetry: 8,
            loader: ProxyLoader,
          });
          hls = player;
          hlsRef.current = player;
          let hlsFaults = 0;
          player.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal || dead) return;
            hlsFaults += 1;
            if (hlsFaults > 4) {
              setStatus("error");
              return;
            }
            const details = String(data.details);
            const parsing = details.includes("manifest") || details.includes("Parsing") || details.includes("incompatible");
            if (!started && !fellBack && parsing) {
              if (!dead) setStatus("error");
              return;
            }
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) player.recoverMediaError();
            else player.startLoad();
            void video.play().catch(() => undefined);
          });
          player.on(Hls.Events.MANIFEST_PARSED, () => start());
          player.loadSource(mediaUrl(sniffed.playUrl || url));
          player.attachMedia(video);
          return;
        }
      }
      if (dead) return;
      video.src = mediaUrl(url);
      video.addEventListener("loadeddata", start, { once: true });
      video.addEventListener("error", () => {
        if (!dead) setStatus("error");
      }, { once: true });
    })().catch(() => {
      if (!dead) setStatus("error");
    });

    const giveUp = timelineRef.current
      ? window.setTimeout(() => {
          if (!dead && !started) setStatus("error");
        }, 8000)
      : 0;

    return () => {
      dead = true;
      if (giveUp) window.clearTimeout(giveUp);
      window.clearInterval(watch);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", keepGoing);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("durationchange", onTime);
      video.removeEventListener("seeked", onSeeked);
      video.textTracks.removeEventListener("addtrack", hideCaptions);
      hls?.destroy();
      hlsRef.current = null;
      transport?.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [driver, url, floating, nativeBlocked, skipNative]);

  useEffect(() => {
    const bridge = nativePicture();
    if (skipNative || !bridge || nativeBlocked || !onAndroid() || driver === "browser") return;
    let dead = false;
    let playing = false;
    setStatus("loading");
    setPaused(false);
    const place = () => {
      const node = boxRef.current;
      if (!node || dead) return;
      const rect = node.getBoundingClientRect();
      const top = 28;
      const right = 52;
      const bottom = 44;
      bridge.place(rect.left, rect.top + top, Math.max(1, rect.width - right), Math.max(1, rect.height - top - bottom), window.innerWidth, window.innerHeight);
    };
    const nativeWindow = window as unknown as {
      __tripleaNative?: (state: string) => void;
      __tripleaNativeToggle?: () => void;
    };
    nativeWindow.__tripleaNative = (state) => {
      if (dead) return;
      if (state === "playing") {
        playing = true;
        setStatus("playing");
        setPaused(false);
      } else if (state === "web" || state === "error") {
        playing = false;
        setStatus("error");
      }
    };
    nativeWindow.__tripleaNativeToggle = () => {
      if (dead) return;
      if (playing) {
        bridge.pause();
        playing = false;
        setPaused(true);
      } else {
        bridge.play();
        playing = true;
        setPaused(false);
      }
    };
    bridge.open(url, mediaUrl(url), nativeKind(driver, timeline));
    bridge.volume(volumeRef.current);
    place();
    const id = window.setInterval(place, 500);
    window.addEventListener("resize", place);
    return () => {
      dead = true;
      window.clearInterval(id);
      window.removeEventListener("resize", place);
      if (nativeWindow.__tripleaNative) delete nativeWindow.__tripleaNative;
      if (nativeWindow.__tripleaNativeToggle) delete nativeWindow.__tripleaNativeToggle;
      bridge.close();
    };
  }, [url, floating, timeline, nativeBlocked, driver, skipNative]);

  useEffect(() => {
    if (status !== "error" || safePlayback() || onAndroid()) return;
    const order = [player, ...DRIVERS.filter((item) => item !== player && (vlc || item !== "vlc"))];
    const next = order[order.indexOf(driver) + 1];
    if (!next) return;
    const timer = window.setTimeout(() => {
      setStatus("loading");
      setDriver(next);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [status, driver, url, vlc, player]);

  useEffect(() => {
    if (status !== "playing") return;
    const timer = window.setTimeout(() => rememberPlayer(url, driver), 2000);
    return () => window.clearTimeout(timer);
  }, [status, url, driver]);

  useEffect(() => {
    function onFull() {
      if (!document.fullscreenElement) setMode((current) => (current === "full" ? "normal" : current));
    }
    function onLeavePip() {
      setMode((current) => (current === "pip" ? "normal" : current));
    }
    document.addEventListener("fullscreenchange", onFull);
    document.addEventListener("leavepictureinpicture", onLeavePip);
    return () => {
      document.removeEventListener("fullscreenchange", onFull);
      document.removeEventListener("leavepictureinpicture", onLeavePip);
    };
  }, []);

  useEffect(() => {
    function onPlay() {
      if (floating) return;
      if (!boxRef.current || boxRef.current.getClientRects().length === 0) return;
      if (paused || status !== "playing") play();
      else pause();
    }
    function onBack(event: Event) {
      if (!boxRef.current || boxRef.current.getClientRects().length === 0) return;
      if (libraryOpen) {
        setLibraryOpen(false);
        setClipUrl("");
        event.preventDefault();
        return;
      }
      if (mode !== "normal") {
        setMode("normal");
        event.preventDefault();
      }
    }
    function onSelect() {
      if (floating) return;
      if (!boxRef.current || boxRef.current.getClientRects().length === 0) return;
      if (mode === "full") setMode("normal");
      else setMode("full");
    }
    window.addEventListener("triplea-play", onPlay);
    window.addEventListener("triplea-back", onBack);
    window.addEventListener("triplea-select", onSelect);
    return () => {
      window.removeEventListener("triplea-play", onPlay);
      window.removeEventListener("triplea-back", onBack);
      window.removeEventListener("triplea-select", onSelect);
    };
  }, [floating, libraryOpen, mode, paused, status]);

  useEffect(() => {
    if (floatIndex === undefined && mode !== "pip") return;
    const width = 288;
    const index = floatIndex ?? 0;
    const gap = 12;
    const columns = Math.max(1, Math.floor((window.innerWidth - 24) / (width + gap)));
    const column = index % columns;
    const row = Math.floor(index / columns);
    setSpot({
      x: Math.max(8, window.innerWidth - width - 12 - column * (width + gap)),
      y: 64 + row * 180,
    });
  }, [floatIndex, mode]);

  function onDragStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (!spot) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, label, select")) return;
    moved.current = false;
    dragOrigin.current = { x: event.clientX, y: event.clientY };
    drag.current = { dx: event.clientX - spot.x, dy: event.clientY - spot.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onDragMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    if (Math.abs(event.clientX - dragOrigin.current.x) > 4 || Math.abs(event.clientY - dragOrigin.current.y) > 4) {
      moved.current = true;
    }
    const width = boxRef.current?.offsetWidth ?? 288;
    const height = boxRef.current?.offsetHeight ?? 160;
    setSpot({
      x: Math.min(Math.max(0, window.innerWidth - width), Math.max(0, event.clientX - drag.current.dx)),
      y: Math.min(Math.max(0, window.innerHeight - height), Math.max(0, event.clientY - drag.current.dy)),
    });
  }

  function onDragEnd() {
    drag.current = null;
  }

  function onResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    resize.current = { x: event.clientX, width: pipWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onResizeMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!resize.current) return;
    const next = resize.current.width + (event.clientX - resize.current.x);
    setPipWidth(Math.min(Math.round(window.innerWidth * 0.85), Math.max(200, Math.round(next))));
  }

  function onResizeEnd() {
    resize.current = null;
  }

  function onSurfaceClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, a, label, select")) return;
    if (moved.current) {
      moved.current = false;
      return;
    }
    if (clickTimer.current) window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null;
      if (paused || status !== "playing") play();
      else pause();
    }, 220);
  }

  function onSurfaceDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, a, label, select")) return;
    if (clickTimer.current) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    void toggleFull();
  }

  const frame = floating
    ? "stage-dark fixed z-[70] cursor-grab touch-none overflow-hidden rounded-ui bg-black shadow-2xl ring-1 ring-accent select-none active:cursor-grabbing"
    : mode === "full"
      ? "stage-dark fixed inset-0 z-50 bg-black"
      : "cinema-screen stage-dark relative h-full min-h-0 overflow-hidden bg-black";

  const iconButton = "flex size-7 shrink-0 items-center justify-center text-white";

  return (
    <div
      ref={boxRef}
      className={frame}
      style={
        floating && spot
          ? { left: spot.x, top: spot.y, width: pipWidth, height: Math.max(230, Math.round((pipWidth * 9) / 16)) }
          : undefined
      }
    >
      <div
        className={mode === "full" || floating ? "relative h-full" : "relative h-full min-h-0"}
        onPointerDown={floating ? onDragStart : undefined}
        onPointerMove={floating ? onDragMove : undefined}
        onPointerUp={floating ? onDragEnd : undefined}
        onClick={onSurfaceClick}
        onDoubleClick={onSurfaceDoubleClick}
      >
      {floatIndex !== undefined || detached ? (
        <p className="pointer-events-none absolute top-1.5 left-16 z-40 max-w-[55%] truncate text-[11px] text-white">{title}</p>
      ) : null}
      <LiveStamp className="pointer-events-none absolute top-1.5 left-2 z-40 rounded bg-black/75 px-1.5 py-0.5 text-[12px] font-medium text-white tabular-nums" />
      {engine === "vlc" ? (
        <canvas ref={canvasRef} className="pointer-events-none h-full w-full bg-black" aria-label={title} />
      ) : (
      <video
        ref={ref}
        className={
          mode === "full"
            ? "pointer-events-none h-full w-full bg-black object-contain"
            : mode === "pip"
              ? "pointer-events-none aspect-video w-full bg-black object-cover"
            : "pointer-events-none h-full w-full bg-black object-cover"
        }
        autoPlay
        playsInline
        aria-label={title}
      />
      )}
      {engine === "vlc" && floatIndex === undefined ? (
        <p className="pointer-events-none absolute top-8 left-2 z-30 text-[10px] text-fg/80">VLC</p>
      ) : null}
      {floating ? (
        <button
          type="button"
          className="absolute right-0 bottom-0 z-50 size-11 cursor-nwse-resize touch-none"
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          aria-label="Resize picture"
        >
          <span className="absolute right-2 bottom-2 size-3 border-r-[3px] border-b-[3px] border-white" />
        </button>
      ) : null}
      {status !== "playing" ? (
        <div className="pointer-events-none absolute inset-y-0 left-0 right-12 z-10 flex items-end bg-bg/40 p-3 text-left">
          <span className="text-sm text-fg">
            {status === "error"
              ? onAndroid() && driver === "browser"
                ? "Web can't play this channel. Choose TS, HLS, or VLC."
                : "This stream did not start. Try another title."
              : status === "tap"
                ? "Click to play"
                : "Starting…"}
          </span>
        </div>
      ) : null}
      <div
        className={`absolute left-2 z-30 flex h-6 w-[13.5rem] max-w-[46%] items-center gap-1 rounded-full border border-white/70 bg-[#070b16] px-1.5 text-white shadow-lg ${timeline ? "bottom-10" : "bottom-1.5"}`}
        data-zone="volume"
        data-flow="row"
        onClick={(event) => event.stopPropagation()}
      >
          <button
            type="button"
            className="flex size-5 shrink-0 items-center justify-center text-white"
            aria-label={volume === 0 ? "Unmute" : "Mute"}
            onClick={(event) => {
              event.stopPropagation();
              toggleOwnVolume();
            }}
          >
            {volume === 0 ? <VolumeX className="size-3" /> : <Volume2 className="size-3" />}
          </button>
          <label className="flex min-w-0 flex-1 items-center">
            <span className="sr-only">Volume {volume}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              aria-label="Volume"
              className="volume-bar w-full"
              onChange={(event) => changeVolume(Number(event.target.value))}
              onClick={(event) => event.stopPropagation()}
            />
          </label>
        </div>
      {timeline ? (
        <div className="absolute right-12 bottom-1.5 left-2 z-30 flex items-center gap-2 rounded-full bg-panel/90 px-2">
          <span className="w-10 shrink-0 text-[10px] text-fg tabular-nums">{clock(position)}</span>
          <label className="flex h-7 min-w-0 flex-1 items-center">
            <span className="sr-only">Timeline</span>
            <input
              type="range"
              min={0}
              max={duration > 0 ? duration : 0}
              step={1}
              value={duration > 0 ? Math.min(position, duration) : 0}
              aria-label="Timeline"
              className="w-full accent-accent"
              onPointerDown={() => {
                scrubbing.current = true;
              }}
              onChange={(event) => previewSeek(Number(event.target.value))}
              onKeyUp={(event) => {
                if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") {
                  seek(Number(event.currentTarget.value));
                }
              }}
            />
          </label>
          <span className="w-10 shrink-0 text-right text-[10px] text-fg tabular-nums">{clock(duration)}</span>
        </div>
      ) : null}
      {!timeline ? (
        <div className="absolute right-14 bottom-1.5 z-30 flex h-6 w-[13.5rem] max-w-[46%] items-center justify-between gap-1 rounded-full border border-white/70 bg-[#070b16] px-2 text-[11px] leading-none font-semibold text-white shadow-lg" data-zone="transport" data-flow="row">
          <button type="button" className="px-0.5" onClick={() => nudge(-30)} aria-label="Back 30 seconds">
            −30s
          </button>
          {behind > 4 ? <span className="px-0.5 tabular-nums">−{clock(behind)}</span> : null}
          <button
            type="button"
            className={behind > 4 ? "rounded bg-[#e0232c] px-1 font-semibold text-white" : "px-0.5 font-semibold"}
            onClick={goLive}
            aria-label="Return to live"
          >
            Live
          </button>
          <button type="button" className="px-0.5" onClick={() => nudge(30)} aria-label="Forward 30 seconds">
            +30s
          </button>
          <button
            type="button"
            className="px-0.5"
            aria-pressed={recording}
            aria-label={recording ? "Stop recording" : "Record"}
            onClick={() => (recording ? stopRecording() : startRecording())}
          >
            <span className={recording ? "inline-block size-3 rounded-full bg-[#e0232c] ring-2 ring-[#e0232c]/50" : "inline-block size-2.5 rounded-full bg-[#e0232c]"} />
          </button>
          <button
            type="button"
            className="px-0.5"
            onClick={() => {
              setLibraryOpen(true);
              void refreshClips();
            }}
          >
            Saved
          </button>
        </div>
      ) : null}
      {libraryOpen ? (
        <div className="absolute inset-0 z-40 flex flex-col gap-2 overflow-auto bg-black/85 p-3 text-xs text-fg">
          <div className="flex items-center justify-between">
            <p className="font-semibold">Recordings</p>
            <button type="button" onClick={() => { setLibraryOpen(false); setClipUrl(""); }}>
              Close
            </button>
          </div>
          {clipUrl ? <video src={clipUrl} controls autoPlay className="max-h-40 w-full bg-black" /> : null}
          {clips.length === 0 ? <p className="text-muted">Nothing saved yet. Press the red dot to record.</p> : null}
          <ul className="flex flex-col gap-1">
            {clips.map((clip) => (
              <li key={clip.id} className="flex items-center gap-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => {
                    void readClip(clip.id).then((blob) => {
                      if (!blob) return;
                      const next = URL.createObjectURL(blob);
                      setClipUrl((current) => {
                        if (current) URL.revokeObjectURL(current);
                        return next;
                      });
                    });
                  }}
                >
                  {clip.title}
                </button>
                <button
                  type="button"
                  className="text-muted"
                  onClick={() => {
                    void deleteClip(clip.id).then(() => refreshClips());
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="absolute top-1 right-1 bottom-1 z-40 flex w-11 flex-col items-center gap-0.5 overflow-y-auto rounded-lg border border-white/80 bg-[#070b16] py-1 text-white shadow-lg" data-zone="rail" data-flow="column">
        <button
          type="button"
          className={iconButton}
          onClick={(event) => {
            event.stopPropagation();
            void closeScreen();
          }}
          aria-label="Close screen"
        >
          <X className="size-4" />
        </button>
        {floatIndex === undefined && !detached ? (
          <button
            type="button"
            className={iconButton}
            onClick={(event) => {
              event.stopPropagation();
              void togglePip();
            }}
            aria-pressed={pinned || mode === "pip"}
            aria-label={pinned ? "Remove picture in picture" : "Picture in picture"}
          >
            <PictureInPicture2 className="size-4" />
          </button>
        ) : null}
        {onRecall ? (
          <button
            type="button"
            className="flex w-full flex-col items-center justify-center text-white"
            onClick={(event) => {
              event.stopPropagation();
              onRecall();
            }}
            aria-label="Previous channel"
            title="Previous channel"
          >
            <Undo2 className="size-4" />
            <span className="text-[8px] leading-none font-semibold">Last</span>
          </button>
        ) : null}
        {onPrevious ? (
          <button
            type="button"
            className="flex w-full flex-col items-center justify-center text-white"
            onClick={(event) => {
              event.stopPropagation();
              onPrevious();
            }}
            aria-label="Back channel"
            title="Back channel"
          >
            <SkipBack className="size-4" />
            <span className="text-[8px] leading-none font-semibold">Back</span>
          </button>
        ) : null}
        <button
          type="button"
          className={iconButton}
          onClick={(event) => {
            event.stopPropagation();
            if (paused) play();
            else pause();
          }}
          aria-pressed={!paused}
          aria-label={paused ? "Play" : "Pause"}
        >
          {paused ? <Play className="size-4 fill-current" /> : <Pause className="size-4 fill-current" />}
        </button>
        {onNext ? (
          <button
            type="button"
            className="flex w-full flex-col items-center justify-center text-white"
            onClick={(event) => {
              event.stopPropagation();
              onNext();
            }}
            aria-label="Forward channel"
            title="Forward channel"
          >
            <SkipForward className="size-4" />
            <span className="text-[8px] leading-none font-semibold">Fwd</span>
          </button>
        ) : null}
        {floatIndex === undefined ? (
        <button
          type="button"
          className={iconButton}
          onClick={() => void toggleFull()}
          aria-pressed={mode === "full"}
          aria-label={mode === "full" ? "Exit full screen" : "Full screen"}
        >
          {mode === "full" ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
        ) : null}
        <select
          value={driver}
          aria-label="Player"
          title="Choose a player"
          className="mt-0.5 h-6 w-full rounded-sm border border-white/60 bg-black text-center text-[10px] font-bold text-white"
          style={{ colorScheme: "dark" }}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            event.stopPropagation();
            setStatus("loading");
            setDriver(event.target.value as Driver);
          }}
        >
          {DRIVERS.map((item) => (
            <option key={item} value={item} style={{ backgroundColor: "#12182c", color: "#ffffff" }}>
              {driverLabel(item)}
            </option>
          ))}
        </select>
      </div>
      </div>
    </div>
  );
}

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const secondsPart = whole % 60;
  const minutes = Math.floor(whole / 60) % 60;
  const hours = Math.floor(whole / 3600);
  const pad = (value: number) => String(value).padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(secondsPart)}`;
  return `${minutes}:${pad(secondsPart)}`;
}
