import {
  categoryLabel,
  editorOrder,
  type CategoryPrefs,
  type CategorySection,
} from "@/lib/categories";

export function CategoryEditor({
  section,
  onSection,
  names,
  prefs,
  onChange,
}: {
  section: CategorySection;
  onSection: (section: CategorySection) => void;
  names: string[];
  prefs: CategoryPrefs;
  onChange: (prefs: CategoryPrefs) => void;
}) {
  const order = editorOrder(names, prefs);

  function move(from: string, to: string) {
    if (!from || from === to || prefs.alpha) return;
    const next = [...order];
    const fromIndex = next.indexOf(from);
    const toIndex = next.indexOf(to);
    if (fromIndex < 0 || toIndex < 0) return;
    next.splice(fromIndex, 1);
    next.splice(toIndex, 0, from);
    onChange({ ...prefs, order: next });
  }

  return (
    <div className="mt-5 border-t border-line pt-4">
      <h3 className="text-base font-semibold">Categories</h3>
      <p className="mt-1 text-sm text-muted">
        Taken from the playlist. Rename a group, choose which ones show, or move them up and down.
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2" role="tablist" aria-label="Category list">
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
            onClick={() => onSection(id)}
            className={
              section === id
                ? "h-11 rounded-ui bg-accent text-sm font-medium text-white"
                : "h-11 rounded-ui bg-panel-2 text-sm text-muted"
            }
          >
            {label}
          </button>
        ))}
      </div>
      <label className="mt-3 flex h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-accent"
          checked={prefs.alpha}
          onChange={() => onChange({ ...prefs, alpha: !prefs.alpha })}
        />
        Sort alphabetically
      </label>
      {order.length === 0 ? (
        <p className="mt-2 text-sm text-muted">This playlist has no categories in that section.</p>
      ) : (
        <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto">
          {order.map((id) => {
            const shown = !prefs.hidden.includes(id);
            return (
              <li key={id} className="flex items-center gap-2 rounded-ui bg-bg px-2">
                <button
                  type="button"
                  disabled={prefs.alpha || order[0] === id}
                  className="h-8 rounded-ui px-2 text-xs text-muted disabled:opacity-30"
                  onClick={() => {
                    const index = order.indexOf(id);
                    if (index > 0) move(id, order[index - 1]);
                  }}
                >
                  Up
                </button>
                <button
                  type="button"
                  disabled={prefs.alpha || order[order.length - 1] === id}
                  className="h-8 rounded-ui px-2 text-xs text-muted disabled:opacity-30"
                  onClick={() => {
                    const index = order.indexOf(id);
                    if (index >= 0 && index < order.length - 1) move(id, order[index + 1]);
                  }}
                >
                  Down
                </button>
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-accent"
                  checked={shown}
                  aria-label={`Show ${categoryLabel(id, prefs)}`}
                  onChange={() => {
                    const hidden = shown ? [...prefs.hidden, id] : prefs.hidden.filter((name) => name !== id);
                    onChange({ ...prefs, hidden });
                  }}
                />
                <input
                  value={prefs.labels[id] ?? ""}
                  placeholder={id}
                  aria-label={`Rename ${id}`}
                  onChange={(event) =>
                    onChange({ ...prefs, labels: { ...prefs.labels, [id]: event.target.value } })
                  }
                  className="h-11 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted"
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
