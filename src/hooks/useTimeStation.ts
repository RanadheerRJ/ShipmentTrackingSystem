import { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../api/client';
import type { TimeStationStatusPayload } from '../types';

function getTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function getDeviceInfo() {
  if (typeof navigator === 'undefined') return 'Unknown device';
  return navigator.userAgent || 'Unknown device';
}

async function parseError(res: Response) {
  const payload = await res.json().catch(() => ({} as Record<string, unknown>));
  const error = typeof payload.error === 'string' ? payload.error : '';
  return error || 'Request failed';
}

export function formatDuration(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function formatHoursMinutes(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export function useTimeStationStatus(enabled = true) {
  const [status, setStatus] = useState<TimeStationStatusPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(() => Date.now());

  const timezone = useMemo(() => getTimezone(), []);

  const refreshStatus = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ timezone });
      const res = await apiClient.authFetch(`/time-station/status?${query.toString()}`);
      if (!res.ok) throw new Error(await parseError(res));
      const payload = await res.json();
      setStatus(payload as TimeStationStatusPayload);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed loading time status';
      setError(message);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [enabled, timezone]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!enabled || !status?.is_clocked_in) return;
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled, status?.is_clocked_in]);

  const activeElapsedSeconds = useMemo(() => {
    if (!status?.is_clocked_in || !status.active_session_started_at_utc) return 0;
    const start = Date.parse(status.active_session_started_at_utc);
    if (!Number.isFinite(start)) return status.active_work_seconds || 0;
    return Math.max(0, Math.floor((tick - start) / 1000));
  }, [status, tick]);

  const runClockAction = useCallback(async (action: 'clock-in' | 'clock-out') => {
    if (!enabled) return { success: false, error: 'Time Station unavailable' };
    setActionLoading(true);
    setError('');
    try {
      const res = await apiClient.authFetch(`/time-station/${action}`, {
        method: 'POST',
        body: JSON.stringify({
          timezone,
          device_info: getDeviceInfo(),
        }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      const payload = await res.json();
      if (payload?.status) setStatus(payload.status as TimeStationStatusPayload);
      else await refreshStatus();
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Action failed';
      setError(message);
      return { success: false, error: message };
    } finally {
      setActionLoading(false);
    }
  }, [enabled, refreshStatus, timezone]);

  const clockIn = useCallback(() => runClockAction('clock-in'), [runClockAction]);
  const clockOut = useCallback(() => runClockAction('clock-out'), [runClockAction]);

  return {
    status,
    loading,
    actionLoading,
    error,
    timezone,
    activeElapsedSeconds,
    refreshStatus,
    clockIn,
    clockOut,
  };
}
