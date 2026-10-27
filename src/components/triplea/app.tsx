import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Search, Settings, Star, Volume2, VolumeX } from "lucide-react";
import {
  currentProgram,
  demoCatalog,
  formatTime,
  loadEpisodes,
  loadFavorites,
  loadLibrary,
  loadM3u,
  loadSavedSource,
  loadXtream,
  loadEpg,
  loadCatalogCache,
  saveCatalogCache,
  nextProgram,
  playlistLabel,
  programsFor,
  saveFavorites,
  saveLibrary,
  upsertPlaylist,
  type Catalog,
  type Channel,
  type Movie,
  type Playlist,
  type Series,
  type Source,
} from "@/lib/iptv";
import { PreviewPlayer, LiveStamp, currentVolume, publishVolume, toggleSharedMute } from "@/components/triplea/player";
import { installRemote, type RemoteActions } from "@/components/triplea/remote";
import { TitleShelf } from "@/components/triplea/shelf";
import { SettingsDialog } from "@/components/triplea/settings";
import { previewAsset } from "@/lib/preview-path-prefix";
import {
  arrangeCategories,
  loadCategoryPrefs,
  playlistNames,
  saveCategoryPrefs,
  type CategoryPrefs,
  type CategorySection,
} from "@/lib/categories";

function titledCatalog(
  kind: "movies" | "series",
  catalog: Catalog,
  libraries: Record<string, Catalog>,
  playlists: Playlist[],
  activeId: string,
  viewId: string,
  query: string,
  searchKind: "channels" | "categories",
): Array<Movie | Series> {
  const q = query.trim().toLowerCase();
  const useAll = playlists.length === 0 || viewId === "all" || q.length > 0;
  const chosen = playlists.filter((item) => useAll || item.id === viewId);
  const lists =
    chosen.length === 0
      ? [kind === "movies" ? catalog.movies : catalog.series]
      : chosen.map((playlist) => {
          const data = libraries[playlist.id] ?? (playlist.id === activeId ? catalog : undefined);
          const items = kind === "movies" ? data?.movies : data?.series;
          return (items ?? []).map((item) => ({ ...item, id: `${playlist.id}::${item.id}` }));
        });
  const rows = lists.flat();
  if (!q) return rows;
  return rows.filter((item) =>
    searchKind === "categories" ? item.group.toLowerCase().includes(q) : item.name.toLowerCase().includes(q),
  );
}

const WINDOW_MS = 3 * 60 * 60 * 1000;
const FULL_GUIDE_MS = 8 * 60 * 60 * 1000;
const FONT_KEY = "triplea-iptv-v1-font";
const VLC_KEY = "triplea-iptv-v1-vlc";
const PLAYER_KEY = "triplea-iptv-v1-player";
const WINDOWS_KEY = "triplea-iptv-v1-windows";
const GROUP_LISTS_KEY = "triplea-iptv-v1-group-playlists";
const CLOCK_KEY = "triplea-iptv-v1-clock";
const THEME_KEY = "triplea-iptv-v1-dark";

type PlayerChoice = "mpegts" | "vlc" | "hls" | "browser";

function channelTitle(name: string): string {
  return name
    .replace(/\bpremium\b/gi, " ")
    .replace(/\bon\s*air\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([|·-])\s*$/g, "")
    .replace(/^\s*[|·-]\s*/g, "")
    .trim();
}

function withPrograms(base: Channel[], incoming: Channel[]): Channel[] {
  const programs = new Map(incoming.filter((channel) => channel.programs.length > 0).map((channel) => [channel.id, channel]));
  if (programs.size === 0) return base;
  let changed = false;
  const next = base.map((channel) => {
    const found = programs.get(channel.id);
    if (!found) return channel;
    changed = true;
    return { ...channel, programs: found.programs, guide: "epg" as const };
  });
  return changed ? next : base;
}

function loadPlayer(): PlayerChoice {
  try {
    if (typeof window !== "undefined" && /(?:\?|&)safe=1(?:&|$)/.test(window.location.search)) {
      localStorage.setItem(PLAYER_KEY, "browser");
      localStorage.removeItem("triplea-iptv-v1-channel-players");
      return "browser";
    }
    if (typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent)) {
      const saved = localStorage.getItem(PLAYER_KEY);
      if (saved === "mpegts" || saved === "vlc" || saved === "hls" || saved === "browser") return saved;
      return "browser";
    }
    const saved = localStorage.getItem(PLAYER_KEY);
    if (saved === "mpegts" || saved === "vlc" || saved === "hls" || saved === "browser") return saved;
    if (localStorage.getItem(VLC_KEY) === "1") return "vlc";
  } catch {
    /* keep the default */
  }
  return "mpegts";
}

function savePlayer(value: PlayerChoice) {
  localStorage.setItem(PLAYER_KEY, value);
  localStorage.setItem(VLC_KEY, value === "vlc" ? "1" : "0");
}

function loadFontSize(): number {
  try {
    const value = Number(localStorage.getItem(FONT_KEY));
    if (Number.isFinite(value) && value >= 10 && value <= 18) return value;
  } catch {
    /* keep the default */
  }
  return 12;
}

function saveFontSize(value: number) {
  localStorage.setItem(FONT_KEY, String(value));
}

function loadWindowCount(): number {
  try {
    const value = Number(localStorage.getItem(WINDOWS_KEY));
    if (value === 2 || value === 3 || value === 4) return value;
  } catch {
    /* keep one window */
  }
  return 1;
}

function loadFlag(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    if (value === "1") return true;
    if (value === "0") return false;
  } catch {
    /* keep the default */
  }
  return fallback;
}

function PaneSplit({
  axis,
  onDrag,
  style,
}: {
  axis: "x" | "y";
  onDrag: (percent: number) => void;
  style: { gridColumn: string | number; gridRow: string | number };
}) {
  function down(event: ReactPointerEvent<HTMLButtonElement>) {
    const parent = event.currentTarget.parentElement;
    if (!parent) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (pointer: PointerEvent) => {
      const rect = parent.getBoundingClientRect();
      const raw =
        axis === "x"
          ? ((pointer.clientX - rect.left) / rect.width) * 100
          : ((pointer.clientY - rect.top) / rect.height) * 100;
      onDrag(Math.min(78, Math.max(22, raw)));
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }
  return (
    <button
      type="button"
      data-tv-skip
      aria-label={axis === "x" ? "Resize columns" : "Resize rows"}
      onPointerDown={down}
      style={style}
      className={
        axis === "x"
          ? "z-20 h-full w-full cursor-col-resize bg-white/25 p-0 hover:bg-[#ffe08a]"
          : "z-20 h-full w-full cursor-row-resize bg-white/25 p-0 hover:bg-[#ffe08a]"
      }
    />
  );
}

function hideInstallButtons() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return true;
  return /Electron/i.test(ua) && /Macintosh|Mac OS X/i.test(ua);
}

function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function TripleAApp() {
  const tick = useNow();
  const now = tick ?? 0;
  const [catalog, setCatalog] = useState<Catalog>(() => demoCatalog());
  const [section, setSection] = useState<"live" | "movies" | "series" | "songs">("live");
  const [openedSections, setOpenedSections] = useState({ movies: false, series: false });
  const [source, setSource] = useState<Source>({ mode: "demo" });
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [activeId, setActiveId] = useState("");
  const [libraries, setLibraries] = useState<Record<string, Catalog>>({});
  const [viewId, setViewId] = useState("all");
  const [searchKind, setSearchKind] = useState<"channels" | "categories">("channels");
  const [group, setGroup] = useState("All");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>("bunny");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [booted, setBooted] = useState(false);
  const [feature, setFeature] = useState({ url: "", title: "" });
  const [openEpisodes, setOpenEpisodes] = useState<NonNullable<Series["episodes"]>>([]);
  const [loadingSeries, setLoadingSeries] = useState("");
  const [seriesNote, setSeriesNote] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [screenOpen, setScreenOpen] = useState(true);
  const [guideState, setGuideState] = useState<"sample" | "loading" | "live" | "empty">("sample");
  const [guideGeneration, setGuideGeneration] = useState(0);
  const [logo, setLogo] = useState("/logo.png");
  const [categoryPrefs, setCategoryPrefs] = useState(loadCategoryPrefs);
  const [categorySection, setCategorySection] = useState<CategorySection>("live");
  const [fontSize, setFontSize] = useState(12);
  const [useVlc, setUseVlc] = useState(loadPlayer() === "vlc");
  const [player, setPlayer] = useState<PlayerChoice>(loadPlayer);
  const [windowCount, setWindowCount] = useState(1);
  const [splitX, setSplitX] = useState(50);
  const [splitY, setSplitY] = useState(50);
  const [groupByPlaylist, setGroupByPlaylist] = useState(false);
  const [showClock, setShowClock] = useState(true);
  const [dark, setDark] = useState(false);
  const [trialNote, setTrialNote] = useState("");
  const [trialEnded, setTrialEnded] = useState(false);
  const [slotIds, setSlotIds] = useState<string[]>([]);
  const [slotFocus, setSlotFocus] = useState(0);

  useEffect(() => {
    const read = () => {
      const expires = (window as unknown as { __tripleaTrial?: { expiresAt?: number } }).__tripleaTrial?.expiresAt;
      if (!expires) return;
      const left = expires - Date.now();
      if (left <= 0) {
        setTrialEnded(true);
        setTrialNote("Trial ended");
        return;
      }
      const days = Math.max(1, Math.ceil(left / 86400000));
      setTrialNote(days === 1 ? "1 day left in trial" : `${days} days left in trial`);
    };
    read();
    const id = window.setInterval(read, 1000);
    return () => window.clearInterval(id);
  }, []);
  const [fullGuide, setFullGuide] = useState(false);
  const [volume, setVolume] = useState(80);
  const [pins, setPins] = useState<{ url: string; title: string; channelId: string; previousId?: string; volume: number }[]>([]);
  const heard = useRef(new Map<string, number>());
  const pipWindows = useRef(new Map<string, Window>());
  const [externalPip, setExternalPip] = useState(false);
  const [hideInstalls, setHideInstalls] = useState(false);

  useEffect(() => {
    setHideInstalls(hideInstallButtons());
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    if (!booted) return;
    const timer = window.setTimeout(() => {
      setOpenedSections({ movies: true, series: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [booted]);

  useEffect(() => {
    const library = loadLibrary();
    const saved = library.playlists.find((item) => item.id === library.activeId)?.source ?? loadSavedSource();
    const cached = loadCatalogCache();
    const favs = loadFavorites();
    setFavorites(favs);
    setFontSize(loadFontSize());
    setWindowCount(loadWindowCount());
    setGroupByPlaylist(loadFlag(GROUP_LISTS_KEY, false));
    setShowClock(loadFlag(CLOCK_KEY, true));
    setDark(loadFlag(THEME_KEY, false));
    setLogo(previewAsset("/logo.png"));
    setPlaylists(library.playlists);
    setActiveId(library.activeId);
    setViewId(library.activeId || "all");
    setSource(saved);
    setLibraries(cached);
    let dead = false;
    const pending = library.playlists;
    const remembered = library.activeId ? cached[library.activeId] : undefined;
    if (remembered) {
      setCatalog(remembered);
      setSelectedId(remembered.channels[0] ? `${library.activeId}::${remembered.channels[0].id}` : "");
      setBooted(true);
    }
    if (pending.length === 0) {
      setCatalog(demoCatalog());
      setBooted(true);
      return;
    }
    void Promise.all(
      pending.map(async (playlist) => {
        try {
          const next =
            playlist.source.mode === "demo"
              ? demoCatalog()
              : playlist.source.mode === "m3u"
                ? await loadM3u(playlist.source.url)
                : await loadXtream(playlist.source.server, playlist.source.username, playlist.source.password);
          if (dead) return;
          if (playlist.source.mode !== "demo") saveCatalogCache(playlist.id, next);
          setLibraries((current) => ({ ...current, [playlist.id]: next }));
          if (playlist.id === library.activeId) {
            setCatalog(next);
            setSelectedId(next.channels[0] ? `${playlist.id}::${next.channels[0].id}` : "");
          }
        } catch {
          if (!dead && playlist.id === library.activeId && !cached[playlist.id]) {
            setSeriesNote("That playlist could not be loaded. The channel list was left unchanged.");
          }
        }
      }),
    ).finally(() => {
      if (!dead) setBooted(true);
    });
    return () => {
      dead = true;
    };
  }, []);

  useEffect(() => {
    setVolume(currentVolume());
    function onVolume(event: Event) {
      setVolume((event as CustomEvent<number>).detail);
    }
    window.addEventListener("triplea-volume", onVolume);
    return () => window.removeEventListener("triplea-volume", onVolume);
  }, []);

  const guideJobs = useRef(new Set<string>());
  const guideKey = `${activeId}|${libraries[activeId]?.epgUrl ?? catalog.epgUrl ?? ""}|${libraries[activeId]?.channels.length ?? catalog.channels.length}|${guideGeneration}`;
  useEffect(() => {
    const stored = libraries[activeId];
    const epgUrl = stored?.epgUrl || (source.mode === "demo" ? "" : catalog.epgUrl || "");
    const base = stored?.channels?.length ? stored.channels : source.mode === "demo" ? [] : catalog.channels;
    if (!epgUrl || base.length === 0) {
      setGuideState(source.mode === "demo" || playlists.length === 0 ? "sample" : "empty");
      return;
    }
    if (guideJobs.current.has(guideKey)) return;
    guideJobs.current.add(guideKey);
    setGuideState("loading");
    let dead = false;
    let finished = false;
    const rawSelected = selectedId.includes("::") ? selectedId.slice(selectedId.lastIndexOf("::") + 2) : "";
    const ordered = rawSelected
      ? [base.find((channel) => channel.id === rawSelected), ...base.filter((channel) => channel.id !== rawSelected)].filter(
          (channel): channel is Channel => Boolean(channel),
        )
      : base;
    const apply = (channels: Channel[]) => {
      setLibraries((current) => {
        let changed = false;
        const next = { ...current };
        for (const [id, entry] of Object.entries(current)) {
          if (id !== activeId && entry.epgUrl !== epgUrl) continue;
          const merged = withPrograms(entry.channels, channels);
          if (merged === entry.channels) continue;
          next[id] = { ...entry, channels: merged };
          changed = true;
        }
        return changed ? next : current;
      });
      setCatalog((current) => {
        const merged = withPrograms(current.channels, channels);
        if (merged === current.channels) return current;
        return { ...current, channels: merged };
      });
    };
    void loadEpg(epgUrl, ordered, Date.now(), (channels) => {
      if (dead) return;
      apply(channels);
      if (channels.some((channel) => channel.guide === "epg")) setGuideState("live");
    })
      .then((channels) => {
        if (dead) return;
        finished = true;
        apply(channels);
        setGuideState(channels.some((channel) => channel.guide === "epg") ? "live" : "empty");
      })
      .catch(() => {
        if (!dead) setGuideState("empty");
      });
    return () => {
      dead = true;
      if (!finished) guideJobs.current.delete(guideKey);
    };
  }, [activeId, guideKey]);

  useEffect(() => {
    const stored = libraries[activeId];
    if (!stored?.epgUrl?.includes("xmltv.php")) return;
    const raw = selectedId.includes("::") ? selectedId.slice(selectedId.lastIndexOf("::") + 2) : "";
    const channel = stored.channels.find((item) => item.id === raw);
    if (!channel || channel.programs.length > 0) return;
    let dead = false;
    void loadEpg(stored.epgUrl, [channel], Date.now(), (channels) => {
      if (dead) return;
      const merged = withPrograms(stored.channels, channels);
      if (merged === stored.channels) return;
      setLibraries((current) => {
        const existing = current[activeId];
        if (!existing) return current;
        return { ...current, [activeId]: { ...existing, channels: withPrograms(existing.channels, channels) } };
      });
      setCatalog((current) => ({ ...current, channels: withPrograms(current.channels, channels) }));
      if (channels.some((item) => item.guide === "epg")) setGuideState("live");
    }).catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [activeId, selectedId]);

  const channels = useMemo(() => {
    const q = query.trim();
    const useAll = playlists.length === 0 || viewId === "all" || q.length > 0;
    const chosen = playlists.filter((item) => useAll || item.id === viewId);
    if (chosen.length === 0) {
      if (playlists.length > 0) return [];
      return catalog.channels.map((channel) => ({ ...channel, playlistName: playlistLabel(source) }));
    }
    const guided = new Map(catalog.channels.map((channel) => [channel.id, channel]));
    return chosen.flatMap((playlist) => {
      const data = libraries[playlist.id];
      if (!data) return [];
      const playlistName = playlistLabel(playlist.source);
      return data.channels.map((channel) => {
        const fresh = playlist.id === activeId ? guided.get(channel.id) : undefined;
        const useFresh = Boolean(fresh && fresh.programs.length > channel.programs.length);
        return {
          ...channel,
          programs: useFresh && fresh ? fresh.programs : channel.programs,
          guide: useFresh && fresh?.guide ? fresh.guide : channel.guide,
          id: `${playlist.id}::${channel.id}`,
          playlistName,
        };
      });
    });
  }, [activeId, catalog, libraries, playlists, query, source, viewId]);
  const liveCategories = useMemo(
    () => arrangeCategories(playlistNames(channels.map((channel) => channel.group)), categoryPrefs.live),
    [categoryPrefs.live, channels],
  );
  const movieTitles = useMemo(
    () => titledCatalog("movies", catalog, libraries, playlists, activeId, viewId, query, searchKind),
    [activeId, catalog, libraries, playlists, query, searchKind, viewId],
  );
  const seriesTitles = useMemo(
    () => titledCatalog("series", catalog, libraries, playlists, activeId, viewId, query, searchKind),
    [activeId, catalog, libraries, playlists, query, searchKind, viewId],
  );
  const movieCategories = useMemo(
    () => arrangeCategories(playlistNames(movieTitles.map((item) => item.group)), categoryPrefs.movies),
    [categoryPrefs.movies, movieTitles],
  );
  const seriesCategories = useMemo(
    () => arrangeCategories(playlistNames(seriesTitles.map((item) => item.group)), categoryPrefs.series),
    [categoryPrefs.series, seriesTitles],
  );
  const groups =
    groupByPlaylist && playlists.length > 0
      ? ["All", "Favorites", ...playlists.map((item) => `playlist:${item.id}`)]
      : [
          "All",
          "Favorites",
          ...liveCategories
            .filter((category) => {
              const q = query.trim().toLowerCase();
              if (!q || searchKind !== "categories") return true;
              return category.label.toLowerCase().includes(q) || category.id.toLowerCase().includes(q);
            })
            .map((category) => category.id),
        ];

  useEffect(() => {
    if (group.startsWith("playlist:")) {
      const id = group.slice("playlist:".length);
      if (!groupByPlaylist || !playlists.some((item) => item.id === id)) setGroup("All");
      return;
    }
    if (group !== "All" && group !== "Favorites" && !liveCategories.some((category) => category.id === group)) {
      setGroup("All");
    }
  }, [group, groupByPlaylist, liveCategories, playlists]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return channels.filter((channel) => {
      if (group === "Favorites" && !favorites.includes(channel.id)) return false;
      if (group.startsWith("playlist:")) {
        if (!channel.id.startsWith(`${group.slice("playlist:".length)}::`)) return false;
      } else if (group !== "All" && group !== "Favorites" && channel.group !== group) return false;
      if (!q) return true;
      if (searchKind === "categories") return channel.group.toLowerCase().includes(q);
      return channel.name.toLowerCase().includes(q) || String(channel.number).includes(q);
    });
  }, [channels, favorites, group, query, searchKind]);

  const selected = channels.find((channel) => channel.id === selectedId) ?? visible[0] ?? channels[0];

  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const [previousChannelId, setPreviousChannelId] = useState("");
  const selectedWatch = useRef(selectedId);
  const tunePinRef = useRef<(url: string, delta: number) => void>(() => undefined);
  const recallPinRef = useRef<(url: string) => void>(() => undefined);

  useEffect(() => {
    if (selectedWatch.current && selectedWatch.current !== selectedId) setPreviousChannelId(selectedWatch.current);
    selectedWatch.current = selectedId;
  }, [selectedId]);

  function releasePip(url: string) {
    pipWindows.current.delete(url);
    if (pipWindows.current.size === 0) setExternalPip(false);
    setPins((current) => {
      const pin = current.find((item) => item.url === url);
      if (pin) {
        const match = channelsRef.current.find((item) => item.url === pin.url || item.id === pin.channelId);
        if (match) {
          setSection("live");
          setSelectedId(match.id);
          setScreenOpen(true);
        } else {
          setFeature({ url: pin.url, title: pin.title });
        }
      }
      return current.filter((item) => item.url !== url);
    });
  }

  useEffect(() => {
    const channel = new BroadcastChannel("triplea-pip");
    channel.onmessage = (event) => {
      const url = event.data?.url;
      if (typeof url !== "string") return;
      if (event.data?.type === "close") releasePip(url);
      else if (event.data?.type === "step") tunePinRef.current(url, event.data?.delta === -1 ? -1 : 1);
      else if (event.data?.type === "recall") recallPinRef.current(url);
    };
    const timer = window.setInterval(() => {
      for (const [url, pip] of pipWindows.current) {
        if (pip.closed) releasePip(url);
      }
    }, 400);
    return () => {
      window.clearInterval(timer);
      channel.close();
    };
  }, [channels]);

  function closePin(pin: { url: string; title: string; channelId: string }) {
    const pip = pipWindows.current.get(pin.url);
    if (pip && !pip.closed) pip.close();
    releasePip(pin.url);
  }

  function levelFor(url: string) {
    const saved = heard.current.get(url);
    return saved === undefined ? currentVolume() : saved;
  }

  function togglePin(url: string, title: string, channelId = "") {
    if (!url) return;
    const existing = pins.find((pin) => pin.url === url);
    if (existing) {
      pipWindows.current.get(url)?.close();
      pipWindows.current.delete(url);
      if (pipWindows.current.size === 0) setExternalPip(false);
      closePin(existing);
      return;
    }
    const volume = levelFor(url);
    setPins((current) => {
      const next = [...current, { url, title, channelId, volume }];
      return next.length > 3 ? next.slice(next.length - 3) : next;
    });
    if (selected?.url === url) setScreenOpen(false);
    if (feature.url === url) setFeature({ url: "", title: "" });
    const desktop = typeof navigator !== "undefined" && /Electron/i.test(navigator.userAgent);
    if (!desktop) return;
    const page = `${window.location.origin}/pip?src=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}&volume=${volume}`;
    const pip = window.open(page, `triplea-pip-${encodeURIComponent(url)}`, "popup=yes,width=480,height=320,resizable=yes");
    if (pip) {
      pipWindows.current.set(url, pip);
      setExternalPip(true);
    }
  }
  const onNow = selected ? currentProgram(selected, now) : undefined;
  const coming = selected ? nextProgram(selected, now) : undefined;
  const windowStart = now - (now % (30 * 60 * 1000));

  function stepChannel(delta: number) {
    if (!visible.length) return;
    const index = visible.findIndex((channel) => channel.id === selected?.id);
    const next = index < 0 ? (delta > 0 ? 0 : visible.length - 1) : (index + delta + visible.length) % visible.length;
    setSelectedId(visible[next].id);
    setScreenOpen(true);
  }

  function recallChannel() {
    if (!previousChannelId) return;
    setSelectedId(previousChannelId);
    setScreenOpen(true);
  }

  function neighborChannel(channelId: string, delta: number) {
    const list = visibleRef.current;
    if (!list.length) return undefined;
    const index = list.findIndex((channel) => channel.id === channelId);
    const next = index < 0 ? (delta > 0 ? 0 : list.length - 1) : (index + delta + list.length) % list.length;
    return list[next];
  }

  function retunePin(url: string, channel: Channel, previousId: string) {
    const volume = heard.current.get(url);
    if (volume !== undefined) heard.current.set(channel.url, volume);
    setPins((current) =>
      current.map((item) =>
        item.url === url ? { url: channel.url, title: channel.name, channelId: channel.id, previousId, volume: item.volume } : item,
      ),
    );
    const pip = pipWindows.current.get(url);
    if (pip && !pip.closed) {
      pipWindows.current.delete(url);
      pipWindows.current.set(channel.url, pip);
      pip.postMessage({ type: "play", url: channel.url, title: channel.name }, "*");
    }
  }

  function tunePin(url: string, delta: number) {
    const pin = pinsRef.current.find((item) => item.url === url);
    if (!pin) return;
    const channel = neighborChannel(pin.channelId, delta);
    if (!channel || channel.url === pin.url) return;
    retunePin(pin.url, channel, pin.channelId);
  }

  function recallPin(url: string) {
    const pin = pinsRef.current.find((item) => item.url === url);
    if (!pin?.previousId) return;
    const channel = channelsRef.current.find((item) => item.id === pin.previousId);
    if (!channel || channel.url === pin.url) return;
    retunePin(pin.url, channel, pin.channelId);
  }

  tunePinRef.current = tunePin;
  recallPinRef.current = recallPin;

  useEffect(() => {
    if (windowCount < 2 || !selectedId) return;
    setSlotIds((current) => {
      const next = current.slice(0, windowCount);
      while (next.length < windowCount) next.push("");
      if (next[slotFocus] === selectedId && next.length === current.length) return current;
      next[slotFocus] = selectedId;
      return next;
    });
  }, [selectedId, slotFocus, windowCount]);

  function focusSlot(index: number) {
    setSlotFocus(index);
    const id = slotIds[index];
    if (id) setSelectedId(id);
  }

  function stepSlot(index: number, delta: number) {
    const channel = neighborChannel(slotIds[index] || selectedId, delta);
    if (!channel) return;
    setSlotFocus(index);
    setSlotIds((current) => {
      const next = current.slice(0, windowCount);
      while (next.length < windowCount) next.push("");
      next[index] = channel.id;
      return next;
    });
    setSelectedId(channel.id);
    setScreenOpen(true);
  }

  function updateCategoryPrefs(section: CategorySection, next: CategoryPrefs) {
    setCategoryPrefs((current) => {
      const prefs = { ...current, [section]: next };
      saveCategoryPrefs(prefs);
      return prefs;
    });
  }

  function categoryTitle(id: string) {
    if (id === "All" || id === "Favorites") return id;
    if (id.startsWith("playlist:")) {
      const item = playlists.find((playlist) => playlist.id === id.slice("playlist:".length));
      return item ? playlistLabel(item.source) : "Playlist";
    }
    return liveCategories.find((category) => category.id === id)?.label ?? id;
  }

  function toggleFavorite(id: string) {
    setFavorites((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      saveFavorites(next);
      return next;
    });
  }

  const remoteActions = useRef<RemoteActions>(null!);
  remoteActions.current = {
    step: stepChannel,
    recall: recallChannel,
    toggleFavorite: () => {
      if (selected) toggleFavorite(selected.id);
    },
    openGuide: () => {
      setSection("live");
      setFullGuide(true);
    },
    closeGuide: () => setFullGuide(false),
    closeSettings: () => setSettingsOpen(false),
    guideOpen: () => fullGuide,
    settingsOpen: () => settingsOpen,
  };
  useEffect(() => installRemote(() => remoteActions.current), []);

  const landed = useRef(false);
  useEffect(() => {
    if (!booted || landed.current || section !== "live") return;
    const el = document.querySelector<HTMLElement>("[data-zone='channels'] [data-active='true']");
    if (!el) return;
    landed.current = true;
    el.focus({ preventScroll: true });
  });

  function applyCatalog(next: Catalog, nextSource: Source) {
    const library = upsertPlaylist(nextSource);
    setPlaylists(library.playlists);
    setActiveId(library.activeId);
    saveLibrary(library.activeId, library.playlists);
    setLibraries((current) => ({ ...current, [library.activeId]: next }));
    setViewId(library.activeId);
    setCatalog(next);
    setSource(nextSource);
    if (nextSource.mode !== "demo") saveCatalogCache(library.activeId, next);
    guideJobs.current.clear();
    setGuideGeneration((current) => current + 1);
    setSection("live");
    setGroup("All");
    setQuery("");
    setSelectedId(next.channels[0] ? `${library.activeId}::${next.channels[0].id}` : "");
    setFeature({ url: "", title: "" });
    setOpenEpisodes([]);
  }

  async function refreshPlaylist(id: string) {
    const targets = playlists.filter((playlist) => id === "all" || playlist.id === id);
    if (targets.length === 0) return;
    setRefreshing(true);
    try {
      await Promise.all(
        targets.map(async (item) => {
          const previous = libraries[item.id];
          guideJobs.current.delete(`${item.id}|${previous?.epgUrl ?? ""}|${previous?.channels.length ?? 0}`);
          const next =
            item.source.mode === "demo"
              ? demoCatalog()
              : item.source.mode === "m3u"
                ? await loadM3u(item.source.url)
                : await loadXtream(item.source.server, item.source.username, item.source.password);
          if (item.source.mode !== "demo") saveCatalogCache(item.id, next);
          if (next.epgUrl) guideJobs.current.delete(`${item.id}|${next.epgUrl}|${next.channels.length}|${guideGeneration + 1}`);
          setGuideGeneration((current) => current + 1);
          setLibraries((current) => ({ ...current, [item.id]: next }));
          if (item.id === activeId) {
            setCatalog(next);
            setSelectedId((current) =>
              next.channels.some((channel) => `${item.id}::${channel.id}` === current)
                ? current
                : next.channels[0]
                  ? `${item.id}::${next.channels[0].id}`
                  : "",
            );
          }
          if (!next.epgUrl) return;
          void loadEpg(next.epgUrl, next.channels, Date.now(), (channels) => {
            setLibraries((current) => {
              const existing = current[item.id];
              if (!existing) return current;
              const merged = withPrograms(existing.channels, channels);
              if (merged === existing.channels) return current;
              return { ...current, [item.id]: { ...existing, channels: merged } };
            });
            if (item.id === activeId) {
              setCatalog((current) => ({ ...current, channels: withPrograms(current.channels, channels) }));
            }
            setGuideState("live");
          });
        }),
      );
    } catch {
      setSeriesNote("That playlist could not be refreshed.");
    } finally {
      setRefreshing(false);
    }
  }

  async function selectPlaylist(id: string, options?: { keepSettings?: boolean }) {
    const item = playlists.find((playlist) => playlist.id === id);
    if (!item) return;
    setActiveId(id);
    setViewId(id);
    saveLibrary(id, playlists);
    setSource(item.source);
    if (!options?.keepSettings) setSettingsOpen(false);
    setSection("live");
    setGroup("All");
    setQuery("");
    try {
      const next =
        item.source.mode === "demo"
          ? demoCatalog()
          : item.source.mode === "m3u"
            ? await loadM3u(item.source.url)
            : await loadXtream(item.source.server, item.source.username, item.source.password);
      setLibraries((current) => ({ ...current, [item.id]: next }));
      setCatalog(next);
      if (item.source.mode !== "demo") saveCatalogCache(item.id, next);
      guideJobs.current.clear();
      setGuideGeneration((current) => current + 1);
      setSelectedId(next.channels[0] ? `${id}::${next.channels[0].id}` : "");
      setFeature({ url: "", title: "" });
      setOpenEpisodes([]);
    } catch {
      setSeriesNote("That playlist could not be loaded.");
    }
  }

  function commitPlaylist(id: string, nextSource: Source, next: Catalog) {
    const nextList = playlists.map((item) => (item.id === id ? { ...item, source: nextSource } : item));
    setPlaylists(nextList);
    saveLibrary(activeId || id, nextList);
    if (id === activeId) setSource(nextSource);
    if (nextSource.mode !== "demo") saveCatalogCache(id, next);
    setLibraries((current) => ({ ...current, [id]: next }));
    if (id === activeId || viewId === id) {
      setCatalog(next);
      guideJobs.current.clear();
      setGuideGeneration((current) => current + 1);
      setSelectedId((current) =>
        next.channels.some((channel) => `${id}::${channel.id}` === current)
          ? current
          : next.channels[0]
            ? `${id}::${next.channels[0].id}`
            : "",
      );
    }
  }

  function deletePlaylist(id: string) {
    const nextList = playlists.filter((item) => item.id !== id);
    const nextActive = nextList.some((item) => item.id === activeId) ? activeId : (nextList[0]?.id ?? "");
    setPlaylists(nextList);
    setActiveId(nextActive);
    saveLibrary(nextActive, nextList);
    setLibraries((current) => {
      const copy = { ...current };
      delete copy[id];
      return copy;
    });
    if (!nextActive) {
      setSource({ mode: "demo" });
      setCatalog(demoCatalog());
      setViewId("all");
      setSelectedId("bunny");
      return;
    }
    if (nextActive !== activeId) {
      const item = nextList.find((playlist) => playlist.id === nextActive);
      const cached = libraries[nextActive];
      if (item) setSource(item.source);
      setViewId(nextActive);
      if (cached) {
        setCatalog(cached);
        setSelectedId(cached.channels[0] ? `${nextActive}::${cached.channels[0].id}` : "");
      }
    }
  }

  function openSeries(item: Series) {
    const splitAt = item.id.indexOf("::");
    const playlistId = splitAt >= 0 ? item.id.slice(0, splitAt) : "";
    const rawId = splitAt >= 0 ? item.id.slice(splitAt + 2) : item.id;
    const owner = playlists.find((playlist) => playlist.id === playlistId)?.source ?? source;
    setSeriesNote("");
    if (item.episodes) {
      setOpenEpisodes(item.episodes);
      setLoadingSeries("");
      return;
    }
    setOpenEpisodes([]);
    setLoadingSeries(item.id);
    void loadEpisodes(owner, rawId)
      .then((episodes) => {
        setOpenEpisodes(episodes);
        if (episodes.length === 0) setSeriesNote("This series did not list any episodes.");
      })
      .catch((caught: unknown) => {
        setSeriesNote(caught instanceof Error ? caught.message : "Could not load episodes.");
      })
      .finally(() => setLoadingSeries(""));
  }

  const searchPlaceholder =
    searchKind === "categories"
      ? "Search categories in all playlists"
      : section === "live"
        ? "Search channels in all playlists"
        : section === "movies"
          ? "Search movies in all playlists"
          : "Search series in all playlists";

  if (trialEnded) {
    return (
      <main className="flex h-full items-center justify-center bg-black p-8 text-center text-white">
        <p className="max-w-md text-lg">The 3-day TripleA trial on this computer has ended.</p>
      </main>
    );
  }

  return (
    <main className="relative flex h-full min-h-0 flex-col overflow-hidden border-[7px] border-black bg-bg text-fg shadow-[inset_0_0_0_2px_#d4b15a]">
      <header className="flex flex-col gap-1 border-b border-black bg-black px-3 py-1.5 text-white sm:px-4">
        <div className="flex flex-wrap items-center gap-2" data-zone="header" data-flow="row">
          <div className="flex shrink-0 items-center gap-2">
            <img src={logo} alt="" className="h-7 w-auto" />
            <div className="leading-tight">
              <p className="text-xs font-semibold tracking-wide">TripleA</p>
              <p className="text-[10px] text-white/60">IPTV Player</p>
            </div>
          </div>
          {playlists.length > 0 ? (
            <select
              value={playlists.length > 1 ? viewId : playlists[0].id}
              aria-label="Playlist"
              onChange={(event) => {
                const next = event.target.value;
                setGroup("All");
                if (next === "all") {
                  setViewId("all");
                  return;
                }
                void selectPlaylist(next);
              }}
              className="h-8 max-w-[10rem] rounded-ui border border-white/20 bg-[#171e33] px-2 text-xs text-white"
            >
              {playlists.length > 1 ? <option value="all">All playlists</option> : null}
              {playlists.map((item) => (
                <option key={item.id} value={item.id}>
                  {playlistLabel(item.source)}
                </option>
              ))}
            </select>
          ) : null}
          {playlists.length > 0 ? (
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void refreshPlaylist(playlists.length > 1 ? viewId : playlists[0].id)}
              className="h-8 shrink-0 rounded-ui bg-[#14804a] px-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          ) : null}
          <select
            value={player}
            aria-label="Player"
            onChange={(event) => {
              const next = event.target.value as PlayerChoice;
              setPlayer(next);
              setUseVlc(next === "vlc");
              savePlayer(next);
            }}
            className="h-8 shrink-0 rounded-ui border border-white/20 bg-[#171e33] px-2 text-xs font-semibold text-white"
            style={{ colorScheme: "dark" }}
          >
            <option value="mpegts" style={{ backgroundColor: "#171e33", color: "#ffffff" }}>TS</option>
            <option value="vlc" style={{ backgroundColor: "#171e33", color: "#ffffff" }}>VLC</option>
            <option value="hls" style={{ backgroundColor: "#171e33", color: "#ffffff" }}>HLS</option>
            <option value="browser" style={{ backgroundColor: "#171e33", color: "#ffffff" }}>Web</option>
          </select>
          <button
            type="button"
            onClick={() => {
              setSection("live");
              setFullGuide(true);
            }}
            className="h-8 shrink-0 rounded-ui bg-[#2f6bff] px-2 text-xs font-semibold text-white"
          >
            Guide
          </button>
          <label className="relative hidden w-44 sm:block">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-white/70" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 w-full rounded-ui border border-white/20 bg-[#171e33] pr-2 pl-7 text-xs text-white outline-none placeholder:text-white/50 focus:border-[#2f6bff]"
              aria-label={searchPlaceholder}
            />
          </label>
          <select
            value={searchKind}
            aria-label="Search in"
            onChange={(event) => setSearchKind(event.target.value as "channels" | "categories")}
            className="h-8 rounded-ui border border-white/20 bg-[#2f6bff] px-2 text-xs font-semibold text-white"
          >
            <option value="channels">{section === "live" ? "Channels" : "Titles"}</option>
            <option value="categories">Categories</option>
          </select>
          <div className="ml-auto flex items-center gap-2">
            {showClock ? <LiveStamp className="text-xs text-white/85 tabular-nums" /> : null}
            {trialNote ? <span className="text-[10px] font-semibold text-[#ffe08a]">{trialNote}</span> : null}
            {hideInstalls ? null : (
              <>
            <a
              href={previewAsset("/TripleA-IPTV-Setup.exe?v=7")}
              download="TripleA-IPTV-Setup.exe"
              data-tv-skip
              className="flex h-4 shrink-0 items-center rounded px-0.5 text-[8px] leading-none font-medium text-white bg-[#2f6bff]"
            >
              Windows
            </a>
            <a
              href={previewAsset("/TripleA-Mac-Setup.command")}
              download="TripleA-Mac-Setup.command"
              data-tv-skip
              className="flex h-4 shrink-0 items-center rounded px-0.5 text-[8px] leading-none font-medium text-white bg-[#1aa6c4]"
            >
              Mac
            </a>
            <a
              href={previewAsset("/TripleA-IPTV.apk?v=16")}
              download="TripleA-IPTV.apk"
              data-tv-skip
              className="flex h-4 shrink-0 items-center rounded px-0.5 text-[8px] leading-none font-medium text-white bg-[#e07a14]"
            >
              Fire TV
            </a>
            <a
              href={previewAsset("/afrobeat.mp4?v=4")}
              download="Sika-Kokoo.mp4"
              data-tv-skip
              className="flex h-4 shrink-0 items-center rounded px-0.5 text-[8px] leading-none font-medium text-white bg-[#c43b6e]"
            >
              Video
            </a>
            <a
              href={previewAsset("/twi-practice.wav?v=1")}
              download="Twi-practice.wav"
              data-tv-skip
              className="flex h-4 shrink-0 items-center rounded px-0.5 text-[8px] leading-none font-medium text-white bg-[#14804a]"
            >
              Twi
            </a>
            <a
              href={previewAsset("/shorts/Gold-on-the-Roof-Short.mp4?v=1")}
              download="Gold-on-the-Roof-Short.mp4"
              data-tv-skip
              className="flex h-4 shrink-0 items-center rounded px-0.5 text-[8px] leading-none font-medium text-white bg-[#d4b15a]"
            >
              Short EN
            </a>
            <a
              href={previewAsset("/shorts/Sika-Kokoo-Short.mp4?v=1")}
              download="Sika-Kokoo-Short.mp4"
              data-tv-skip
              className="flex h-4 shrink-0 items-center rounded px-0.5 text-[8px] leading-none font-medium text-white bg-[#b8860b]"
            >
              Short Twi
            </a>
            <a
              href={previewAsset("/Do-You-Know-Who-I-Am.mp4?v=2")}
              download="Do-You-Know-Who-I-Am.mp4"
              data-tv-skip
              className="flex h-4 shrink-0 items-center rounded px-0.5 text-[8px] leading-none font-medium text-white bg-[#6b4cff]"
            >
              Joke
            </a>
            <a
              href={previewAsset("/Wo-Adom-Nti.mp4?v=6")}
              download="Wo-Adom-Nti.mp4"
              data-tv-skip
              className="flex h-4 shrink-0 items-center rounded px-0.5 text-[8px] leading-none font-medium text-white bg-[#1f8a4c]"
            >
              Song
            </a>
            <a
              href={previewAsset("/Tomorrow-Starts-Today.mp4?v=8")}
              download="Tomorrow-Starts-Today.mp4"
              data-tv-skip
              className="flex h-4 shrink-0 items-center rounded px-0.5 text-[8px] leading-none font-medium text-white bg-[#e07a2f]"
            >
              Choir
            </a>
              </>
            )}
            <button
              type="button"
              className="flex size-8 shrink-0 items-center justify-center rounded-ui bg-[#7a3ff0] text-white"
              onClick={() => setSettingsOpen(true)}
              aria-label="Sources and settings"
            >
              <Settings className="size-4" />
            </button>
          </div>
        </div>
      </header>

      <label className="relative mx-3 mt-3 sm:hidden">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-8 w-full rounded-ui border border-line bg-panel pr-2 pl-7 text-xs outline-none placeholder:text-muted focus:border-accent"
          aria-label={searchPlaceholder}
        />
      </label>

      <div
        className={
          section === "live"
            ? "flex gap-1 border-b border-black bg-black px-3 py-2 sm:hidden"
            : "flex gap-1 border-b border-black bg-black px-3 py-2"
        }
        data-zone="tabs"
        data-flow="row"
        role="tablist"
        aria-label="Library"
      >
        {(
          [
            ["live", "Live"],
            ["movies", "Movies"],
            ["series", "Series"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            onClick={() => {
              setSection(id);
              setGroup("All");
            }}
            className={
              id === "movies"
                ? section === id
                  ? "h-11 flex-1 rounded-ui bg-[#7a3ff0] text-sm font-medium text-white sm:flex-none sm:px-4"
                  : "h-11 flex-1 rounded-ui bg-[#7a3ff0]/70 text-sm text-white sm:flex-none sm:px-4"
                : id === "series"
                  ? section === id
                    ? "h-11 flex-1 rounded-ui bg-[#14804a] text-sm font-medium text-white sm:flex-none sm:px-4"
                    : "h-11 flex-1 rounded-ui bg-[#14804a]/70 text-sm text-white sm:flex-none sm:px-4"
                  : section === id
                    ? "h-11 flex-1 rounded-ui bg-[#2f6bff] text-sm font-medium text-white sm:flex-none sm:px-4"
                    : "h-11 flex-1 rounded-ui bg-[#2f6bff]/70 text-sm text-white sm:flex-none sm:px-4"
            }
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={section === "songs"}
          onClick={() => setSection("songs")}
          className={
            section === "songs"
              ? "h-11 flex-1 rounded-ui bg-[#e07a2f] text-sm font-medium text-white sm:flex-none sm:px-4"
              : "h-11 flex-1 rounded-ui bg-[#e07a2f]/70 text-sm text-white sm:flex-none sm:px-4"
          }
        >
          Songs
        </button>
      </div>

      <div className={section === "live" ? "grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_auto_minmax(0,1fr)] sm:grid-cols-[7.75rem_11.5rem_minmax(0,1fr)] sm:grid-rows-[auto_minmax(0,1fr)]" : "hidden"}>
          <div className="hidden items-center gap-1 border-b border-black bg-black px-2 py-1.5 sm:col-span-2 sm:row-start-1 sm:flex" role="tablist" aria-label="Library" data-zone="tabs" data-flow="row">
            {(
              [
                ["live", "Live"],
                ["movies", "Movies"],
                ["series", "Series"],
              ] as const
            ).map(([id, label]) => {
              const selected = section === id;
              return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  setSection(id);
                  setGroup("All");
                }}
                className={
                  id === "movies"
                    ? selected
                      ? "h-9 rounded-ui bg-[#7a3ff0] px-3 text-sm font-medium text-white"
                      : "h-9 rounded-ui bg-[#7a3ff0]/70 px-3 text-sm text-white"
                    : id === "series"
                      ? selected
                        ? "h-9 rounded-ui bg-[#14804a] px-3 text-sm font-medium text-white"
                        : "h-9 rounded-ui bg-[#14804a]/70 px-3 text-sm text-white"
                      : selected
                        ? "h-9 rounded-ui bg-[#2f6bff] px-3 text-sm font-medium text-white"
                        : "h-9 rounded-ui bg-[#2f6bff]/70 px-3 text-sm text-white"
                }
              >
                {label}
              </button>
              );
            })}
            <button
              type="button"
              role="tab"
              aria-selected={section === "songs"}
              onClick={() => setSection("songs")}
              className={
                section === "songs"
                  ? "h-9 rounded-ui bg-[#e07a2f] px-3 text-sm font-medium text-white"
                  : "h-9 rounded-ui bg-[#e07a2f]/70 px-3 text-sm text-white"
              }
            >
              Songs
            </button>
          </div>
          <nav className="panel-frame hidden min-h-0 flex-col gap-0.5 overflow-y-auto bg-[#12182c] p-1 text-white sm:col-start-1 sm:row-start-2 sm:flex" aria-label="Groups" data-zone="groups" data-flow="column">
            {groups.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setGroup(name)}
                className={
                  name === group
                    ? "rounded-ui bg-accent px-1.5 py-1 text-left text-[13px] leading-tight font-medium text-white"
                    : "rounded-ui px-1.5 py-1 text-left text-[13px] leading-tight text-white/90 hover:bg-white/10 hover:text-white"
                }
              >
                {categoryTitle(name)}
                {name === "Favorites" ? ` (${favorites.length})` : ""}
              </button>
            ))}
          </nav>

          <div className="flex gap-2 overflow-x-auto px-3 py-2 sm:hidden">
            {groups.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setGroup(name)}
                className={
                  name === group
                    ? "shrink-0 rounded-full bg-accent px-3 py-2 text-sm text-white"
                    : "shrink-0 rounded-full bg-panel px-3 py-2 text-sm text-muted"
                }
              >
                {categoryTitle(name)}
              </button>
            ))}
          </div>

          <div className="stage-dark grid h-full min-h-0 sm:col-start-3 sm:row-span-2 sm:row-start-1 sm:grid-cols-[minmax(0,1fr)_6.5rem] sm:grid-rows-[minmax(0,1fr)_4.5rem] sm:border-l sm:border-line">
          <section className="relative h-full min-h-56 overflow-hidden sm:col-start-1 sm:row-start-1 sm:min-h-0">
            {windowCount > 1 ? (
              <div
                className="grid h-full min-h-0 bg-black"
                style={
                  windowCount === 2
                    ? { gridTemplateColumns: `${splitX}fr 8px ${100 - splitX}fr`, gridTemplateRows: "minmax(0,1fr)" }
                    : {
                        gridTemplateColumns: `${splitX}fr 8px ${100 - splitX}fr`,
                        gridTemplateRows: `${splitY}fr 8px ${100 - splitY}fr`,
                      }
                }
              >
                {Array.from({ length: windowCount }, (_, index) => {
                  const id = slotIds[index] || (index === slotFocus ? selected?.id : "") || "";
                  const channel = channels.find((item) => item.id === id);
                  const focused = index === slotFocus;
                  const place =
                    windowCount === 2
                      ? { gridColumn: index === 0 ? 1 : 3, gridRow: 1 }
                      : windowCount === 3
                        ? index === 2
                          ? { gridColumn: "1 / -1", gridRow: 3 }
                          : { gridColumn: index === 0 ? 1 : 3, gridRow: 1 }
                        : { gridColumn: index % 2 === 0 ? 1 : 3, gridRow: index < 2 ? 1 : 3 };
                  return (
                    <div
                      key={index}
                      style={place}
                      className={"relative min-h-0 overflow-hidden " + (focused ? "ring-2 ring-[#ffe08a] ring-inset" : "")}
                      onClick={() => focusSlot(index)}
                    >
                      {channel ? (
                        <PreviewPlayer
                          url={channel.url}
                          title={channel.name}
                          ownVolume
                          initialVolume={currentVolume()}
                          onVolume={(value) => heard.current.set(channel.url, value)}
                          onPrevious={() => stepSlot(index, -1)}
                          onNext={() => stepSlot(index, 1)}
                          onRecall={recallChannel}
                          onClose={() => setScreenOpen(false)}
                          onPin={() => togglePin(channel.url, channel.name, channel.id)}
                          pinned={pins.some((pin) => pin.url === channel.url)}
                          vlc={useVlc}
                          player={player}
                        />
                      ) : (
                        <button type="button" className="flex h-full w-full items-center justify-center bg-black px-3 text-center text-sm text-white" onClick={() => focusSlot(index)}>
                          Window {index + 1}. Choose a channel.
                        </button>
                      )}
                      <span className="pointer-events-none absolute top-8 right-2 z-30 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        {index + 1}
                      </span>
                    </div>
                  );
                })}
                <PaneSplit axis="x" onDrag={setSplitX} style={windowCount === 3 ? { gridColumn: 2, gridRow: 1 } : { gridColumn: 2, gridRow: "1 / -1" }} />
                {windowCount > 2 ? <PaneSplit axis="y" onDrag={setSplitY} style={{ gridColumn: "1 / -1", gridRow: 2 }} /> : null}
              </div>
            ) : selected && screenOpen && !pins.some((pin) => pin.url === selected.url) ? (
              <div className="absolute inset-0">
                <PreviewPlayer
                  url={selected.url}
                  title={selected.name}
                  onPrevious={() => stepChannel(-1)}
                  onNext={() => stepChannel(1)}
                  onRecall={recallChannel}
                  onClose={() => setScreenOpen(false)}
                  onPin={() => togglePin(selected.url, selected.name, selected.id)}
                  pinned={pins.some((pin) => pin.url === selected.url)}
                  vlc={useVlc}
                  player={player}
                  onVolume={(value) => heard.current.set(selected.url, value)}
                />
                <div className="pointer-events-none absolute bottom-8 left-2 z-20 max-w-[70%] rounded bg-bg/70 px-2 py-1 sm:hidden">
                  <p className="truncate text-[10px] tracking-wide text-accent uppercase">
                    {selected?.playlistName || playlistLabel(source)}
                  </p>
                  <h1 className="truncate text-xs font-semibold">{onNow?.title ? channelTitle(onNow.title) : channelTitle(selected?.name ?? "") || "TripleA"}</h1>
                  <p className="truncate text-[10px] text-muted">
                    {selected ? `${selected.number}  ${channelTitle(selected.name)}` : "No channel"}
                  </p>
                </div>
              </div>
            ) : selected && pins.some((pin) => pin.url === selected.url) ? (
              <button
                type="button"
                className="m-2 flex h-11 items-center rounded-ui bg-panel px-4 text-sm font-medium"
                onClick={() => {
                  const pin = pins.find((item) => item.url === selected.url);
                  if (pin) closePin(pin);
                }}
              >
                Show this channel on the main screen
              </button>
            ) : selected ? (
              <button
                type="button"
                className="m-2 flex h-11 items-center rounded-ui bg-panel px-4 text-sm font-medium"
                onClick={() => setScreenOpen(true)}
              >
                Open screen
              </button>
            ) : null}
          </section>
          <aside className="panel-frame hidden min-h-0 flex-col gap-1 overflow-y-auto p-1.5 sm:col-start-2 sm:row-start-1 sm:flex" aria-label="Program description">
            <p className="text-[9px] tracking-wide text-accent uppercase">{selected?.playlistName || playlistLabel(source)}</p>
            <p className="text-[10px] leading-tight text-muted">{selected ? `${selected.number}  ${channelTitle(selected.name)}` : "No channel"}</p>
            <h1 className="text-[11px] leading-snug font-semibold">{onNow?.title ? channelTitle(onNow.title) : channelTitle(selected?.name ?? "") || "TripleA"}</h1>
            {onNow ? (
              <p className="text-[9px] text-muted">
                {formatTime(onNow.start)} – {formatTime(onNow.end)}
              </p>
            ) : null}
            <p className="text-[9px] leading-snug font-bold text-muted">{onNow?.description || "No description for this program."}</p>
            {coming ? (
              <p className="text-[10px] leading-snug">
                <span className="text-muted">Next </span>
                {coming.title}
              </p>
            ) : null}
          </aside>

          <section className="panel-frame h-full min-h-0 overflow-auto sm:col-span-2 sm:row-start-2" data-zone="guide" data-flow="column">
            <Guide
              channels={visible}
              now={now}
              windowStart={windowStart}
              guideState={guideState}
              selectedId={selected?.id}
              onSelect={(id) => {
                setSelectedId(id);
                setScreenOpen(true);
              }}
            />
          </section>
          </div>

          <section className="panel-frame channel-list min-h-0 overflow-y-auto bg-[#1636b0] text-white sm:col-start-2 sm:row-start-2 dark:bg-[#12182c]" aria-label="Channels" data-zone="channels" data-flow="column">
            {visible.length === 0 ? (
              <p className="p-4 text-sm text-white/80">{booted ? "No channels in this group." : "Loading channels…"}</p>
            ) : (
              <ul>
                {visible.map((channel) => {
                  const active = channel.id === selected?.id;
                  const program = currentProgram(channel, now);
                  return (
                    <li
                      key={channel.id}
                      className={active ? "channel-on flex items-stretch bg-white text-[#1636b0] dark:bg-[#2f6bff] dark:text-white" : "flex items-stretch hover:bg-white/15"}
                    >
                      <button
                        type="button"
                        data-tv-main
                        data-active={active ? "true" : "false"}
                        onClick={() => {
                          setSelectedId(channel.id);
                          setScreenOpen(true);
                        }}
                        className="flex min-w-0 flex-1 items-center gap-1 px-1 py-0.5 text-left"
                      >
                        <span className={active ? "w-7 shrink-0 text-[12px] leading-tight text-[#1636b0]/70 tabular-nums dark:text-white/70" : "w-7 shrink-0 text-[12px] leading-tight text-white/70 tabular-nums"}>
                          {channel.number}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={active ? "block truncate text-[13px] leading-tight font-semibold text-[#1636b0] dark:text-white" : "block truncate text-[13px] leading-tight font-semibold text-white"}>
                            {channelTitle(channel.name)}
                          </span>
                          {program?.title ? (
                            <span className={active ? "block truncate text-[11px] leading-tight text-[#1636b0]/70 dark:text-white/80" : "block truncate text-[11px] leading-tight text-white/75"}>
                              {channelTitle(program.title)}
                            </span>
                          ) : null}
                        </span>
                      </button>
                      <button
                        type="button"
                        data-tv-side
                        data-tv-skip
                        aria-pressed={favorites.includes(channel.id)}
                        aria-label={favorites.includes(channel.id) ? "Remove favorite" : "Add favorite"}
                        className="flex size-5 shrink-0 items-center justify-center"
                        onClick={() => toggleFavorite(channel.id)}
                      >
                        <Star
                          className={
                            favorites.includes(channel.id)
                              ? "size-3 fill-[#f0d78c] text-[#f0d78c]"
                              : active
                                ? "size-3 text-[#1636b0]/60 dark:text-white/80"
                                : "size-3 text-white/70"
                          }
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      {section === "songs" ? (
        <div className="min-h-0 flex-1 overflow-y-auto bg-black px-4 py-4 text-white">
          <h1 className="text-lg font-semibold">Songs</h1>
          <p className="mt-1 text-sm text-white/70">Play a video here, or download it.</p>
          <div className="mt-4 grid max-w-3xl gap-8">
            <article>
              <h2 className="text-base font-semibold">Africa Unity 1</h2>
              <p className="mt-1 text-sm text-white/70">One Africa, one rhythm.</p>
              <video controls playsInline src={previewAsset("/Africa-Unity-1.mp4?v=2")} className="mt-2 max-h-[520px] w-full bg-black" />
              <a href={previewAsset("/Africa-Unity-1.mp4?v=2")} download="Africa-Unity-1.mp4" className="mt-2 inline-flex h-9 items-center rounded-ui bg-[#d4a017] px-3 text-sm font-semibold text-black">Download short 1</a>
            </article>
            <article>
              <h2 className="text-base font-semibold">Africa Unity 2</h2>
              <p className="mt-1 text-sm text-white/70">Hand in hand.</p>
              <video controls playsInline src={previewAsset("/Africa-Unity-2.mp4?v=2")} className="mt-2 max-h-[520px] w-full bg-black" />
              <a href={previewAsset("/Africa-Unity-2.mp4?v=2")} download="Africa-Unity-2.mp4" className="mt-2 inline-flex h-9 items-center rounded-ui bg-[#d4a017] px-3 text-sm font-semibold text-black">Download short 2</a>
            </article>
            <article>
              <h2 className="text-base font-semibold">Africa Unity 3</h2>
              <p className="mt-1 text-sm text-white/70">Feel the drum.</p>
              <video controls playsInline src={previewAsset("/Africa-Unity-3.mp4?v=2")} className="mt-2 max-h-[520px] w-full bg-black" />
              <a href={previewAsset("/Africa-Unity-3.mp4?v=2")} download="Africa-Unity-3.mp4" className="mt-2 inline-flex h-9 items-center rounded-ui bg-[#d4a017] px-3 text-sm font-semibold text-black">Download short 3</a>
            </article>
            <article>
              <h2 className="text-base font-semibold">Galamsey</h2>
              <p className="mt-1 text-sm text-white/70">A short about Ghana’s rivers.</p>
              <video controls playsInline src={previewAsset("/Galamsey.mp4?v=2")} className="mt-2 max-h-[520px] w-full bg-black" />
              <a href={previewAsset("/Galamsey.mp4?v=2")} download="Galamsey.mp4" className="mt-2 inline-flex h-9 items-center rounded-ui bg-[#c4552a] px-3 text-sm font-semibold text-white">Download the short</a>
            </article>
            <article>
              <h2 className="text-base font-semibold">Christmas dey Ghana</h2>
              <p className="mt-1 text-sm text-white/70">One long Afrobeat. Hook: move your body.</p>
              <video controls playsInline src={previewAsset("/Christmas-dey-Ghana.mp4?v=2")} className="mt-2 max-h-[520px] w-full bg-black" />
              <a href={previewAsset("/Christmas-dey-Ghana.mp4?v=2")} download="Christmas-dey-Ghana.mp4" className="mt-2 inline-flex h-9 items-center rounded-ui bg-[#1f7a4d] px-3 text-sm font-semibold text-white">Download the song</a>
            </article>
            <article>
              <h2 className="text-base font-semibold">How to solve a quadratic</h2>
              <p className="mt-1 text-sm text-white/70">A short lively lesson, with pictures.</p>
              <video
                controls
                playsInline
                src={previewAsset("/Quadratic.mp4?v=1")}
                className="mt-2 w-full bg-black"
              />
              <a
                href={previewAsset("/Quadratic.mp4?v=1")}
                download="Quadratic.mp4"
                className="mt-2 inline-flex h-9 items-center rounded-ui bg-[#5b4dff] px-3 text-sm font-semibold text-white"
              >
                Download the lesson
              </a>
            </article>
            <article>
              <h2 className="text-base font-semibold">Tomorrow Starts Today</h2>
              <video
                controls
                playsInline
                src={previewAsset("/Tomorrow-Starts-Today.mp4?v=8")}
                className="mt-2 w-full bg-black"
              />
              <a
                href={previewAsset("/Tomorrow-Starts-Today.mp4?v=8")}
                download="Tomorrow-Starts-Today.mp4"
                className="mt-2 inline-flex h-9 items-center rounded-ui bg-[#e07a2f] px-3 text-sm font-semibold text-white"
              >
                Download choir video
              </a>
            </article>
            <article>
              <h2 className="text-base font-semibold">Wo Adom Nti</h2>
              <video
                controls
                playsInline
                src={previewAsset("/Wo-Adom-Nti.mp4?v=6")}
                className="mt-2 max-h-[480px] w-full bg-black"
              />
              <a
                href={previewAsset("/Wo-Adom-Nti.mp4?v=6")}
                download="Wo-Adom-Nti.mp4"
                className="mt-2 inline-flex h-9 items-center rounded-ui bg-[#1f8a4c] px-3 text-sm font-semibold text-white"
              >
                Download song video
              </a>
            </article>
          </div>
        </div>
      ) : null}
      {openedSections.movies ? (
        <div className={section === "movies" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <TitleShelf
            kind="movies"
            items={movieTitles}
            categories={movieCategories}
            query=""
            favorites={favorites}
            episodes={openEpisodes}
            loadingId={loadingSeries}
            note={seriesNote}
            playingUrl={section === "movies" ? feature.url : ""}
            playingTitle={feature.title}
            onToggleFavorite={toggleFavorite}
            onPlay={(url, title) => setFeature({ url, title })}
            onOpen={openSeries}
            onPin={togglePin}
            pinnedUrls={pins.map((pin) => pin.url)}
            vlc={useVlc}
            player={player}
          />
        </div>
      ) : null}
      {openedSections.series ? (
        <div className={section === "series" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <TitleShelf
            kind="series"
            items={seriesTitles}
            categories={seriesCategories}
            query=""
            favorites={favorites}
            episodes={openEpisodes}
            loadingId={loadingSeries}
            note={seriesNote}
            playingUrl={section === "series" ? feature.url : ""}
            playingTitle={feature.title}
            onToggleFavorite={toggleFavorite}
            onPlay={(url, title) => setFeature({ url, title })}
            onOpen={openSeries}
            onPin={togglePin}
            pinnedUrls={pins.map((pin) => pin.url)}
            vlc={useVlc}
            player={player}
          />
        </div>
      ) : null}

      {typeof document === "undefined" || externalPip
        ? null
        : createPortal(
            pins.map((pin, index) => (
              <PreviewPlayer
                key={pin.url}
                url={pin.url}
                title={pin.title}
                floatIndex={index}
                initialVolume={pin.volume}
                vlc={useVlc}
                player={player}
                onPrevious={() => tunePin(pin.url, -1)}
                onNext={() => tunePin(pin.url, 1)}
                onRecall={() => recallPin(pin.url)}
                onClose={() => closePin(pin)}
              />
            )),
            document.body,
          )}

      {settingsOpen ? (
        <SettingsDialog
          source={source}
          playlists={playlists}
          activeId={activeId}
          libraries={libraries}
          catalog={catalog}
          categorySection={categorySection}
          categoryPrefs={categoryPrefs[categorySection]}
          fontSize={fontSize}
          onFontSize={(next) => {
            setFontSize(next);
            saveFontSize(next);
          }}
          player={player}
          onPlayer={(next) => {
            setPlayer(next);
            setUseVlc(next === "vlc");
            savePlayer(next);
          }}
          windowCount={windowCount}
          onWindowCount={(count) => {
            const next = count < 1 ? 1 : count > 4 ? 4 : count;
            setWindowCount(next);
            setSlotFocus(0);
            localStorage.setItem(WINDOWS_KEY, String(next));
          }}
          groupByPlaylist={groupByPlaylist}
          onGroupByPlaylist={(value) => {
            setGroupByPlaylist(value);
            localStorage.setItem(GROUP_LISTS_KEY, value ? "1" : "0");
            setGroup("All");
          }}
          showClock={showClock}
          onShowClock={(value) => {
            setShowClock(value);
            localStorage.setItem(CLOCK_KEY, value ? "1" : "0");
          }}
          dark={dark}
          onDark={(value) => {
            setDark(value);
            localStorage.setItem(THEME_KEY, value ? "1" : "0");
          }}
          refreshing={refreshing}
          onCategorySection={setCategorySection}
          onCategoryPrefs={(next) => updateCategoryPrefs(categorySection, next)}
          onClose={() => setSettingsOpen(false)}
          onApply={applyCatalog}
          onUpdate={commitPlaylist}
          onDelete={deletePlaylist}
          onUse={(id) => void selectPlaylist(id)}
          onRefreshAll={() => void refreshPlaylist("all")}
        />
      ) : null}
      {fullGuide && section === "live" ? (
        <div className="pointer-events-auto absolute top-auto right-2 bottom-8 left-2 z-40 flex h-[52%] flex-col overflow-hidden rounded-ui border border-line bg-bg/95 shadow-2xl sm:top-14 sm:right-auto sm:h-auto sm:w-[min(62%,calc(100%-20rem))]" data-modal data-zone="fullguide" data-flow="column">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <h2 className="text-sm font-semibold">Full guide</h2>
            {playlists.length > 0 ? (
              <select
                value={playlists.length > 1 ? viewId : playlists[0].id}
                aria-label="Guide playlist"
                onChange={(event) => {
                  const next = event.target.value;
                  setGroup("All");
                  if (next === "all") {
                    setViewId("all");
                    return;
                  }
                  void selectPlaylist(next);
                }}
                className="h-8 max-w-[11rem] rounded-ui border border-line bg-panel px-2 text-xs"
              >
                {playlists.length > 1 ? <option value="all">All playlists</option> : null}
                {playlists.map((item) => (
                  <option key={item.id} value={item.id}>
                    {playlistLabel(item.source)}
                  </option>
                ))}
              </select>
            ) : null}
            <select
              value={groups.includes(group) ? group : "All"}
              aria-label="Guide category"
              onChange={(event) => setGroup(event.target.value)}
              className="h-8 max-w-[12rem] rounded-ui border border-line bg-panel px-2 text-xs"
            >
              {groups.map((name) => (
                <option key={name} value={name}>
                  {categoryTitle(name)}
                  {name === "Favorites" ? ` (${favorites.length})` : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setFullGuide(false)}
              className="ml-auto h-8 rounded-ui bg-panel-2 px-3 text-xs font-semibold"
            >
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <Guide
              channels={visible}
              now={now}
              windowStart={windowStart}
              span={FULL_GUIDE_MS}
              guideState={guideState}
              selectedId={selected?.id}
              onSelect={(id) => {
                setSelectedId(id);
                setScreenOpen(true);
              }}
            />
          </div>
        </div>
      ) : null}
      <div className="flex h-6 shrink-0 items-center gap-2 border-t border-line bg-panel px-2" data-zone="footer" data-flow="row">
        <button
          type="button"
          className="flex size-5 shrink-0 items-center justify-center text-fg"
          onClick={() => toggleSharedMute()}
          aria-label={volume === 0 ? "Unmute" : "Mute"}
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
            onChange={(event) => publishVolume(Number(event.target.value))}
          />
        </label>
      </div>
    </main>
  );
}

function Guide({
  channels,
  now,
  windowStart,
  span = WINDOW_MS,
  guideState,
  selectedId,
  onSelect,
}: {
  channels: Channel[];
  now: number;
  windowStart: number;
  span?: number;
  guideState: "sample" | "loading" | "live" | "empty";
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const hours = Math.max(1, Math.round(span / (60 * 60 * 1000)));
  const ticks = Array.from({ length: hours + 1 }, (_, hour) => windowStart + hour * 60 * 60 * 1000);
  const clock = now > 0 ? now : 0;
  const title =
    guideState === "live" ? "Guide" : guideState === "loading" ? "Loading guide" : guideState === "empty" ? "No listing" : "Sample guide";
  const nowLeft = clock > 0 ? ((clock - windowStart) / span) * 100 : -1;
  return (
    <div className={span > WINDOW_MS ? "min-w-[72rem]" : "min-w-[34rem]"}>
      <div className="sticky top-0 z-20 grid grid-cols-[5.5rem_minmax(0,1fr)] border-b border-line bg-panel text-[9px] text-muted">
        <span className="sticky left-0 bg-panel px-1.5 py-0.5">{title}</span>
        <div className="relative h-4">
          {ticks.map((mark) => (
            <span key={mark} className="absolute top-1 whitespace-nowrap" style={{ left: `${((mark - windowStart) / span) * 100}%` }}>
              {formatTime(mark)}
            </span>
          ))}
        </div>
      </div>
      <ul>
        {channels.map((channel) => (
          <li key={channel.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)] border-b border-line">
            <button
              type="button"
              className={
                channel.id === selectedId
                  ? "sticky left-0 truncate bg-panel px-1.5 py-0.5 text-left text-[9px] leading-tight font-medium text-fg"
                  : "sticky left-0 truncate bg-bg px-1.5 py-0.5 text-left text-[9px] leading-tight text-muted"
              }
              onClick={() => onSelect(channel.id)}
            >
              {channelTitle(channel.name)}
            </button>
            <div className="relative h-5">
              {(() => {
                const listed = programsFor(channel, clock);
                const blocks = listed.filter(
                  (program) => program.end > windowStart && program.start < windowStart + span,
                );
                const nearest =
                  blocks.length > 0
                    ? null
                    : (listed.find((program) => program.end > clock) ?? listed[listed.length - 1]);
                if (!nearest && blocks.length === 0) {
                  return (
                    <span className="absolute inset-y-0.5 right-1 left-1 flex items-center rounded-md bg-panel-2 px-1 text-[9px] text-muted">
                      No listing
                    </span>
                  );
                }
                const shown = blocks.length > 0 ? blocks : nearest ? [nearest] : [];
                return shown.map((program) => {
                  const start = Math.max(program.start, windowStart);
                  const end = Math.min(program.end, windowStart + span);
                  const left = blocks.length > 0 ? ((start - windowStart) / span) * 100 : 0;
                  const width = blocks.length > 0 ? Math.max(0, ((end - start) / span) * 100) : 100;
                  const live = program.start <= clock && clock < program.end;
                  return (
                    <button
                      key={program.id}
                      type="button"
                      onClick={() => onSelect(channel.id)}
                      className={
                        live
                          ? "absolute top-0.5 bottom-0.5 flex items-center overflow-hidden rounded-md bg-accent px-1 text-left text-[9px] leading-none text-fg"
                          : "absolute top-0.5 bottom-0.5 flex items-center overflow-hidden rounded-md bg-panel-2 px-1 text-left text-[9px] leading-none text-muted"
                      }
                      style={{ left: `${left}%`, width: `calc(${width}% - 3px)` }}
                      title={`${program.title}${program.description ? ` — ${program.description}` : ""}`}
                    >
                      <span className="truncate">{program.title}</span>
                    </button>
                  );
                });
              })()}
              {nowLeft >= 0 && nowLeft <= 100 ? (
                <span className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-live" style={{ left: `${nowLeft}%` }} aria-hidden="true" />
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
