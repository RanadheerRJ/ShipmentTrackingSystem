import { Clock3, LogIn, LogOut, AlertTriangle, Timer } from 'lucide-react';
import { formatDuration, formatHoursMinutes, useTimeStationStatus } from '../../hooks/useTimeStation';

interface TimeStationQuickCardProps {
  onOpenModule?: () => void;
  className?: string;
  compactWhenActive?: boolean;
}

export function TimeStationQuickCard({ onOpenModule, className = '', compactWhenActive = false }: TimeStationQuickCardProps) {
  const {
    status,
    loading,
    actionLoading,
    error,
    activeElapsedSeconds,
    clockIn,
    clockOut,
    refreshStatus,
  } = useTimeStationStatus(true);

  const isClockedIn = !!status?.is_clocked_in;
  const todayTotalSeconds = status ? status.today.total_work_seconds : 0;
  const activeSeconds = isClockedIn ? activeElapsedSeconds : 0;
  const displayTotalSeconds = todayTotalSeconds + (isClockedIn ? Math.max(0, activeSeconds - (status?.active_work_seconds || 0)) : 0);

  if (compactWhenActive && isClockedIn) {
    return (
      <div className={`rounded-xl border border-blue-200 bg-blue-50/80 shadow-[0_12px_26px_-20px_rgba(37,99,235,0.65)] p-3 ${className}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-blue-700">Active Work Time</p>
            <p className="text-2xl font-semibold text-blue-900 mt-0.5">{formatDuration(activeSeconds)}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={clockOut}
              disabled={loading || actionLoading || !status}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60"
            >
              <LogOut className="w-4 h-4" />
              {actionLoading ? 'Please wait...' : 'Clock Out'}
            </button>
            {onOpenModule && (
              <button
                onClick={onOpenModule}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-200 bg-white text-sm font-medium text-blue-700 hover:bg-blue-50"
              >
                Open Module
              </button>
            )}
          </div>
        </div>
        {error && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <span>{error}</span>
            <button onClick={refreshStatus} className="font-semibold hover:text-red-800">Retry</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border border-slate-200 bg-white/95 shadow-[0_16px_36px_-30px_rgba(15,23,42,0.75)] p-4 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            <Clock3 className="w-4 h-4" /> Time Station
          </div>
          <h3 className="mt-1 text-lg font-semibold text-slate-900">Daily Attendance</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={isClockedIn ? clockOut : clockIn}
            disabled={loading || actionLoading || !status}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-60 ${
              isClockedIn ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {isClockedIn ? <LogOut className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
            {actionLoading ? 'Please wait...' : isClockedIn ? 'Clock Out' : 'Clock In'}
          </button>
          {onOpenModule && (
            <button
              onClick={onOpenModule}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Open Module
            </button>
          )}
        </div>
      </div>

      {!loading && status && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50/90 p-3">
            <p className="text-xs font-medium text-slate-500">Today&apos;s Total Hours</p>
            <p className="text-xl font-semibold text-slate-900 mt-1">{formatHoursMinutes(displayTotalSeconds)}</p>
          </div>
          <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-blue-700">
              <Timer className="w-4 h-4" />
              Active Work Time
            </div>
            <p className="text-xl font-semibold text-blue-900 mt-1">
              {isClockedIn ? formatDuration(activeSeconds) : '00:00:00'}
            </p>
          </div>
        </div>
      )}

      {status?.forgot_clock_out_alert && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            Previous session appears open from {status.forgot_clock_out_from_date}. Please clock out before starting new shifts.
          </span>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <span>{error}</span>
          <button onClick={refreshStatus} className="font-semibold hover:text-red-800">Retry</button>
        </div>
      )}
    </div>
  );
}
