/**
 * useSyncInterceptor
 * Hook that provides sync status and notifies sync manager of local changes.
 * When auto mode is enabled, triggers debounced incremental sync.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import config from '../config/config.js';
import { incrementalSync } from './syncManager.js';
import { setSyncNotifyCallback, withoutSyncNotification } from './opfsBridge.js';

const DEBOUNCE_MS = 500;

export function useSyncInterceptor() {
  const syncingRef = useRef(false);
  const suppressConfigSyncRef = useRef(false);

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

    const syncMethod = syncConfig.method || syncConfig.provider || 'webdav';
    const s3Config = syncConfig.s3 || {};
    const hasWebdavCredentials = Boolean(syncConfig.url && syncConfig.username && syncConfig.password);
    const hasS3Credentials = Boolean(
      (s3Config.endpoint || syncConfig.endpoint || syncConfig.url) &&
      (s3Config.bucket || syncConfig.bucket) &&
      (s3Config.accessKeyId || syncConfig.accessKeyId || syncConfig.username) &&
      (s3Config.secretAccessKey || syncConfig.secretAccessKey || syncConfig.password)
    );

    if (syncMethod === 's3' ? !hasS3Credentials : !hasWebdavCredentials) {
      syncingRef.current = false;
      return;
    }

    const fullPassword = syncConfig.password || s3Config.secretAccessKey || syncConfig.secretAccessKey;

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
      suppressConfigSyncRef.current = true;
      await withoutSyncNotification(() => config.set('sync.lastSynced', now));
      suppressConfigSyncRef.current = false;

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
      suppressConfigSyncRef.current = false;
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
      if (suppressConfigSyncRef.current) return;

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
