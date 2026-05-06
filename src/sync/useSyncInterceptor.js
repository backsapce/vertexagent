/**
 * useSyncInterceptor
 * Hook that provides sync status and notifies sync manager of local changes.
 * When auto mode is enabled, triggers debounced incremental sync.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import config from '../config/config.js';
import { incrementalSync } from './syncManager.js';
import { setSyncNotifyCallback } from './opfsBridge.js';

const DEBOUNCE_MS = 500;

export function useSyncInterceptor() {
  const syncingRef = useRef(false);

  const [status, setStatus] = useState({
    syncing: false,
    lastSynced: null,
    lastError: null,
  });

  const syncTimerRef = useRef(null);
  const snapshotRef = useRef(null);

  const doSync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;

    const syncConfig = config.get('sync');
    if (!syncConfig?.enabled || syncConfig?.mode !== 'auto') {
      syncingRef.current = false;
      return;
    }
    if (!syncConfig?.url || !syncConfig?.username) {
      syncingRef.current = false;
      return;
    }

    const fullPassword = syncConfig.password || config.get('sync.password');
    if (!fullPassword) {
      syncingRef.current = false;
      return;
    }

    setStatus(prev => ({ ...prev, syncing: true }));

    try {
      const changes = await incrementalSync(
        syncConfig.url,
        syncConfig.username,
        fullPassword,
        snapshotRef.current,
        (newSnapshot) => { snapshotRef.current = newSnapshot; }
      );

      const now = new Date().toISOString();
      await config.set('sync.lastSynced', now);

      setStatus({
        syncing: false,
        lastSynced: now,
        lastError: changes.errors.length > 0
          ? `${changes.errors.length} error(s) during sync`
          : null,
      });
    } catch (err) {
      setStatus(prev => ({
        syncing: false,
        lastSynced: prev.lastSynced,
        lastError: err.message,
      }));
    } finally {
      syncingRef.current = false;
    }
  }, []);

  const scheduleSync = useCallback(() => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
    }

    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      doSync().catch(console.error);
    }, DEBOUNCE_MS);
  }, [doSync]);

  // Subscribe to config changes for sync settings
  useEffect(() => {
    const unsub = config.subscribe(() => {
      const syncConfig = config.get('sync');
      if (syncConfig?.enabled && syncConfig?.mode === 'auto') {
        scheduleSync();
      }
    });
    return unsub;
  }, [scheduleSync]);

  // Register notify with opfs bridge
  const notify = useCallback(() => {
    const syncConfig = config.get('sync');
    if (syncConfig?.enabled && syncConfig?.mode === 'auto') {
      scheduleSync();
    }
  }, [scheduleSync]);

  useEffect(() => {
    setSyncNotifyCallback(notify);
    return () => setSyncNotifyCallback(null);
  }, [notify]);

  return { status, manualSync: doSync };
}

/**
 * Get current sync settings for UI.
 */
export function useSyncSettings() {
  const [settings, setSettings] = useState(() => config.get('sync') || {});

  useEffect(() => {
    const unsub = config.subscribe(() => {
      setSettings(config.get('sync') || {});
    });
    return unsub;
  }, []);

  return settings;
}
