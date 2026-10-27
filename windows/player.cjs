const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const root = path.resolve(__dirname, "..");
const port = 4173;
let server = null;
let mainWindow = null;
let creatingMain = false;
let trialExpires = 0;

function nodeBinary() {
  const bundled = path.join(root, "vendor", "node", "win", "node.exe");
  if (fs.existsSync(bundled)) return bundled;
  return process.execPath;
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (Date.now() - started > 20000) return reject(new Error("The player did not start."));
      const request = http.get(`http://127.0.0.1:${port}/`, (response) => {
        response.resume();
        resolve();
      });
      request.on("error", () => setTimeout(tick, 200));
    };
    tick();
  });
}

function openWindow() {
  const icon = path.join(root, "public", "logo.ico");
  creatingMain = true;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "TripleA IPTV Player",
    icon: fs.existsSync(icon) ? icon : undefined,
    backgroundColor: "#10162a",
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false },
  });
  creatingMain = false;
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
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
        webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false },
      },
    };
  });
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  mainWindow.webContents.on("did-finish-load", () => {
    if (trialExpires) mainWindow.webContents.executeJavaScript(`window.__tripleaTrial={expiresAt:${trialExpires}}`).catch(() => {});
  });
}

app.setAppUserModelId("com.triplea.iptv");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

app.whenReady().then(async () => {
  const trial = require(path.join(root, "trial.cjs")).claimTrial(root);
  if (!trial.ok) {
    dialog.showErrorBox("TripleA IPTV Player", trial.message);
    app.quit();
    return;
  }
  trialExpires = trial.expiresAt;
  const command = nodeBinary();
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: command === process.execPath ? "1" : undefined };
  server = spawn(command, [path.join(root, "windows", "serve.cjs")], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: "ignore",
  });
  try {
    await waitForServer();
    openWindow();
  } catch (error) {
    dialog.showErrorBox("TripleA IPTV Player", error instanceof Error ? error.message : "The player did not start.");
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (server) server.kill();
  app.quit();
});
