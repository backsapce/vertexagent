/**
 * opfsBridge.js
 * Bridge between OPFS VFS operations and the sync system.
 * Allows sync interceptor to register a callback that OPFS calls after each write operation.
 * This avoids coupling opfs.js directly to the sync system.
 */

let syncNotifyCallback = null;
let syncNotificationsPaused = 0;

export function setSyncNotifyCallback(callback) {
  syncNotifyCallback = callback;
}

export function notifySync() {
  if (syncNotificationsPaused > 0) return;

  if (syncNotifyCallback) {
    try {
      syncNotifyCallback();
    } catch (_e) {
      // sync notification should never break the VFS operation
    }
  }
}

export async function withoutSyncNotification(fn) {
  syncNotificationsPaused++;
  try {
    return await fn();
  } finally {
    syncNotificationsPaused--;
  }
}

export { syncNotifyCallback };
