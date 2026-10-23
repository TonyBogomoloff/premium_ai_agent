let database;
function open() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('emoji-studio-attachments', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = null; };
      resolve(db);
    };
    request.onerror = () => { database = null; reject(request.error); };
  });
  return database;
}
async function transaction(key, operation, value) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', operation === 'get' ? 'readonly' : 'readwrite');
    const store = tx.objectStore('drafts');
    const request = operation === 'put' ? store.put(value, key) : store[operation](key);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(tx.error || request.error || new Error('Attachment storage failed'));
  });
}
export const attachmentStore = {
  get: key => transaction(key, 'get'),
  put: (key, value) => transaction(key, 'put', value),
  remove: key => transaction(key, 'delete'),
};
