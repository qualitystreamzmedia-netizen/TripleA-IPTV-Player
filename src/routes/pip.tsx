import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PreviewPlayer } from "@/components/triplea/player";

type PipSearch = { src: string; title: string };

export const Route = createFileRoute("/pip")({
  validateSearch: (search: Record<string, unknown>): PipSearch => ({
    src: typeof search.src === "string" ? search.src : "",
    title: typeof search.title === "string" ? search.title : "TripleA",
  }),
  component: PipWindow,
});

function PipWindow() {
  const search = Route.useSearch();
  const [url, setUrl] = useState(search.src);
  const [title, setTitle] = useState(search.title || "TripleA");
  const [volume, setVolume] = useState<number | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const urlRef = useRef(url);
  urlRef.current = url;
  useEffect(() => {
    const remembered = (window as unknown as { __tripleaPip?: string }).__tripleaPip;
    const params = new URLSearchParams(remembered || window.location.search);
    const src = params.get("src") || "";
    if (src) {
      setUrl(src);
      const name = params.get("title");
      if (name) setTitle(name);
      const raw = Number(params.get("volume"));
      if (Number.isFinite(raw)) setVolume(Math.min(100, Math.max(0, Math.round(raw))));
    }
    setReady(true);
  }, []);
  useEffect(() => {
    function onPlay(event: MessageEvent) {
      const data = event.data as { type?: string; url?: string; title?: string } | null;
      if (!data || data.type !== "play" || typeof data.url !== "string") return;
      setUrl(data.url);
      if (typeof data.title === "string" && data.title) setTitle(data.title);
    }
    window.addEventListener("message", onPlay);
    return () => window.removeEventListener("message", onPlay);
  }, []);
  useEffect(() => {
    if (!url) return;
    function notify() {
      try {
        const channel = new BroadcastChannel("triplea-pip");
        channel.postMessage({ type: "close", url: urlRef.current });
        channel.close();
      } catch {
        /* the main window already released this channel */
      }
    }
    window.addEventListener("pagehide", notify);
    return () => window.removeEventListener("pagehide", notify);
  }, [url]);
  function signal(type: "step" | "recall", delta?: number) {
    try {
      const channel = new BroadcastChannel("triplea-pip");
      channel.postMessage({ type, url: urlRef.current, delta });
      channel.close();
    } catch {
      /* this window has no opener */
    }
  }
  if (!url || !ready) return <div className="h-screen bg-black" />;
  return (
    <div className="h-screen bg-black">
      <PreviewPlayer
        url={url}
        title={title || "TripleA"}
        detached
        initialVolume={volume}
        onPrevious={() => signal("step", -1)}
        onNext={() => signal("step", 1)}
        onRecall={() => signal("recall")}
        onClose={() => {
          const channel = new BroadcastChannel("triplea-pip");
          channel.postMessage({ type: "close", url: urlRef.current });
          channel.close();
          window.close();
        }}
      />
    </div>
  );
}