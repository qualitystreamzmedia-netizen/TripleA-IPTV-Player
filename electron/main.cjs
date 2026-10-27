const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const port = 8080;
let server;
let logFd = 0;

function projectDir() {
  const fromApp = app.getAppPath();
  if (fs.existsSync(path.join(fromApp, "package.json"))) return fromApp;
  return process.cwd();
}

function readAppEnv(root) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, ".grok", "app-env.json"), "utf8"));
    const env = {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return env;
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith("VITE_") && typeof value === "string") env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

function note(line) {
  if (!logFd) return;
  try {
    fs.writeSync(logFd, `${line}\n`);
  } catch {
    /* the log was already closed */
  }
}

function tail(root) {
  try {
    const text = fs.readFileSync(path.join(root, "player.log"), "utf8");
    return text.trim().split(/\r?\n/).slice(-12).join("\n");
  } catch {
    return "";
  }
}

function nodeBinary(root) {
  if (process.platform === "win32") {
    const winNode = path.join(root, "vendor", "node", "win", "node.exe");
    if (fs.existsSync(winNode)) return winNode;
  }
  if (process.platform === "darwin") {
    const macNode = path.join(root, "vendor", "node", "mac", "bin", "node");
    if (fs.existsSync(macNode)) return macNode;
  }
  return "";
}

function explainFailure(body) {
  const marker = "An error occurred while server rendering";
  const at = body.indexOf(marker);
  if (at >= 0) {
    return body
      .slice(at, at + 900)
      .replace(/\\n/g, "\n")
      .replace(/\\u003c/g, "<")
      .replace(/<[^>]+>/g, " ");
  }
  const message = body.match(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (message) return message[1].replace(/\\n/g, "\n").slice(0, 900);
  const plain = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return plain.slice(0, 900);
}

function readBody(response) {
  return new Promise((resolve) => {
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    response.on("error", () => resolve(""));
  });
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (server && server.exitCode !== null) {
        reject(new Error("The player server stopped."));
        return;
      }
      if (Date.now() - started > 60000) {
        reject(new Error("The player server did not start."));
        return;
      }
      const request = http.get(`http://127.0.0.1:${port}/`, (response) => {
        if (response.statusCode && response.statusCode >= 500) {
          readBody(response).then((body) => {
            note(body.slice(0, 4000));
            const reason = explainFailure(body);
            reject(new Error(reason || "The player server did not start."));
          });
          return;
        }
        response.resume();
        resolve();
      });
      request.on("error", () => setTimeout(tick, 400));
    };
    tick();
  });
}

let mainWindow = null;
let creatingMain = false;
let trialExpires = 0;
const floatWindows = new Set();

function keepFloatsVisible() {
  setTimeout(() => {
    for (const float of floatWindows) {
      if (float.isDestroyed()) {
        floatWindows.delete(float);
        continue;
      }
      if (float.isMinimized()) float.restore();
      float.show();
      float.setAlwaysOnTop(true, "floating");
      if (process.platform === "darwin") float.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
  }, 50);
}

function attachWindow(window, icon) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return { action: "deny" };
    }
    if (!parsed.pathname.endsWith("/pip")) return { action: "deny" };
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        width: 480,
        height: 320,
        minWidth: 320,
        minHeight: 220,
        alwaysOnTop: true,
        autoHideMenuBar: true,
        backgroundColor: "#10162a",
        title: parsed.searchParams.get("title") || "TripleA",
        icon,
        type: process.platform === "darwin" ? "panel" : "normal",
        skipTaskbar: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          backgroundThrottling: false,
        },
      },
    };
  });
  window.on("minimize", () => {
    if (window === mainWindow) keepFloatsVisible();
  });
  window.on("hide", () => {
    if (window === mainWindow) keepFloatsVisible();
  });
}

function openWindow() {
  const root = projectDir();
  const icon = path.join(root, "public", "logo.ico");
  const iconPath = fs.existsSync(icon) ? icon : undefined;
  creatingMain = true;
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "TripleA IPTV Player",
    icon: iconPath,
    backgroundColor: "#10162a",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  creatingMain = false;
  mainWindow = window;
  attachWindow(window, iconPath);
  window.webContents.on("render-process-gone", () => {
    if (window.isDestroyed()) return;
    dialog.showMessageBox(window, {
      type: "error",
      title: "TripleA IPTV Player",
      message: "The picture window closed. VLC is off now so the built-in player is used. Open the channel again.",
    });
    window.loadURL(`http://127.0.0.1:${port}/?engine=internal`);
  });
  window.loadURL(`http://127.0.0.1:${port}/`);
  window.webContents.on("did-finish-load", () => {
    if (trialExpires) window.webContents.executeJavaScript(`window.__tripleaTrial={expiresAt:${trialExpires}}`).catch(() => {});
  });
}

function startServer(root) {
  const logPath = path.join(root, "player.log");
  logFd = fs.openSync(logPath, "a");
  note(`---- ${new Date().toISOString()} ----`);
  const bundled = nodeBinary(root);
  const command = bundled || process.execPath;
  const env = { ...readAppEnv(root), ...process.env };
  if (!env.VITE_AUTH_ENABLED) env.VITE_AUTH_ENABLED = "false";
  if (!bundled) env.ELECTRON_RUN_AS_NODE = "1";
  const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
  note(`node ${command}`);
  const child = spawn(command, [viteBin, "dev", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.on("error", (error) => note(error.stack || String(error)));
  child.on("exit", (code) => note(`server exited ${code}`));
  return child;
}

function stopServer() {
  if (!server || server.exitCode !== null) return;
  if (process.platform === "win32" && server.pid) {
    spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  server.kill();
}

if (!app.requestSingleInstanceLock()) app.quit();

app.setAppUserModelId("com.triplea.iptv");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

app.on("browser-window-created", (_event, created) => {
  if (creatingMain || created === mainWindow) return;
  floatWindows.add(created);
  created.setAlwaysOnTop(true, "floating");
  if (process.platform === "darwin") {
    created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    created.setFullScreenable(false);
  }
  created.on("closed", () => {
    floatWindows.delete(created);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
    }
  });
});

app.whenReady().then(async () => {
  const root = projectDir();
  const trial = require(path.join(root, "trial.cjs")).claimTrial(root);
  if (!trial.ok) {
    dialog.showErrorBox("TripleA IPTV Player", trial.message);
    app.quit();
    return;
  }
  trialExpires = trial.expiresAt;
  try {
    server = startServer(root);
    await waitForServer();
    openWindow();
  } catch (error) {
    const detail = tail(root);
    dialog.showErrorBox(
      "TripleA IPTV Player",
      `${error instanceof Error ? error.message : "The player did not start."}${detail ? `\n\n${detail}` : ""}\n\nThe full note is player.log in the TripleA folder.`,
    );
    stopServer();
    app.quit();
  }
});

app.on("window-all-closed", () => {
  stopServer();
  app.quit();
});

app.on("before-quit", () => stopServer());
