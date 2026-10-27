export type RemoteActions = {
  step: (delta: number) => void;
  recall: () => void;
  toggleFavorite: () => void;
  openGuide: () => void;
  closeGuide: () => void;
  closeSettings: () => void;
  guideOpen: () => boolean;
  settingsOpen: () => boolean;
};

function visible(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function targets(scope: ParentNode) {
  return [...scope.querySelectorAll<HTMLElement>("[data-zone] button, [data-zone] a[href], [data-zone] select, [data-zone] input")].filter(
    (el) => !el.hasAttribute("disabled") && !el.hasAttribute("data-tv-skip") && el.tabIndex >= 0 && visible(el),
  );
}

function zoneOf(el: HTMLElement) {
  return el.closest<HTMLElement>("[data-zone]");
}

let lastFocused: HTMLElement | null = null;
let lastActivate = 0;

function focus(el: HTMLElement) {
  document.querySelectorAll(".tv-on").forEach((node) => node.classList.remove("tv-on"));
  lastFocused = el;
  el.classList.add("tv-on");
  try {
    el.focus({ preventScroll: true });
  } catch {
    try {
      el.focus();
    } catch {
      /* older TV browsers reject the focus options */
    }
  }
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function press(el: HTMLElement) {
  const view = window;
  const point = { bubbles: true, cancelable: true, view, button: 0 };
  if (typeof PointerEvent === "function") {
    el.dispatchEvent(new PointerEvent("pointerdown", point));
    el.dispatchEvent(new PointerEvent("pointerup", point));
  }
  el.dispatchEvent(new MouseEvent("mousedown", point));
  el.dispatchEvent(new MouseEvent("mouseup", point));
  el.dispatchEvent(new MouseEvent("click", point));
}

function activate() {
  const now = Date.now();
  if (now - lastActivate < 280) return;
  lastActivate = now;
  const marked = document.querySelector<HTMLElement>(".tv-on");
  const active = document.activeElement;
  const focused =
    active instanceof HTMLElement && active.matches("button, a, select, input") && visible(active) ? active : null;
  const remembered = lastFocused && document.contains(lastFocused) && visible(lastFocused) ? lastFocused : null;
  const el =
    (marked && document.contains(marked) && visible(marked) ? marked : null) ?? focused ?? remembered;
  if (!el) {
    const home = document.querySelector<HTMLElement>("[data-zone='channels'] [data-tv-main]");
    if (!home) return;
    focus(home);
    press(home);
    return;
  }
  if (el instanceof HTMLInputElement && el.type === "range") return;
  if (el.getAttribute("data-active") === "true" && el.hasAttribute("data-tv-main")) {
    window.dispatchEvent(new CustomEvent("triplea-select"));
    return;
  }
  press(el);
}

function inferFlow(items: HTMLElement[]): "row" | "column" {
  if (items.length < 2) return "column";
  const rects = items.map((el) => el.getBoundingClientRect());
  const vertical = Math.max(...rects.map((rect) => rect.top)) - Math.min(...rects.map((rect) => rect.top));
  const horizontal = Math.max(...rects.map((rect) => rect.left)) - Math.min(...rects.map((rect) => rect.left));
  return horizontal > vertical * 1.2 ? "row" : "column";
}

function move(key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight") {
  const modal = document.querySelector<HTMLElement>("[data-modal]");
  const scope: ParentNode = modal ?? document;
  const all = targets(scope);
  if (!all.length) return;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (active?.hasAttribute("data-tv-side")) {
    const main = active.closest("li")?.querySelector<HTMLElement>("[data-tv-main]");
    if (main && (key === "ArrowLeft" || key === "ArrowUp")) {
      focus(main);
      return;
    }
  }
  let current = active && all.includes(active) ? active : null;
  if (!current) {
    const home =
      scope.querySelector<HTMLElement>("[data-zone='channels'] [data-active='true']") ??
      scope.querySelector<HTMLElement>("[data-zone='channels'] [data-tv-main]") ??
      all[0];
    if (home) focus(home);
    return;
  }
  const zone = zoneOf(current);
  if (!zone) return;
  const mates = all.filter((el) => zoneOf(el) === zone);
  const marked = zone.getAttribute("data-flow");
  const flow = marked === "row" || marked === "column" ? marked : inferFlow(mates);
  const vertical = key === "ArrowUp" || key === "ArrowDown";
  const forward = key === "ArrowDown" || key === "ArrowRight";
  const inside = flow === "column" ? vertical : !vertical;
  if (inside) {
    if (!vertical && forward && current.hasAttribute("data-tv-main")) {
      const side = current.parentElement?.querySelector<HTMLElement>("[data-tv-side]");
      if (side && visible(side)) {
        focus(side);
        return;
      }
    }
    const sorted = [...mates].sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return flow === "column" ? ar.top - br.top || ar.left - br.left : ar.left - br.left || ar.top - br.top;
    });
    const next = sorted[sorted.indexOf(current) + (forward ? 1 : -1)];
    if (next) focus(next);
    return;
  }
  const cr = current.getBoundingClientRect();
  const cx = cr.left + cr.width / 2;
  const cy = cr.top + cr.height / 2;
  let best: HTMLElement | null = null;
  let score = Infinity;
  for (const el of all) {
    if (zoneOf(el) === zone) continue;
    const rect = el.getBoundingClientRect();
    const dx = rect.left + rect.width / 2 - cx;
    const dy = rect.top + rect.height / 2 - cy;
    if (vertical) {
      if (forward ? dy < 12 : dy > -12) continue;
      const next = Math.abs(dy) + Math.abs(dx) * 1.4;
      if (next < score) {
        score = next;
        best = el;
      }
    } else {
      if (forward ? dx < 12 : dx > -12) continue;
      const next = Math.abs(dx) + Math.abs(dy) * 1.6;
      if (next < score) {
        score = next;
        best = el;
      }
    }
  }
  if (best) focus(best);
}

function focusActiveChannel() {
  window.setTimeout(() => {
    const el = document.querySelector<HTMLElement>("[data-zone='channels'] [data-active='true']");
    if (el) focus(el);
  }, 0);
}

export function installRemote(actions: () => RemoteActions) {
  function onKey(event: KeyboardEvent) {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement) {
      if (event.key !== "Escape") return;
    }
    if (target instanceof HTMLInputElement && target.type !== "range") {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Enter") return;
    }
    if (target instanceof HTMLSelectElement && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const next = target.selectedIndex + (event.key === "ArrowDown" ? 1 : -1);
      if (next >= 0 && next < target.options.length) {
        target.selectedIndex = next;
        target.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }
    if (target instanceof HTMLInputElement && target.type === "range" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) return;
    const api = actions();
    if (event.key === "f" || event.key === "F") {
      api.toggleFavorite();
      return;
    }
    if (event.key === "Enter" || event.key === "Select" || event.key === " " || event.keyCode === 13 || event.keyCode === 23 || event.keyCode === 66 || event.keyCode === 96 || event.keyCode === 109) {
      if (target instanceof HTMLInputElement && target.type === "range") return;
      event.preventDefault();
      event.stopPropagation();
      activate();
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      move(event.key);
    }
  }

  function remote(name: string) {
    const api = actions();
    if (name === "ChannelUp" || name === "MediaTrackNext") {
      api.step(1);
      focusActiveChannel();
    } else if (name === "ChannelDown" || name === "MediaTrackPrevious") {
      api.step(-1);
      focusActiveChannel();
    } else if (name === "Last") {
      api.recall();
      focusActiveChannel();
    } else if (name === "MediaPlayPause") {
      window.dispatchEvent(new Event("triplea-play"));
    } else if (name === "Guide") {
      if (api.guideOpen()) api.closeGuide();
      else api.openGuide();
    } else if (name === "Enter") {
      activate();
    } else if (name === "ArrowUp" || name === "ArrowDown" || name === "ArrowLeft" || name === "ArrowRight") {
      move(name);
    }
  }

  function back() {
    const event = new CustomEvent("triplea-back", { cancelable: true });
    window.dispatchEvent(event);
    if (event.defaultPrevented) return true;
    const api = actions();
    if (api.settingsOpen()) {
      api.closeSettings();
      return true;
    }
    if (api.guideOpen()) {
      api.closeGuide();
      return true;
    }
    return false;
  }

  window.addEventListener("keydown", onKey, true);
  const host = window as Window & { tripleaRemote?: (name: string) => void; tripleaBack?: () => boolean };
  host.tripleaRemote = remote;
  host.tripleaBack = back;
  return () => {
    window.removeEventListener("keydown", onKey, true);
    delete host.tripleaRemote;
    delete host.tripleaBack;
  };
}
