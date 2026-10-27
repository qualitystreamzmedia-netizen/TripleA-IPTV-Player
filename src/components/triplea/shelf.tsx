import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Play, Plus } from "lucide-react";
import { previewAsset } from "@/lib/preview-path-prefix";
import type { Episode, Movie, Series } from "@/lib/iptv";
import type { CategoryView } from "@/lib/categories";
import { PreviewPlayer } from "@/components/triplea/player";

type Item = Movie | Series;

const CARD_TONES = ["#1a3148", "#1c3a34", "#3a2844", "#3a311c", "#243044", "#2c2438"];

export function TitleShelf({
  kind,
  items,
  categories,
  query,
  favorites,
  episodes,
  loadingId,
  note,
  playingUrl,
  playingTitle,
  onToggleFavorite,
  onPlay,
  onOpen,
  onPin,
  pinnedUrls = [],
  vlc = true,
  player = "mpegts",
}: {
  kind: "movies" | "series";
  items: Item[];
  categories: CategoryView[];
  query: string;
  favorites: string[];
  episodes: Episode[];
  loadingId: string;
  note: string;
  playingUrl: string;
  playingTitle: string;
  onToggleFavorite: (id: string) => void;
  onPlay: (url: string, title: string) => void;
  onOpen: (item: Series) => void;
  onPin?: (url: string, title: string) => void;
  pinnedUrls?: string[];
  vlc?: boolean;
  player?: "mpegts" | "vlc" | "hls" | "browser";
}) {
  const [selectedId, setSelectedId] = useState("");
  const [season, setSeason] = useState(0);
  const [category, setCategory] = useState("All");
  const [shownCount, setShownCount] = useState(48);
  const pendingPlay = useRef("");

  const allowed = useMemo(() => {
    const ids = new Set(categories.map((category) => category.id));
    return items.filter((item) => ids.has(item.group));
  }, [categories, items]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allowed;
    return allowed.filter(
      (item) => item.name.toLowerCase().includes(q) || item.group.toLowerCase().includes(q),
    );
  }, [allowed, query]);

  const rows = useMemo(() => {
    const byGroup = new Map<string, Item[]>();
    const saved: Item[] = [];
    const favoriteIds = new Set(favorites);
    for (const item of visible) {
      const list = byGroup.get(item.group);
      if (list) list.push(item);
      else byGroup.set(item.group, [item]);
      if (favoriteIds.has(item.id)) saved.push(item);
    }
    const grouped = categories.flatMap((category) => {
      const list = byGroup.get(category.id);
      return list?.length ? [{ id: category.id, title: category.label, list }] : [];
    });
    return saved.length ? [{ id: "my-list", title: "My List", list: saved }, ...grouped] : grouped;
  }, [categories, favorites, visible]);

  const selected = visible.find((item) => item.id === selectedId) ?? visible[0] ?? null;
  const seasons = Array.from(new Set(episodes.map((episode) => episode.season))).sort((a, b) => a - b);
  const shown = season === 0 ? episodes : episodes.filter((episode) => episode.season === season);
  const empty =
    kind === "movies"
      ? "No movies in this source. An Xtream login loads the movie catalog. An M3U link is live channels only."
      : "No series in this source. An Xtream login loads the series catalog. An M3U link is live channels only.";

  function choose(item: Item) {
    setSelectedId(item.id);
    setSeason(0);
    if ("url" in item) onPlay(item.url, item.name);
    else onOpen(item);
  }

  function playFeatured() {
    if (!selected) return;
    if ("url" in selected) {
      onPlay(selected.url, selected.name);
      return;
    }
    const pool = season === 0 ? episodes : episodes.filter((episode) => episode.season === season);
    if (pool[0] && loadingId !== selected.id) {
      onPlay(pool[0].url, `${selected.name} · ${pool[0].title}`);
      return;
    }
    pendingPlay.current = selected.id;
    onOpen(selected);
  }

  useEffect(() => {
    if (!pendingPlay.current || !selected || pendingPlay.current !== selected.id || "url" in selected) return;
    if (loadingId === selected.id) return;
    const pool = season === 0 ? episodes : episodes.filter((episode) => episode.season === season);
    pendingPlay.current = "";
    const first = pool[0];
    if (first) onPlay(first.url, `${selected.name} · ${first.title}`);
  }, [episodes, loadingId, season, selected]);

  const shownRows = category === "All" ? rows.slice(0, 8) : rows.filter((row) => row.id === category);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg text-fg">
      <div className="flex gap-2 overflow-x-auto border-b border-black bg-[#12182c] px-4 py-2" aria-label="Categories" data-zone="shelf-cats" data-flow="row">
        <SeasonChip label="All" active={category === "All"} onClick={() => { setCategory("All"); setShownCount(48); }} />
        {rows.map((row) => (
          <SeasonChip
            key={row.id}
            label={row.title}
            active={category === row.id}
            onClick={() => {
              setCategory(row.id);
              setShownCount(48);
            }}
          />
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
      {selected ? (
        <section className="relative overflow-hidden bg-black px-4 py-3 text-white sm:px-6">
          <div className="relative flex flex-col items-start gap-3 lg:flex-row">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              {selected.poster ? (
                <Cover image={selected.poster} className="h-28 w-20 shrink-0 rounded-md object-cover" />
              ) : null}
              <div className="min-w-0">
                <p className="text-[10px] font-semibold tracking-[0.14em] uppercase" style={{ color: "#f5d76e" }}>{selected.group}</p>
                <h2 className="mt-1 text-xl font-bold leading-tight" style={{ color: "#ffffff" }}>
                  {selected.name}
                </h2>
                <p className="mt-1 line-clamp-2 max-w-xl text-sm leading-snug" style={{ color: "#f4f4f5" }}>
                  {selected.plot || (kind === "movies" ? "Play this title." : "Open this series, then pick an episode.")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2" data-zone="shelf-actions" data-flow="row">
                  <button
                    type="button"
                    onClick={playFeatured}
                    className="flex h-9 items-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-black"
                  >
                    <Play className="size-4 fill-current" />
                    Play
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleFavorite(selected.id)}
                    aria-pressed={favorites.includes(selected.id)}
                    className="flex h-9 items-center gap-2 rounded-md bg-white/20 px-4 text-sm font-semibold text-white"
                  >
                    {favorites.includes(selected.id) ? <Check className="size-4" /> : <Plus className="size-4" />}
                    My List
                  </button>
                </div>
              </div>
            </div>
            {playingUrl ? (
              <div className={kind === "series" ? "aspect-video w-full max-w-xs shrink-0 overflow-hidden rounded-md bg-black" : "aspect-video w-full max-w-md shrink-0 overflow-hidden rounded-md bg-black"}>
              <PreviewPlayer
                url={playingUrl}
                title={playingTitle || selected.name}
                onClose={() => onPlay("", "")}
                onPin={onPin ? () => onPin(playingUrl, playingTitle || selected.name) : undefined}
                pinned={pinnedUrls.includes(playingUrl)}
                timeline
                vlc
                player={kind === "series" ? "browser" : player === "browser" || player === "hls" || player === "mpegts" ? player : "vlc"}
              />
              </div>
            ) : (
              <div className={kind === "series" ? "grid aspect-video w-full max-w-xs shrink-0 place-items-center rounded-md bg-black text-sm text-white/70" : "grid aspect-video w-full max-w-md shrink-0 place-items-center rounded-md bg-black text-sm text-white/70"}>
                {loadingId === selected.id ? "Loading episodes…" : "Press Play"}
              </div>
            )}
          </div>
        </section>
      ) : (
        <p className="p-6 text-sm text-muted">{empty}</p>
      )}

      {kind === "series" && selected ? (
        <section className="px-4 pt-4 sm:px-8">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold">Seasons</h3>
            {loadingId === selected.id ? <span className="text-sm text-muted">Loading…</span> : null}
          </div>
          {note ? <p className="mt-2 text-sm text-live">{note}</p> : null}
          {seasons.length ? (
            <ul className="mt-3 flex gap-3 overflow-x-auto pb-2" data-zone="seasons" data-flow="row">
              <li className="w-28 shrink-0">
                <button type="button" className="w-full text-left" onClick={() => setSeason(0)}>
                  <Artwork
                    image={selected.poster}
                    label="All seasons"
                    active={season === 0}
                  />
                </button>
              </li>
              {seasons.map((value) => {
                const cover = episodes.find((episode) => episode.season === value)?.seasonImage || selected.poster;
                return (
                  <li key={value} className="w-28 shrink-0">
                    <button type="button" className="w-full text-left" onClick={() => setSeason(value)}>
                      <Artwork image={cover} label={`Season ${value}`} active={season === value} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <h3 className="mt-4 text-lg font-semibold">Episodes</h3>
          {shown.length ? (
            <ul className="mt-3 flex gap-3 overflow-x-auto pb-2" data-zone="episodes" data-flow="row">
              {shown.map((episode) => (
                <li key={episode.id} className="w-56 shrink-0 sm:w-64">
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => onPlay(episode.url, `${selected.name} · ${episode.title}`)}
                  >
                    <Artwork
                      image={episode.image || episode.seasonImage || selected.poster}
                      label={`S${episode.season} E${episode.number}`}
                      wide
                    />
                    <span className="mt-2 block truncate text-sm">{episode.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <div className={category === "All" ? "space-y-6 px-4 py-6 sm:px-8" : "px-4 py-6 sm:px-8"}>
        {shownRows.map((row) => (
          <section key={row.id} id={`cat-${row.id}`}>
            <h3 className="mb-2 text-base font-semibold">
              {row.title}
              <span className="ml-2 text-sm font-normal text-muted">{row.list.length}</span>
            </h3>
            <ul
              data-zone={`posters-${row.id}`}
              data-flow="row"
              className={
                category === "All"
                  ? "flex snap-x gap-2 overflow-x-auto pb-2"
                  : "grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8"
              }
            >
              {(category === "All" ? row.list.slice(0, 16) : row.list.slice(0, shownCount)).map((item) => (
                <li key={`${row.id}-${item.id}`} className="snap-start">
                  <button
                    type="button"
                    onClick={() => choose(item)}
                    className="w-16 text-left sm:w-20"
                    aria-pressed={item.id === selected?.id}
                  >
                    <Poster name={item.name} poster={item.poster} active={item.id === selected?.id} />
                  </button>
                </li>
              ))}
            </ul>
            {category !== "All" && row.list.length > shownCount ? (
              <button
                type="button"
                onClick={() => setShownCount((count) => count + 48)}
                className="mt-3 h-10 rounded-md bg-panel-2 px-4 text-sm font-semibold"
              >
                Show more ({row.list.length - shownCount} left)
              </button>
            ) : null}
          </section>
        ))}
      </div>
      </div>
    </div>
  );
}

function Cover({ image, className }: { image?: string; className: string }) {
  const proxied = image ? `${previewAsset("/api/media")}?url=${encodeURIComponent(image)}` : "";
  const [src, setSrc] = useState(image || "");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    setSrc(image || "");
  }, [image]);
  if (!image || failed || !src) return null;
  return (
    <img
      src={src}
      alt=""
      className={className}
      decoding="async"
      onError={() => {
        if (proxied && src !== proxied) setSrc(proxied);
        else setFailed(true);
      }}
    />
  );
}
function Artwork({
  image,
  label,
  active = false,
  wide = false,
}: {
  image?: string;
  label: string;
  active?: boolean;
  wide?: boolean;
}) {
  const tone = CARD_TONES[label.length % CARD_TONES.length];
  return (
    <span
      className={
        active
          ? `relative flex items-end overflow-hidden rounded-md ring-2 ring-white ${wide ? "aspect-video" : "aspect-[2/3]"}`
          : `relative flex items-end overflow-hidden rounded-md ${wide ? "aspect-video" : "aspect-[2/3]"}`
      }
      style={{ background: tone }}
    >
      <Cover image={image} className="absolute inset-0 h-full w-full object-cover" />
      <span className="relative w-full bg-gradient-to-t from-black/80 to-transparent p-2 text-left text-xs font-semibold">
        {label}
      </span>
    </span>
  );
}

function SeasonChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "h-9 shrink-0 rounded-md bg-white px-3 text-sm font-semibold text-black"
          : "h-9 shrink-0 rounded-md bg-[#243156] px-3 text-sm font-medium text-white"
      }
    >
      {label}
    </button>
  );
}

function Poster({ name, poster, active }: { name: string; poster?: string; active: boolean }) {
  const tone = CARD_TONES[name.length % CARD_TONES.length];
  return (
    <span
      className={
        active
          ? "relative flex aspect-[2/3] items-end overflow-hidden rounded-md ring-2 ring-fg"
          : "relative flex aspect-[2/3] items-end overflow-hidden rounded-md"
      }
      style={{ background: tone }}
    >
      <Cover image={poster} className="absolute inset-0 h-full w-full object-cover" />
      <span className="relative line-clamp-2 w-full bg-gradient-to-t from-black/80 to-transparent p-1 text-left text-[10px] font-semibold leading-tight">
        {name}
      </span>
    </span>
  );
}
