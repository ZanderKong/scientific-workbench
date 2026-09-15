const database = () => new Promise<IDBDatabase>((resolve, reject) => {
  const open = indexedDB.open('scientific-workbench-drafts', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('documents');
  open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
});
export async function draftRead(key: string): Promise<string | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('documents', 'readonly'), read = transaction.objectStore('documents').get(key);
    read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error); transaction.oncomplete = () => db.close();
  });
}
export async function draftWrite(key: string, body: string | null): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('documents', 'readwrite'), store = transaction.objectStore('documents');
    if (body === null) store.delete(key); else store.put(body, key);
    transaction.oncomplete = () => { db.close(); resolve(); }; transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}
