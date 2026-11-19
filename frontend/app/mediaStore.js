/* IndexedDB store that keeps report images (File objects + editor state)
   so they survive route changes and page reloads. */
const DB = "reportgenix-media";
const STORE = "media";

const open = () =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const run = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(request ? request.result : undefined);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
};

export const saveMedia = (key, value) => run("readwrite", (s) => s.put(value, key));
export const loadMedia = (key) => run("readonly", (s) => s.get(key));
export const deleteMedia = (key) => run("readwrite", (s) => s.delete(key));
export const clearMedia = () => run("readwrite", (s) => s.clear());
