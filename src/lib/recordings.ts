export type SavedClip = {
  id: string;
  title: string;
  startedAt: number;
  mime: string;
};

type Row = SavedClip & { blob: Blob };

const DB_NAME = "triplea-recordings";
const STORE = "clips";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveClip(title: string, blob: Blob): Promise<SavedClip> {
  const row: Row = {
    id: `rec-${Date.now()}`,
    title,
    startedAt: Date.now(),
    mime: blob.type || "video/webm",
    blob,
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return { id: row.id, title: row.title, startedAt: row.startedAt, mime: row.mime };
}

export async function listClips(): Promise<SavedClip[]> {
  const db = await openDb();
  const rows = await new Promise<Row[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as Row[]) ?? []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return rows
    .map(({ id, title, startedAt, mime }) => ({ id, title, startedAt, mime }))
    .sort((a, b) => b.startedAt - a.startedAt);
}

export async function readClip(id: string): Promise<Blob | null> {
  const db = await openDb();
  const row = await new Promise<Row | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result as Row | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return row?.blob ?? null;
}

export async function deleteClip(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
