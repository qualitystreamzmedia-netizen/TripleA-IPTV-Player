const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const TRIAL_MS = 3 * 24 * 60 * 60 * 1000;

function machinePath() {
  if (process.platform === "win32") {
    const base = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(base, "TripleAIPTV", "install.json");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "TripleAIPTV", "install.json");
  }
  return path.join(os.homedir(), ".triplea-iptv", "install.json");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function claimTrial(installDir) {
  const machineFile = machinePath();
  const localFile = path.join(installDir, ".triplea-install");
  const machine = readJson(machineFile);
  const local = readJson(localFile);
  const now = Date.now();
  if (!machine || typeof machine.id !== "string" || typeof machine.startedAt !== "number") {
    const record = { id: crypto.randomUUID(), startedAt: now, seenAt: now };
    writeJson(machineFile, record);
    writeJson(localFile, record);
    return { ok: true, expiresAt: now + TRIAL_MS };
  }
  if (!local || local.id !== machine.id) {
    return {
      ok: false,
      message: "TripleA was already installed on this computer. The trial cannot be installed again.",
    };
  }
  if (typeof machine.seenAt === "number" && now + 60 * 1000 < machine.seenAt) {
    return { ok: false, message: "The 3-day TripleA trial on this computer has ended." };
  }
  const expiresAt = machine.startedAt + TRIAL_MS;
  machine.seenAt = now;
  writeJson(machineFile, machine);
  writeJson(localFile, machine);
  if (now >= expiresAt) {
    return { ok: false, message: "The 3-day TripleA trial on this computer has ended." };
  }
  return { ok: true, expiresAt };
}

module.exports = { claimTrial, machinePath };
