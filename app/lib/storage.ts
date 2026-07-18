import type { WorkspaceData } from "../types";

const DATABASE_NAME = "weapon-grid-lab";
const DATABASE_VERSION = 1;
const STORE_NAME = "workspaces";
const CURRENT_WORKSPACE_KEY = "current";

let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
  return databasePromise;
}

export async function loadWorkspace(): Promise<WorkspaceData | undefined> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(CURRENT_WORKSPACE_KEY);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as WorkspaceData | undefined);
  });
}

export async function saveWorkspace(workspace: WorkspaceData): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
    transaction.objectStore(STORE_NAME).put(workspace, CURRENT_WORKSPACE_KEY);
  });
}

export async function getPersistenceStatus(): Promise<boolean> {
  if (!navigator.storage?.persisted) return false;
  return navigator.storage.persisted();
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

