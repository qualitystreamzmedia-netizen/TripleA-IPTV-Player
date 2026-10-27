import { previewAsset } from "@/lib/preview-path-prefix";

export type Program = {
  id: string;
  title: string;
  start: number;
  end: number;
  description: string;
};

export type Channel = {
  id: string;
  name: string;
  group: string;
  number: number;
  url: string;
  programs: Program[];
  epgId?: string;
  epgName?: string;
  guide?: "epg" | "sample" | "none";
  playlistName?: string;
};

export type Movie = {
  id: string;
  name: string;
  group: string;
  plot: string;
  poster?: string;
  url: string;
};

export type Episode = {
  id: string;
  title: string;
  season: number;
  number: number;
  url: string;
  image?: string;
  seasonImage?: string;
};

export type Series = {
  id: string;
  name: string;
  group: string;
  plot: string;
  poster?: string;
  episodes?: Episode[];
};

export type Catalog = {
  channels: Channel[];
  movies: Movie[];
  series: Series[];
  epgUrl?: string;
};

export type Source =
  | { mode: "demo" }
  | { mode: "m3u"; url: string; name?: string }
  | { mode: "xtream"; server: string; username: string; password: string; name?: string };

const BLOCK = 30 * 60 * 1000;
const STORAGE_KEY = "triplea-iptv-v1";

const SHOWS: Record<string, string[]> = {
  Film: ["Open Reel", "Night Drive", "Second Feature", "Short Subject", "Late Matinee", "Studio Loop"],
  Sport: ["Match Window", "Training Tape", "Highlight Reel", "Court Side", "Lap Times", "Locker Room"],
  News: ["Desk Brief", "Field Note", "Hourly Update", "City Wire", "Weather Slot", "Late Bulletin"],
  Science: ["Orbit Watch", "Lab Hour", "Signal Check", "Deep Field", "Test Pattern", "Mission Loop"],
  Music: ["Session", "Live Room", "Night Shift", "Acoustic Set", "Backline", "Encore"],
  General: ["On Air", "Continuity", "Open Slot", "Station ID", "Feature", "Replay"],
};

function hash(value: string): number {
  let n = 0;
  for (let i = 0; i < value.length; i++) n = (n * 33 + value.charCodeAt(i)) >>> 0;
  return n;
}

export function guidePrograms(channelId: string, group: string, now = Date.now()): Program[] {
  const titles = SHOWS[group] ?? SHOWS.General;
  const origin = now - (now % BLOCK) - BLOCK;
  const salt = hash(channelId);
  const programs: Program[] = [];
  for (let i = 0; i < 12; i++) {
    const start = origin + i * BLOCK;
    const title = titles[(i + salt) % titles.length];
    programs.push({
      id: `${channelId}-${start}`,
      title,
      start,
      end: start + BLOCK,
      description:
        group === "General"
          ? "No programme guide came with this playlist. This slot is a local placeholder."
          : `${title}. Sample guide so the timeline stays readable. Your provider's EPG replaces this when it sends one.`,
    });
  }
  return programs;
}

const DEMO_SEED: Array<Omit<Channel, "programs" | "number">> = [
  {
    id: "bunny",
    name: "Big Buck Bunny",
    group: "Film",
    url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
  },
  {
    id: "tears",
    name: "Tears of Steel",
    group: "Film",
    url: "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8",
  },
  {
    id: "dark",
    name: "Dark Truths",
    group: "Film",
    url: "https://storage.googleapis.com/shaka-demo-assets/bbb-dark-truths-hls/hls.m3u8",
  },
  {
    id: "angel",
    name: "Angel One",
    group: "Music",
    url: "https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8",
  },
  {
    id: "bipbop",
    name: "Bipbop",
    group: "News",
    url: "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8",
  },
  {
    id: "bipbop-wide",
    name: "Bipbop Wide",
    group: "News",
    url: "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8",
  },
  {
    id: "pattern",
    name: "Test Pattern",
    group: "Science",
    url: "https://test-streams.mux.dev/test_001/stream.m3u8",
  },
  {
    id: "nasa",
    name: "NASA TV",
    group: "Science",
    url: "https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8",
  },
  {
    id: "shift",
    name: "Timing Reel",
    group: "Sport",
    url: "https://test-streams.mux.dev/pts_shift/master.m3u8",
  },
  {
    id: "break",
    name: "Break Sample",
    group: "Sport",
    url: "https://test-streams.mux.dev/dai-discontinuity-deltatre/manifest.m3u8",
  },
];

export function demoChannels(now = Date.now()): Channel[] {
  return DEMO_SEED.map((channel, index) => ({
    ...channel,
    number: index + 1,
    programs: guidePrograms(channel.id, channel.group, now),
    guide: "sample",
  }));
}

export function demoCatalog(now = Date.now()): Catalog {
  const channels = demoChannels(now);
  const films = channels.filter((channel) => channel.group === "Film");
  const reels = channels.filter((channel) => channel.group === "Science" || channel.group === "Sport");
  const movies: Movie[] = channels.map((channel) => ({
    id: `movie-${channel.id}`,
    name: channel.name,
    group: channel.group,
    plot: "Public sample you can play in the browser.",
    url: channel.url,
  }));
  const series: Series[] = [
    {
      id: "series-shorts",
      name: "Open Shorts",
      group: "Film",
      plot: "Three public short films, listed as season 1.",
      episodes: films.map((channel, index) => ({
        id: `ep-${channel.id}`,
        title: channel.name,
        season: 1,
        number: index + 1,
        url: channel.url,
      })),
    },
    {
      id: "series-lab",
      name: "Lab Reels",
      group: "Science",
      plot: "Test patterns and timing reels.",
      episodes: reels.map((channel, index) => ({
        id: `ep-${channel.id}`,
        title: channel.name,
        season: 1,
        number: index + 1,
        url: channel.url,
      })),
    },
  ];
  return { channels, movies, series };
}

export function programsFor(channel: Channel, now: number): Program[] {
  if (channel.guide !== "sample") return channel.programs;
  const clock = now || Date.now();
  const covering = channel.programs.some((program) => program.start <= clock && clock < program.end);
  if (covering) return channel.programs;
  return guidePrograms(channel.id, channel.group, clock);
}

export function currentProgram(channel: Channel, now: number): Program | undefined {
  return programsFor(channel, now).find((program) => program.start <= now && now < program.end);
}

export function nextProgram(channel: Channel, now: number): Program | undefined {
  return programsFor(channel, now).find((program) => program.start > now);
}

function attr(line: string, name: string): string {
  const match = line.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return (match?.[1] ?? match?.[2] ?? "").trim();
}

export function parseM3u(text: string, now = Date.now()): Channel[] {
  const lines = text.split(/\r?\n/);
  const channels: Channel[] = [];
  let pending: { name: string; group: string; epgId?: string; epgName?: string } | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      const comma = line.lastIndexOf(",");
      const name = (comma >= 0 ? line.slice(comma + 1) : "Channel").trim() || "Channel";
      const group = attr(line, "group-title") || "General";
      const epgId = attr(line, "tvg-id") || undefined;
      const epgName = attr(line, "tvg-name") || undefined;
      pending = { name, group, epgId, epgName };
      continue;
    }
    if (line.startsWith("#")) continue;
    if (!/^https?:\/\//i.test(line)) {
      pending = null;
      continue;
    }
    const meta = pending ?? { name: `Channel ${channels.length + 1}`, group: "General" };
    const id = `m3u-${channels.length + 1}`;
    channels.push({
      id,
      name: meta.name,
      group: meta.group,
      number: channels.length + 1,
      url: line,
      epgId: meta.epgId,
      epgName: meta.epgName,
      guide: "none",
      programs: [],
    });
    pending = null;
  }
  return channels;
}

export function playlistEpgUrl(text: string): string {
  return playlistEpgUrls(text).join(",");
}

export function playlistEpgUrls(text: string): string[] {
  const header = text.split(/\r?\n/).find((line) => line.startsWith("#EXTM3U")) ?? "";
  const raw = attr(header, "url-tvg") || attr(header, "x-tvg-url") || attr(header, "tvg-url");
  return raw
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item));
}

type XtreamCategory = { category_id?: string | number; category_name?: string };
type XtreamStream = {
  stream_id?: number;
  series_id?: number;
  name?: string;
  category_id?: string | number | Array<string | number>;
  category_name?: string;
  stream_icon?: string;
  epg_channel_id?: string;
  cover?: string;
  plot?: string;
  container_extension?: string;
};

function asList<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") return Object.values(value) as T[];
  return [];
}

function categoryIdOf(row: XtreamStream): string {
  const raw = row.category_id;
  if (Array.isArray(raw)) return raw.length ? String(raw[0]) : "";
  if (raw == null) return "";
  return String(raw);
}

function categoryNames(categories: unknown): Map<string, string> {
  const names = new Map<string, string>();
  for (const category of asList<XtreamCategory>(categories)) {
    if (category?.category_id != null) {
      names.set(String(category.category_id), category.category_name?.trim() || "General");
    }
  }
  return names;
}

function groupName(row: XtreamStream, names: Map<string, string>, fallback: string): string {
  const id = categoryIdOf(row);
  return row.category_name?.trim() || names.get(id) || (id ? `Category ${id}` : fallback);
}

function posterOf(row: XtreamStream): string | undefined {
  const poster = row.stream_icon || row.cover;
  return poster && /^https?:\/\//i.test(poster) ? poster : undefined;
}

function serverBase(server: string): string {
  const trimmed = server.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) return `http://${trimmed}`;
  return trimmed;
}

function isDnsFile(value: string): boolean {
  return /github\.com|githubusercontent\.com/i.test(value);
}

function rawDnsUrl(value: string): string {
  const blob = value.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i);
  if (blob) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`;
  const gist = value.match(/^https?:\/\/gist\.github\.com\/([^/]+)\/([a-f0-9]+)\/?$/i);
  if (gist) return `https://gist.githubusercontent.com/${gist[1]}/${gist[2]}/raw`;
  return value;
}

type XtreamAddress = { origin: string; username: string; password: string };

function xtreamAddress(value: string): XtreamAddress {
  const trimmed = value.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return {
      origin: url.origin,
      username: url.searchParams.get("username") ?? "",
      password: url.searchParams.get("password") ?? "",
    };
  } catch {
    return { origin: serverBase(trimmed.split(/[?#]/)[0] ?? trimmed), username: "", password: "" };
  }
}

function parseXtreamAddress(text: string): XtreamAddress | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed) as Record<string, unknown>;
      const value = data.dns ?? data.server ?? data.url ?? data.host ?? data.xtream;
      if (typeof value === "string" && value.trim()) {
        const parsed = xtreamAddress(value);
        const username = typeof data.username === "string" ? data.username : parsed.username;
        const password = typeof data.password === "string" ? data.password : parsed.password;
        return { origin: parsed.origin, username, password };
      }
    } catch {
      /* a plain Xtream address is also allowed */
    }
  }
  for (const line of trimmed.split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean || clean.startsWith("#") || clean.startsWith("//")) continue;
    const labeled = clean.match(/^(?:dns|server|host|url|xtream)\s*[:=]\s*(.+)$/i);
    const value = (labeled?.[1] ?? clean).trim().split(/\s+/)[0] ?? "";
    if (/^https?:\/\//i.test(value) || /^[\w.-]+:\d+$/.test(value) || /^[\w.-]+\.[a-z]{2,}/i.test(value)) {
      return xtreamAddress(value);
    }
  }
  return null;
}

async function resolveXtream(server: string, username: string, password: string): Promise<XtreamAddress> {
  if (!isDnsFile(server)) {
    const parsed = xtreamAddress(server);
    return { origin: parsed.origin, username: username || parsed.username, password: password || parsed.password };
  }
  const response = await fetch(`${previewAsset("/api/media")}?url=${encodeURIComponent(rawDnsUrl(server.trim()))}`);
  if (!response.ok) throw new Error("The GitHub file with the Xtream address could not be read.");
  const found = parseXtreamAddress(await response.text());
  if (!found) throw new Error("That GitHub file did not contain an Xtream address.");
  return { origin: found.origin, username: username || found.username, password: password || found.password };
}

export async function loadXtream(
  server: string,
  username: string,
  password: string,
  now = Date.now(),
): Promise<Catalog> {
  const login = await resolveXtream(server, username, password);
  const base = login.origin;
  const auth = `username=${encodeURIComponent(login.username)}&password=${encodeURIComponent(login.password)}`;
  const info = (await readJson(`${base}/player_api.php?${auth}`)) as {
    user_info?: { auth?: number; status?: string };
  };
  if (info?.user_info && info.user_info.auth === 0) {
    throw new Error("That username or password was rejected.");
  }
  const [liveCategories, liveStreams, vodCategories, vodStreams, seriesCategories, seriesList] =
    await Promise.all([
      readJson(`${base}/player_api.php?${auth}&action=get_live_categories`).catch(() => []),
      readJson(`${base}/player_api.php?${auth}&action=get_live_streams`),
      readJson(`${base}/player_api.php?${auth}&action=get_vod_categories`).catch(() => []),
      readJson(`${base}/player_api.php?${auth}&action=get_vod_streams`).catch(() => []),
      readJson(`${base}/player_api.php?${auth}&action=get_series_categories`).catch(() => []),
      readJson(`${base}/player_api.php?${auth}&action=get_series`).catch(() => []),
    ]);
  const liveRows = asList<XtreamStream>(liveStreams);
  if (!liveRows.length) throw new Error("This server did not return a channel list.");
  const liveNames = categoryNames(liveCategories);
  const user = encodeURIComponent(login.username);
  const pass = encodeURIComponent(login.password);
  const channels = takeByCategory(liveRows, liveNames, "General", (stream, index, group) => {
    const id = String(stream.stream_id ?? index + 1);
    return {
      id: `xt-${id}`,
      name: stream.name?.trim() || `Channel ${index + 1}`,
      group,
      number: index + 1,
      url: `${base}/live/${user}/${pass}/${id}.m3u8`,
      epgId: stream.epg_channel_id?.trim() || id,
      guide: "none" as const,
      programs: [],
    };
  });
  const movieNames = categoryNames(vodCategories);
  const movies = takeByCategory(asList<XtreamStream>(vodStreams), movieNames, "Movies", (stream, index, group) => {
    const id = String(stream.stream_id ?? index + 1);
    const ext = (stream.container_extension || "mp4").replace(/^\./, "");
    return {
      id: `xtm-${id}`,
      name: stream.name?.trim() || `Movie ${index + 1}`,
      group,
      plot: stream.plot?.trim() || "",
      poster: posterOf(stream),
      url: `${base}/movie/${user}/${pass}/${id}.${ext}`,
    };
  });
  const seriesNames = categoryNames(seriesCategories);
  const series = takeByCategory(asList<XtreamStream>(seriesList), seriesNames, "Series", (stream, index, group) => {
    const id = String(stream.series_id ?? stream.stream_id ?? index + 1);
    return {
      id: `xts-${id}`,
      name: stream.name?.trim() || `Series ${index + 1}`,
      group,
      plot: stream.plot?.trim() || "",
      poster: posterOf(stream),
    };
  });
  return { channels, movies, series, epgUrl: `${base}/xmltv.php?${auth}` };
}

function takeByCategory<T>(
  rows: XtreamStream[],
  names: Map<string, string>,
  fallback: string,
  make: (row: XtreamStream, index: number, group: string) => T,
): T[] {
  const out: T[] = [];
  rows.forEach((row, index) => {
    if (!row || typeof row !== "object") return;
    const group = groupName(row, names, fallback);
    out.push(make(row, index, group));
  });
  return out;
}

function artwork(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  const info = row.info && typeof row.info === "object" ? (row.info as Record<string, unknown>) : {};
  for (const item of [row.cover_big, row.movie_image, row.cover, info.movie_image, info.cover_big, info.cover]) {
    const text = String(item ?? "").trim();
    if (/^https?:\/\//i.test(text)) return text;
  }
  return "";
}

function collectEpisodes(value: unknown, seasonHint: number, into: Array<Record<string, unknown>>) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectEpisodes(item, seasonHint, into);
    return;
  }
  const row = value as Record<string, unknown>;
  const id = row.id ?? row.stream_id ?? row.episode_id;
  if (id != null && String(id) && (row.container_extension || row.episode_num != null || row.direct_source)) {
    into.push({ ...row, season: row.season ?? seasonHint });
    return;
  }
  for (const [key, child] of Object.entries(row)) {
    if (!child || typeof child !== "object") continue;
    collectEpisodes(child, /^\d+$/.test(key) ? Number(key) : seasonHint, into);
  }
}

export async function loadEpisodes(source: Source, seriesId: string): Promise<Episode[]> {
  if (source.mode !== "xtream") return [];
  const id = seriesId.replace(/^xts-/, "");
  const login = await resolveXtream(source.server, source.username, source.password);
  const base = login.origin;
  const auth = `username=${encodeURIComponent(login.username)}&password=${encodeURIComponent(login.password)}`;
  const info = (await readJson(
    `${base}/player_api.php?${auth}&action=get_series_info&series_id=${encodeURIComponent(id)}`,
  )) as { episodes?: unknown; seasons?: unknown; info?: unknown };
  const rows: Array<Record<string, unknown>> = [];
  collectEpisodes(info.episodes, 1, rows);
  const seasonCovers = new Map<number, string>();
  const seasonList = Array.isArray(info.seasons) ? info.seasons : info.seasons && typeof info.seasons === "object" ? Object.values(info.seasons) : [];
  for (const item of seasonList) {
    if (!item || typeof item !== "object") continue;
    const season = item as Record<string, unknown>;
    const number = Number(season.season_number ?? season.season ?? 0);
    const image = artwork(season);
    if (number && image) seasonCovers.set(number, image);
  }
  const seriesCover = artwork(info.info);
  const user = encodeURIComponent(login.username);
  const pass = encodeURIComponent(login.password);
  const episodes: Episode[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const episodeId = String(row.id ?? row.stream_id ?? row.episode_id ?? "");
    if (!episodeId || seen.has(episodeId)) continue;
    seen.add(episodeId);
    const nested = row.info && typeof row.info === "object" ? (row.info as Record<string, unknown>) : {};
    const ext = String(row.container_extension || nested.container_extension || "mp4").replace(/^\./, "");
    const direct = String(row.direct_source ?? "").trim();
    const season = Number(row.season ?? 1) || 1;
    const still = artwork(row);
    const seasonImage = seasonCovers.get(season) || seriesCover || undefined;
    episodes.push({
      id: episodeId,
      title: String(row.title || `Episode ${row.episode_num ?? episodes.length + 1}`).trim(),
      season,
      number: Number(row.episode_num ?? episodes.length + 1) || episodes.length + 1,
      url: /^https?:\/\//i.test(direct) ? direct : `${base}/series/${user}/${pass}/${episodeId}.${ext}`,
      image: still || seasonImage,
      seasonImage,
    });
  }
  episodes.sort((a, b) => a.season - b.season || a.number - b.number);
  return episodes;
}

const jsonCache = new Map<string, unknown>();

async function readJson(url: string): Promise<unknown> {
  const cached = jsonCache.get(url);
  if (cached !== undefined) return cached;
  let wait = 700;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${previewAsset("/api/media")}?url=${encodeURIComponent(url)}`);
    if (response.ok) {
      const data = await response.json();
      jsonCache.set(url, data);
      return data;
    }
    lastStatus = response.status;
    if (response.status !== 429 && response.status !== 503) break;
    await new Promise((resolve) => setTimeout(resolve, wait));
    wait *= 2;
  }
  if (lastStatus === 429 || lastStatus === 503) {
    throw new Error("The server is busy. Wait a moment, then open this series again.");
  }
  throw new Error(`The server answered ${lastStatus}.`);
}

export async function loadM3u(url: string, now = Date.now()): Promise<Catalog> {
  const response = await fetch(`${previewAsset("/api/media")}?url=${encodeURIComponent(url)}`);
  if (!response.ok) throw new Error(`The playlist answered ${response.status}.`);
  const text = await response.text();
  const channels = parseM3u(text, now);
  if (channels.length === 0) throw new Error("That playlist did not contain any http streams.");
  const epgUrl = playlistEpgUrl(text);
  return { channels, movies: [], series: [], epgUrl: epgUrl || undefined };
}

function xmltvTime(value: string): number {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
  if (!match) return Number.NaN;
  const [, year, month, day, hour, minute, second, zone] = match;
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  if (!zone) return utc;
  const sign = zone.startsWith("-") ? -1 : 1;
  const offset = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5))) * 60 * 1000;
  return utc - offset;
}

function xmlText(body: string, tag: string): string {
  const match = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return (match?.[1] ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replaceAll("&" + "amp;", "&")
    .replaceAll("&" + "lt;", "<")
    .replaceAll("&" + "gt;", ">")
    .replaceAll("&" + "quot;", '"')
    .replaceAll("&" + "apos;", "'")
    .trim();
}

function remember(map: Map<string, Program[]>, key: string, program: Program) {
  const id = key.trim();
  if (!id) return;
  const list = map.get(id) ?? map.get(id.toLowerCase()) ?? [];
  list.push(program);
  map.set(id, list);
  map.set(id.toLowerCase(), list);
}

function normName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/^(?:[a-z]{2}|\d{2,3})\s*[:|-]\s*/, "")
    .replace(/\b(hd|fhd|sd|uhd|4k|hevc|raw|vip|backup|hdtv)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function streamKey(channel: Channel): string {
  const raw = channel.id.includes("::") ? channel.id.slice(channel.id.lastIndexOf("::") + 2) : channel.id;
  const fromId = raw.replace(/^xt-/, "");
  if (/^\d+$/.test(fromId)) return fromId;
  const fromUrl = channel.url.match(/\/(\d+)\.(?:m3u8|ts|mp4)(?:$|\?)/i);
  if (fromUrl) return fromUrl[1];
  return fromId;
}

function callSigns(value: string): string[] {
  const found = new Set<string>();
  for (const match of value.matchAll(/\(([^)]+)\)/g)) {
    for (const part of match[1].split(/[^A-Za-z0-9]+/)) {
      const key = normName(part);
      if (key.length >= 3 && key.length <= 8) found.add(key);
    }
  }
  return [...found];
}

function looseKeys(value: string): string[] {
  const raw = value.trim();
  if (!raw) return [];
  const keys = [raw, raw.toLowerCase(), normName(raw)];
  const head = raw.split(/[.|@:/]/)[0]?.trim() ?? "";
  if (head && head !== raw) keys.push(head, head.toLowerCase(), normName(head));
  return keys.filter(Boolean);
}

const GENERIC_NAME = new Set([
  "nbc", "cbs", "abc", "fox", "pbs", "cnn", "espn", "hbo", "tnt", "usa", "amc", "mtv", "bet", "ion",
  "news", "sport", "sports", "movie", "movies", "music", "channel", "local", "premium", "family", "cinema",
  "plus", "east", "west", "live", "backup",
]);

function guideAliases(id: string, labels: string[]): string[] {
  const found = new Set<string>();
  const add = (value: string) => {
    const key = normName(value);
    if (key.length < 3 || key.length > 12 || GENERIC_NAME.has(key)) return;
    found.add(key);
  };
  add(id);
  for (const part of id.split(/[^A-Za-z0-9]+/)) add(part);
  for (const label of labels) {
    add(label);
    for (const sign of callSigns(label)) add(sign);
    for (const word of label.split(/[^A-Za-z0-9]+/)) add(word);
  }
  return [...found];
}

function claimAlias(owners: Map<string, string>, alias: string, id: string) {
  const prev = owners.get(alias);
  if (!prev) owners.set(alias, id);
  else if (prev !== id) owners.set(alias, "");
}

function listingsFor(channel: Channel, byChannel: Map<string, Program[]>, names: Map<string, string>): Program[] | undefined {
  const keys = [
    ...looseKeys(channel.epgId ?? ""),
    ...looseKeys(channel.epgName ?? ""),
    ...looseKeys(streamKey(channel)),
    ...looseKeys(channel.name),
    ...callSigns(channel.name),
    ...callSigns(channel.epgName ?? ""),
  ];
  for (const key of keys) {
    const found = byChannel.get(key) ?? byChannel.get(key.toLowerCase()) ?? byChannel.get(normName(key));
    if (found?.length) return found;
    const id = names.get(key) ?? names.get(key.toLowerCase()) ?? names.get(normName(key));
    if (!id) continue;
    const listed = byChannel.get(id) ?? byChannel.get(id.toLowerCase());
    if (listed?.length) return listed;
  }
  const channelKey = normName(`${channel.epgName ?? ""} ${channel.name}`);
  if (channelKey.length >= 4) {
    for (const [label, id] of names) {
      if (label.length < 4 || label.length > 8 || !channelKey.includes(label)) continue;
      if (GENERIC_NAME.has(label)) continue;
      const listed = byChannel.get(id) ?? byChannel.get(id.toLowerCase());
      if (listed?.length) return listed;
    }
  }
  return undefined;
}

export function applyXmltv(channels: Channel[], xml: string, now = Date.now()): Channel[] {
  const from = now - 3 * 60 * 60 * 1000;
  const to = now + 18 * 60 * 60 * 1000;
  const byChannel = new Map<string, Program[]>();
  const names = new Map<string, string>();
  const owners = new Map<string, string>();
  const displays = new Map<string, string[]>();
  const channelRe = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/gi;
  let channelMatch: RegExpExecArray | null;
  while ((channelMatch = channelRe.exec(xml))) {
    const namesInChannel = [...channelMatch[2].matchAll(/<display-name[^>]*>([\s\S]*?)<\/display-name>/gi)].map((item) =>
      item[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replaceAll("&" + "amp;", "&")
        .trim(),
    );
    const id = attr(channelMatch[1], "id").replaceAll("&" + "amp;", "&");
    if (!id) continue;
    displays.set(id, namesInChannel);
    for (const alias of guideAliases(id, namesInChannel)) claimAlias(owners, alias, id);
  }
  const programmeRe = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
  let programmeMatch: RegExpExecArray | null;
  let count = 0;
  while ((programmeMatch = programmeRe.exec(xml))) {
    const channel = attr(programmeMatch[1], "channel").replaceAll("&" + "amp;", "&");
    const start = xmltvTime(attr(programmeMatch[1], "start"));
    const end = xmltvTime(attr(programmeMatch[1], "stop"));
    if (!channel || !Number.isFinite(start) || !Number.isFinite(end) || end < from || start > to) continue;
    count += 1;
    if (count > 200000) break;
    remember(byChannel, channel, {
      id: `${channel}-${start}`,
      title: xmlText(programmeMatch[2], "title") || "Programme",
      start,
      end,
      description: xmlText(programmeMatch[2], "desc"),
    });
  }
  for (const [alias, id] of owners) {
    if (!id) continue;
    const list = byChannel.get(id) ?? byChannel.get(id.toLowerCase());
    if (!list?.length) continue;
    const existing = byChannel.get(alias);
    if (existing && existing !== list) continue;
    byChannel.set(alias, list);
    names.set(alias, id);
  }
  for (const [id, labels] of displays) {
    for (const label of labels) {
      const key = normName(label);
      if (key && !names.has(key)) names.set(key, id);
      if (!names.has(label.toLowerCase())) names.set(label.toLowerCase(), id);
    }
  }
  if (byChannel.size === 0) return channels;
  return channels.map((channel) => {
    const programs = listingsFor(channel, byChannel, names);
    if (!programs?.length) return channel;
    const unique = [...programs]
      .sort((a, b) => a.start - b.start)
      .filter((program, index, list) => index === 0 || program.start !== list[index - 1].start);
    return { ...channel, programs: unique, guide: "epg" };
  });
}

async function readPayload(url: string): Promise<string> {
  const response = await fetch(`${previewAsset("/api/media")}?url=${encodeURIComponent(url)}`);
  if (!response.ok) throw new Error(`The guide answered ${response.status}.`);
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let gzip = false;
  if (reader) {
    while (total < 14_000_000) {
      const step = await reader.read();
      if (step.done || !step.value) break;
      if (total === 0 && step.value.length >= 2 && step.value[0] === 0x1f && step.value[1] === 0x8b) gzip = true;
      const cap = gzip ? 14_000_000 : 8_000_000;
      if (total >= cap) break;
      const room = cap - total;
      const piece = step.value.length > room ? step.value.subarray(0, room) : step.value;
      chunks.push(piece);
      total += piece.length;
      if (total >= cap) break;
    }
    await reader.cancel().catch(() => undefined);
  } else {
    chunks.push(new Uint8Array(await response.arrayBuffer()));
    gzip = chunks[0]?.[0] === 0x1f && chunks[0]?.[1] === 0x8b;
  }
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (gzip && typeof DecompressionStream !== "undefined") {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      return await new Response(stream).text();
    } catch {
      return "";
    }
  }
  return new TextDecoder().decode(bytes);
}

function decodeField(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
    try {
      const binary = atob(text);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const decoded = new TextDecoder().decode(bytes).trim();
      const readable = [...decoded].filter((char) => char >= " " && char !== "\u007f").length;
      if (decoded && readable / decoded.length > 0.85) return decoded;
    } catch {
      /* already plain text */
    }
  }
  return text;
}

function listingTime(row: Record<string, unknown>, stamp: string, textKey: string): number {
  const unix = Number(row[stamp]);
  if (Number.isFinite(unix) && unix > 1_000_000_000_000) return unix;
  if (Number.isFinite(unix) && unix > 1_000_000_000) return unix * 1000;
  const text = String(row[textKey] ?? "").trim();
  if (!text) return Number.NaN;
  const parsed = Date.parse(text.includes("T") ? text : text.replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function listingRows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data.filter((row) => row && typeof row === "object") as Array<Record<string, unknown>>;
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  let listings: unknown = record.epg_listings ?? record;
  if (typeof listings === "string") {
    try {
      listings = JSON.parse(listings);
    } catch {
      return [];
    }
  }
  return asList<Record<string, unknown>>(listings);
}

async function loadShortEpg(
  xmltvUrl: string,
  channels: Channel[],
  now: number,
  onBatch?: (channels: Channel[]) => void,
): Promise<Channel[]> {
  let page: URL;
  try {
    page = new URL(xmltvUrl);
  } catch {
    return channels;
  }
  const username = page.searchParams.get("username") ?? "";
  const password = page.searchParams.get("password") ?? "";
  if (!username || !password) return channels;
  const base = `${page.protocol}//${page.host}`;
  const pending = channels
    .filter((channel) => channel.guide !== "epg" && /^\d+$/.test(streamKey(channel)))
    .slice(0, 240);
  const programs = new Map<string, Program[]>();
  let cursor = 0;
  let published = 0;
  function publish() {
    if (!onBatch || programs.size === published) return;
    published = programs.size;
    onBatch(
      channels.map((channel) => {
        const list = programs.get(channel.id);
        return list ? { ...channel, programs: list, guide: "epg" as const } : channel;
      }),
    );
  }
  async function worker() {
    while (cursor < pending.length) {
      const channel = pending[cursor];
      cursor += 1;
      const streamId = streamKey(channel);
      const auth = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
      const ids = [streamId];
      const epg = channel.epgId?.trim() ?? "";
      if (epg && epg !== streamId) ids.push(epg);
      let filled = false;
      for (const id of ids) {
        if (filled) break;
        const endpoints = [
          `${base}/player_api.php?${auth}&action=get_short_epg&stream_id=${encodeURIComponent(id)}&limit=12`,
          `${base}/player_api.php?${auth}&action=get_simple_data_table&stream_id=${encodeURIComponent(id)}`,
        ];
        for (const endpoint of endpoints) {
          try {
            const response = await fetch(`${previewAsset("/api/media")}?url=${encodeURIComponent(endpoint)}`);
            if (!response.ok) continue;
            const rows = listingRows(await response.json());
            const list: Program[] = [];
            for (const row of rows) {
              const start = listingTime(row, "start_timestamp", "start");
              let end = listingTime(row, "stop_timestamp", "end");
              if (!Number.isFinite(end)) end = listingTime(row, "stop_timestamp", "stop");
              if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
              if (end < now - 2 * 60 * 60 * 1000 || start > now + 18 * 60 * 60 * 1000) continue;
              list.push({
                id: String(row.id ?? `${streamId}-${start}`),
                title: decodeField(row.title) || "Programme",
                start,
                end,
                description: decodeField(row.description),
              });
            }
            if (list.length) {
              programs.set(channel.id, list.sort((a, b) => a.start - b.start));
              if (programs.size % 4 === 0) publish();
              filled = true;
              break;
            }
          } catch {
            /* try the other guide call */
          }
        }
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, () => worker()));
  publish();
  if (programs.size === 0) return channels;
  return channels.map((channel) => {
    const list = programs.get(channel.id);
    return list ? { ...channel, programs: list, guide: "epg" } : channel;
  });
}

export async function loadEpg(
  url: string,
  channels: Channel[],
  now = Date.now(),
  onBatch?: (channels: Channel[]) => void,
): Promise<Channel[]> {
  const urls = url
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item));
  let best = channels;
  let bestCount = 0;
  for (const item of urls) {
    try {
      const xml = await readPayload(item);
      if (!xml.includes("<programme")) continue;
      const next = applyXmltv(channels, xml, now);
      const count = next.filter((channel) => channel.guide === "epg").length;
      if (count > bestCount) {
        best = next;
        bestCount = count;
        onBatch?.(next);
      }
      if (count > 0 && !item.includes("xmltv.php")) return next;
    } catch {
      /* try the next guide address */
    }
  }
  const xtream = urls.find((item) => item.includes("xmltv.php"));
  if (xtream && bestCount < channels.length) {
    const short = await loadShortEpg(xtream, best, now, onBatch);
    const count = short.filter((channel) => channel.guide === "epg").length;
    if (count > bestCount) return short;
  }
  return best;
}

export function loadSavedSource(): Source {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { mode: "demo" };
    const parsed = JSON.parse(raw) as Source;
    if (parsed?.mode === "m3u" && parsed.url) return parsed;
    if (parsed?.mode === "xtream" && parsed.server && parsed.username) return parsed;
  } catch {
    /* ignore broken storage */
  }
  return { mode: "demo" };
}

export function saveSource(source: Source) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(source));
}

export type Playlist = { id: string; source: Source };

const LIBRARY_KEY = `${STORAGE_KEY}-library`;

export function playlistKey(source: Source): string {
  if (source.mode === "demo") return "demo";
  if (source.mode === "m3u") return `m3u:${source.url}`;
  return `xt:${source.server}|${source.username}`;
}

export function playlistLabel(source: Source): string {
  if (source.mode === "demo") return "Demo library";
  if (source.name?.trim()) return source.name.trim();
  if (source.mode === "m3u") return "M3U playlist";
  return source.username || "Xtream";
}

function savedSource(value: unknown): Source | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Source;
  if (parsed.mode === "m3u" && parsed.url) return parsed;
  if (parsed.mode === "xtream" && parsed.server && parsed.username) return parsed;
  if (parsed.mode === "demo") return { mode: "demo" };
  return null;
}

export function loadLibrary(): { activeId: string; playlists: Playlist[] } {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { activeId?: string; playlists?: Array<{ id?: string; source?: unknown }> };
      const playlists = (parsed.playlists ?? [])
        .map((item) => {
          const source = savedSource(item?.source);
          return source && item?.id ? { id: String(item.id), source } : null;
        })
        .filter((item): item is Playlist => item !== null);
      if (playlists.length > 0) {
        const activeId = playlists.some((item) => item.id === parsed.activeId) ? String(parsed.activeId) : playlists[0].id;
        return { activeId, playlists };
      }
    }
  } catch {
    /* use the single saved source */
  }
  const saved = loadSavedSource();
  if (saved.mode === "demo") return { activeId: "", playlists: [] };
  return { activeId: "playlist-1", playlists: [{ id: "playlist-1", source: saved }] };
}

export function saveLibrary(activeId: string, playlists: Playlist[]) {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify({ activeId, playlists }));
  const active = playlists.find((item) => item.id === activeId);
  if (active) saveSource(active.source);
}

const CATALOG_KEY = `${STORAGE_KEY}-catalogs`;

function slimCatalog(catalog: Catalog): Catalog {
  return {
    epgUrl: catalog.epgUrl,
    channels: catalog.channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      group: channel.group,
      number: channel.number,
      url: channel.url,
      epgId: channel.epgId,
      epgName: channel.epgName,
      guide: "none",
      programs: [],
    })),
    movies: catalog.movies.map((movie) => ({
      id: movie.id,
      name: movie.name,
      group: movie.group,
      plot: movie.plot,
      poster: movie.poster,
      url: movie.url,
    })),
    series: catalog.series.map((series) => ({
      id: series.id,
      name: series.name,
      group: series.group,
      plot: series.plot,
      poster: series.poster,
    })),
  };
}

export function loadCatalogCache(): Record<string, Catalog> {
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Catalog>;
    if (!parsed || typeof parsed !== "object") return {};
    const next: Record<string, Catalog> = {};
    for (const [id, catalog] of Object.entries(parsed)) {
      if (!catalog || !Array.isArray(catalog.channels)) continue;
      next[id] = slimCatalog(catalog);
    }
    return next;
  } catch {
    return {};
  }
}

export function saveCatalogCache(id: string, catalog: Catalog) {
  const slim = slimCatalog(catalog);
  try {
    const current = loadCatalogCache();
    current[id] = slim;
    localStorage.setItem(CATALOG_KEY, JSON.stringify(current));
  } catch {
    try {
      localStorage.setItem(CATALOG_KEY, JSON.stringify({ [id]: { ...slim, movies: [], series: [] } }));
    } catch {
      /* the channel list is still held in memory */
    }
  }
}

export function upsertPlaylist(source: Source): { activeId: string; playlists: Playlist[] } {
  const stored = loadLibrary();
  const name = source.mode === "demo" ? "" : (source.name?.trim() ?? "");
  const existing = name
    ? stored.playlists.find((item) => playlistLabel(item.source).toLowerCase() === name.toLowerCase())
    : stored.playlists.find((item) => playlistKey(item.source) === playlistKey(source) && playlistLabel(item.source) === playlistLabel(source));
  if (existing) {
    return {
      activeId: existing.id,
      playlists: stored.playlists.map((item) => (item.id === existing.id ? { ...item, source } : item)),
    };
  }
  const id = `pl-${Date.now()}`;
  return { activeId: id, playlists: [...stored.playlists, { id, source }] };
}

export function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}-favs`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function saveFavorites(ids: string[]) {
  localStorage.setItem(`${STORAGE_KEY}-favs`, JSON.stringify(ids));
}

export function formatClock(now: number): string {
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
}

export function formatTime(stamp: number): string {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(stamp);
}
