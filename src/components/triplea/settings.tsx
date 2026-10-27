import { useState } from "react";
import { demoCatalog, loadM3u, loadXtream, playlistLabel, type Catalog, type Playlist, type Source } from "@/lib/iptv";
import { playlistNames, type CategoryPrefs, type CategorySection } from "@/lib/categories";
import { CategoryEditor } from "@/components/triplea/category-editor";

type PlayerChoice = "mpegts" | "vlc" | "hls" | "browser";
type SettingsPage = "playlists" | "groups" | "playback" | "windows" | "appearance" | "other" | "about";

const PAGES: Array<[SettingsPage, string]> = [
  ["playlists", "Playlists"],
  ["groups", "Groups"],
  ["playback", "Playback"],
  ["windows", "Multi-view"],
  ["appearance", "Appearance"],
  ["other", "Other"],
  ["about", "About"],
];

export function SettingsDialog({
  source,
  playlists,
  activeId,
  libraries,
  catalog,
  categorySection,
  categoryPrefs,
  fontSize,
  onFontSize,
  player,
  onPlayer,
  windowCount,
  onWindowCount,
  groupByPlaylist,
  onGroupByPlaylist,
  showClock,
  onShowClock,
  dark,
  onDark,
  refreshing,
  onCategorySection,
  onCategoryPrefs,
  onClose,
  onApply,
  onUpdate,
  onDelete,
  onUse,
  onRefreshAll,
}: {
  source: Source;
  playlists: Playlist[];
  activeId: string;
  libraries: Record<string, Catalog>;
  catalog: Catalog;
  categorySection: CategorySection;
  categoryPrefs: CategoryPrefs;
  fontSize: number;
  onFontSize: (size: number) => void;
  player: PlayerChoice;
  onPlayer: (value: PlayerChoice) => void;
  windowCount: number;
  onWindowCount: (count: number) => void;
  groupByPlaylist: boolean;
  onGroupByPlaylist: (value: boolean) => void;
  showClock: boolean;
  onShowClock: (value: boolean) => void;
  dark: boolean;
  onDark: (value: boolean) => void;
  refreshing: boolean;
  onCategorySection: (section: CategorySection) => void;
  onCategoryPrefs: (prefs: CategoryPrefs) => void;
  onClose: () => void;
  onApply: (catalog: Catalog, source: Source) => void;
  onUpdate: (id: string, source: Source, catalog: Catalog) => void;
  onDelete: (id: string) => void;
  onUse: (id: string) => void;
  onRefreshAll: () => void;
}) {
  const [page, setPage] = useState<SettingsPage>("playlists");
  const [editingId, setEditingId] = useState(activeId || "new");
  const starting = playlists.find((item) => item.id === (activeId || ""))?.source ?? source;
  const [tab, setTab] = useState<Source["mode"]>(starting.mode);
  const [m3u, setM3u] = useState(starting.mode === "m3u" ? starting.url : "");
  const [server, setServer] = useState(starting.mode === "xtream" ? starting.server : "");
  const [username, setUsername] = useState(starting.mode === "xtream" ? starting.username : "");
  const [password, setPassword] = useState(starting.mode === "xtream" ? starting.password : "");
  const [playlistName, setPlaylistName] = useState(starting.mode === "demo" ? "" : (starting.name ?? ""));
  const [groupPlaylistId, setGroupPlaylistId] = useState(activeId);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function fill(next: Source) {
    setTab(next.mode);
    setM3u(next.mode === "m3u" ? next.url : "");
    setServer(next.mode === "xtream" ? next.server : "");
    setUsername(next.mode === "xtream" ? next.username : "");
    setPassword(next.mode === "xtream" ? next.password : "");
    setPlaylistName(next.mode === "demo" ? "" : (next.name ?? ""));
    setConfirmDelete(false);
    setError("");
    setNote("");
  }

  function pick(id: string) {
    const item = playlists.find((playlist) => playlist.id === id);
    if (!item) return;
    setEditingId(id);
    fill(item.source);
  }

  function startNew() {
    setEditingId("new");
    fill({ mode: "xtream", server: "", username: "", password: "", name: "" });
    setTab("xtream");
  }

  function namedSource(): Source {
    const name = playlistName.trim();
    if (tab === "demo") return { mode: "demo" };
    if (tab === "m3u") return { mode: "m3u", url: m3u.trim(), ...(name ? { name } : {}) };
    return {
      mode: "xtream",
      server: server.trim(),
      username: username.trim(),
      password,
      ...(name ? { name } : {}),
    };
  }

  async function loadCurrent() {
    if (tab === "demo") return demoCatalog();
    if (tab === "m3u") return loadM3u(m3u.trim());
    return loadXtream(server.trim(), username.trim(), password);
  }

  async function testConnection() {
    setError("");
    setNote("");
    setBusy(true);
    try {
      const next = await loadCurrent();
      setNote(`Connected. ${next.channels.length} live channels, ${next.movies.length} movies, ${next.series.length} series.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reach that source.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setError("");
    setNote("");
    setBusy(true);
    try {
      const nextSource = namedSource();
      const next = await loadCurrent();
      if (editingId === "new") {
        onApply(next, nextSource);
        setNote("Playlist added.");
      } else {
        onUpdate(editingId, nextSource, next);
        setNote("Playlist saved.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load that source.");
    } finally {
      setBusy(false);
    }
  }

  const groupSourceId = playlists.some((item) => item.id === groupPlaylistId) ? groupPlaylistId : activeId;
  const groupCatalog = (groupSourceId && libraries[groupSourceId]) || catalog;
  const groupNames =
    categorySection === "live"
      ? playlistNames(groupCatalog.channels.map((channel) => channel.group))
      : categorySection === "movies"
        ? playlistNames(groupCatalog.movies.map((item) => item.group))
        : playlistNames(groupCatalog.series.map((item) => item.group));

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center p-2 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <button type="button" className="absolute inset-0 bg-black/70" aria-label="Close settings" data-tv-skip onClick={onClose} />
      <div className="relative z-10 flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-ui border border-white/15 bg-panel shadow-2xl sm:h-[min(40rem,88vh)] sm:flex-row" data-modal>
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/10 bg-[#12182c] p-2 sm:w-44 sm:flex-col sm:overflow-y-auto sm:border-r sm:border-b-0" aria-label="Settings" data-zone="settings-menu">
          <h2 id="settings-title" className="hidden px-2 py-2 text-sm font-semibold text-white sm:block">
            Settings
          </h2>
          {PAGES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-current={page === id ? "page" : undefined}
              onClick={() => setPage(id)}
              className={
                page === id
                  ? "h-10 shrink-0 rounded-ui bg-[#2f6bff] px-3 text-left text-sm font-medium text-white"
                  : "h-10 shrink-0 rounded-ui px-3 text-left text-sm text-white/80 hover:bg-white/10"
              }
            >
              {label}
            </button>
          ))}
          <button type="button" className="mt-auto h-10 shrink-0 rounded-ui px-3 text-left text-sm text-white/70 hover:bg-white/10" onClick={onClose}>
            Close
          </button>
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto p-4" data-zone="settings" data-flow="column">
          {page === "playlists" ? (
            <div className="grid gap-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">Playlists</h3>
                  <p className="text-sm text-muted">Add, edit, or remove an Xtream login or M3U link.</p>
                </div>
                <button type="button" className="h-10 shrink-0 rounded-ui bg-[#2f6bff] px-3 text-sm font-semibold text-white" onClick={startNew}>
                  Add
                </button>
              </div>
              {playlists.length === 0 ? (
                <p className="text-sm text-muted">No playlist yet. Add one, or use the demo library.</p>
              ) : (
                <ul className="grid gap-1">
                  {playlists.map((item) => {
                    const count = libraries[item.id]?.channels.length;
                    const selected = item.id === editingId;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => pick(item.id)}
                          className={
                            selected
                              ? "flex h-12 w-full items-center justify-between rounded-ui bg-[#2f6bff] px-3 text-left text-white"
                              : "flex h-12 w-full items-center justify-between rounded-ui bg-panel-2 px-3 text-left"
                          }
                        >
                          <span>
                            <span className="block text-sm font-semibold">{playlistLabel(item.source)}</span>
                            <span className={selected ? "block text-xs text-white/80" : "block text-xs text-muted"}>
                              {item.source.mode === "xtream" ? "Xtream" : item.source.mode === "m3u" ? "M3U" : "Demo"}
                              {item.id === activeId ? " · playing" : ""}
                            </span>
                          </span>
                          <span className={selected ? "text-xs text-white/80" : "text-xs text-muted"}>
                            {typeof count === "number" ? `${count} channels` : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Playlist type">
                {(
                  [
                    ["demo", "Demo"],
                    ["xtream", "Xtream"],
                    ["m3u", "M3U"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    onClick={() => setTab(id)}
                    className={tab === id ? "h-11 rounded-ui bg-[#2f6bff] text-sm font-medium text-white" : "h-11 rounded-ui bg-panel-2 text-sm text-muted"}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {tab === "xtream" ? (
                <div className="grid gap-3">
                  <Field label="Playlist name" value={playlistName} onChange={setPlaylistName} placeholder="Home" />
                  <Field label="Xtream address" value={server} onChange={setServer} placeholder="http://example.com:8080" />
                  <Field label="Username" value={username} onChange={setUsername} placeholder="username" />
                  <Field label="Password" value={password} onChange={setPassword} placeholder="password" secret />
                </div>
              ) : null}
              {tab === "m3u" ? (
                <div className="grid gap-3">
                  <Field label="Playlist name" value={playlistName} onChange={setPlaylistName} placeholder="Home" />
                  <Field label="Playlist URL" value={m3u} onChange={setM3u} placeholder="https://example.com/list.m3u" />
                </div>
              ) : null}
              {tab === "demo" ? (
                <p className="text-sm text-muted">Public sample films and test patterns. Not a channel package.</p>
              ) : null}
              {error ? <p className="text-sm text-live">{error}</p> : null}
              {note ? <p className="text-sm text-fg">{note}</p> : null}
              <div className="grid gap-2 sm:grid-cols-2">
                {tab === "demo" ? null : (
                  <button type="button" disabled={busy} onClick={() => void testConnection()} className="h-11 rounded-ui border border-line text-sm font-semibold disabled:opacity-60">
                    {busy ? "Checking…" : "Test"}
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => void save()} className="h-11 rounded-ui bg-[#2f6bff] text-sm font-semibold text-white disabled:opacity-60">
                  {busy ? "Saving…" : editingId === "new" ? "Add playlist" : "Save"}
                </button>
                {editingId !== "new" ? (
                  <button type="button" onClick={() => onUse(editingId)} className="h-11 rounded-ui border border-line text-sm font-semibold">
                    Use this playlist
                  </button>
                ) : null}
                {editingId !== "new" ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirmDelete) {
                        setConfirmDelete(true);
                        return;
                      }
                      onDelete(editingId);
                      setConfirmDelete(false);
                      startNew();
                    }}
                    className="h-11 rounded-ui bg-[#e0232c] text-sm font-semibold text-white"
                  >
                    {confirmDelete ? "Confirm delete" : "Delete"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {page === "groups" ? (
            <div>
              <h3 className="text-lg font-semibold">Groups</h3>
              <p className="mt-1 text-sm text-muted">
                Hide, rename, or reorder the groups inside a playlist. Up and Down follow the remote.
              </p>
              <button
                type="button"
                aria-pressed={groupByPlaylist}
                onClick={() => onGroupByPlaylist(!groupByPlaylist)}
                className="mt-4 flex h-12 w-full items-center justify-between rounded-ui border border-line px-3 text-left text-sm"
              >
                <span>
                  <span className="block font-semibold">Group the list by playlist</span>
                  <span className="block text-xs text-muted">The group column lists each playlist instead of categories.</span>
                </span>
                <span className={groupByPlaylist ? "font-semibold text-[#2f6bff]" : "text-muted"}>{groupByPlaylist ? "On" : "Off"}</span>
              </button>
              {playlists.length > 1 ? (
                <label className="mt-4 grid gap-1 text-sm">
                  <span className="text-muted">Edit groups for</span>
                  <select
                    value={groupSourceId}
                    aria-label="Playlist groups"
                    onChange={(event) => setGroupPlaylistId(event.target.value)}
                    className="h-11 rounded-ui border border-line bg-bg px-3 text-fg"
                  >
                    {playlists.map((item) => (
                      <option key={item.id} value={item.id}>
                        {playlistLabel(item.source)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <CategoryEditor
                section={categorySection}
                onSection={onCategorySection}
                names={groupNames}
                prefs={categoryPrefs}
                onChange={onCategoryPrefs}
              />
            </div>
          ) : null}
          {page === "playback" ? (
            <div className="grid gap-2">
              <h3 className="text-lg font-semibold">Playback</h3>
              <p className="text-sm text-muted">Same choice as the top bar. Web is the safest player on a TV or emulator.</p>
              {(
                [
                  ["mpegts", "TS", "MPEG-TS streams, using the browser decoder."],
                  ["vlc", "VLC", "LibVLC, when a stream will not open in TS."],
                  ["hls", "HLS", "Apple HLS playlists (.m3u8)."],
                  ["browser", "Web", "The device player. Use this if the picture player closes."],
                ] as const
              ).map(([id, label, detail]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={player === id}
                  onClick={() => onPlayer(id)}
                  className={
                    player === id
                      ? "flex min-h-14 items-center justify-between rounded-ui border border-[#2f6bff] bg-[#2f6bff]/10 px-3 py-2 text-left"
                      : "flex min-h-14 items-center justify-between rounded-ui border border-line px-3 py-2 text-left"
                  }
                >
                  <span>
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="block text-xs text-muted">{detail}</span>
                  </span>
                  <span className={player === id ? "text-sm font-semibold text-[#2f6bff]" : "text-sm text-muted"}>{player === id ? "On" : ""}</span>
                </button>
              ))}
            </div>
          ) : null}
          {page === "windows" ? (
            <div>
              <h3 className="text-lg font-semibold">Multi-view</h3>
              <p className="mt-1 text-sm text-muted">
                Choose how many pictures play at once. Each window has its own volume, so you can hear more than one. Drag the bar between windows to resize them. Highlight a window, then pick its channel.
              </p>
              <div className="mt-4 grid grid-cols-4 gap-2">
                {[1, 2, 3, 4].map((count) => (
                  <button
                    key={count}
                    type="button"
                    aria-pressed={windowCount === count}
                    onClick={() => onWindowCount(count)}
                    className={
                      windowCount === count
                        ? "h-16 rounded-ui bg-[#2f6bff] text-lg font-semibold text-white"
                        : "h-16 rounded-ui bg-panel-2 text-lg font-semibold text-muted"
                    }
                  >
                    {count}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-sm text-muted">
                {windowCount === 1
                  ? "One window, the normal player. A picture in picture keeps that window’s volume, and you can drag its corner to resize it."
                  : `${windowCount} windows. Drag the bars between them to resize. Each one keeps its own volume.`}
              </p>
            </div>
          ) : null}
          {page === "appearance" ? (
            <div>
              <h3 className="text-lg font-semibold">Appearance</h3>
              <button
                type="button"
                aria-pressed={dark}
                onClick={() => onDark(!dark)}
                className="mt-4 flex h-12 w-full items-center justify-between rounded-ui border border-line px-3 text-left text-sm"
              >
                <span>
                  <span className="block font-semibold">Dark mode</span>
                  <span className="block text-xs text-muted">Dark guide, settings, and lists.</span>
                </span>
                <span className={dark ? "font-semibold text-[#2f6bff]" : "text-muted"}>{dark ? "On" : "Off"}</span>
              </button>
              <label className="mt-4 grid gap-1 text-sm">
                <span className="flex items-center justify-between text-muted">
                  Channel list size
                  <span className="text-fg tabular-nums">{fontSize}px</span>
                </span>
                <input
                  type="range"
                  min={10}
                  max={18}
                  step={1}
                  value={fontSize}
                  aria-label="Channel list font size"
                  className="volume-bar w-full"
                  onChange={(event) => onFontSize(Number(event.target.value))}
                />
              </label>
            </div>
          ) : null}
          {page === "other" ? (
            <div className="grid gap-3">
              <h3 className="text-lg font-semibold">Other</h3>
              <button
                type="button"
                aria-pressed={showClock}
                onClick={() => onShowClock(!showClock)}
                className="flex h-12 items-center justify-between rounded-ui border border-line px-3 text-sm"
              >
                <span className="font-semibold">Clock in the top bar</span>
                <span className={showClock ? "font-semibold text-[#2f6bff]" : "text-muted"}>{showClock ? "On" : "Off"}</span>
              </button>
              <button
                type="button"
                disabled={refreshing || playlists.length === 0}
                onClick={onRefreshAll}
                className="h-11 rounded-ui border border-line text-sm font-semibold disabled:opacity-60"
              >
                {refreshing ? "Refreshing…" : "Refresh all playlists"}
              </button>
              <p className="text-sm text-muted">Refresh reloads channels and asks the provider for the guide again.</p>
            </div>
          ) : null}
          {page === "about" ? (
            <div className="grid gap-3 text-sm">
              <h3 className="text-lg font-semibold">TripleA IPTV Player</h3>
              <p className="text-muted">Version 2.19</p>
              <p>A guide for a playlist you already have. TripleA does not sell channels.</p>
              <div className="rounded-ui border border-line bg-panel-2 p-3">
                <p className="font-semibold">Remote</p>
                <ul className="mt-2 space-y-1 text-muted">
                  <li>Arrows move. Left and right switch between this menu and the page.</li>
                  <li>OK or Select opens the highlighted item. Back closes Settings.</li>
                  <li>Channel up and down change the channel. Last returns to the previous one.</li>
                  <li>In multi-view, highlight a window, then choose the channel for it.</li>
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  secret,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  secret?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="grid gap-1 text-sm">
      <span className="flex items-center justify-between text-muted">
        {label}
        {secret ? (
          <button type="button" className="text-xs text-fg" onClick={() => setVisible((current) => !current)}>
            {visible ? "Hide" : "Show"}
          </button>
        ) : null}
      </span>
      <input
        type={secret && !visible ? "password" : "text"}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 rounded-ui border border-line bg-bg px-3 text-fg outline-none placeholder:text-muted focus:border-accent"
        autoComplete="off"
      />
    </label>
  );
}
