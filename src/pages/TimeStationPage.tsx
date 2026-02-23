import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar, Download, FileText, CheckCircle2, XCircle, Send, RefreshCw,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../api/client';
import type { TimeHistoryResponse, TimesheetRow, User } from '../types';
import { formatDuration, formatHoursMinutes, useTimeStationStatus } from '../hooks/useTimeStation';

function dateISO(daysOffset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}

function weekStartForDate(localDate: string) {
  const d = new Date(`${localDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return localDate;
  const mondayOffset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - mondayOffset);
  return d.toISOString().slice(0, 10);
}

function toCsvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Array<unknown>>) {
  const csv = rows.map((row) => row.map(toCsvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function TimeStationPage() {
  const { user, hasRole } = useAuth();
  const canReview = hasRole('SuperAdmin', 'OrgAdmin');
  const isFinance = hasRole('Finance');
  const canViewOrgTimesheets = canReview || isFinance;
  const orgId = user?.organization_id || '';

  const {
    status,
    loading: loadingStatus,
    actionLoading,
    error: statusError,
    activeElapsedSeconds,
    refreshStatus,
    clockIn,
    clockOut,
    timezone,
  } = useTimeStationStatus(!!orgId);

  const [dateFrom, setDateFrom] = useState(() => dateISO(-13));
  const [dateTo, setDateTo] = useState(() => dateISO(0));
  const [history, setHistory] = useState<TimeHistoryResponse | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const [weeklyRows, setWeeklyRows] = useState<TimesheetRow[]>([]);
  const [monthlyRows, setMonthlyRows] = useState<Array<{ month: string; label: string; completed_work_seconds: number; active_work_seconds: number; total_work_seconds: number; session_count: number }>>([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState('');

  const [timesheets, setTimesheets] = useState<TimesheetRow[]>([]);
  const [loadingTimesheets, setLoadingTimesheets] = useState(false);
  const [timesheetError, setTimesheetError] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(isFinance ? '' : 'Pending Approval');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [weekFrom, setWeekFrom] = useState('');
  const [weekTo, setWeekTo] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [actionRowId, setActionRowId] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [submitSelectedLoading, setSubmitSelectedLoading] = useState(false);
  const [submitSelectedError, setSubmitSelectedError] = useState('');

  const loadHistory = useCallback(async () => {
    if (!orgId) return;
    setLoadingHistory(true);
    setHistoryError('');
    try {
      const query = new URLSearchParams({
        dateFrom,
        dateTo,
        timezone,
      });
      const res = await apiClient.authFetch(`/time-station/my/history?${query.toString()}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((payload as any)?.error || 'Failed loading time history');
      setHistory(payload as TimeHistoryResponse);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed loading time history';
      setHistoryError(message);
      setHistory(null);
    } finally {
      setLoadingHistory(false);
    }
  }, [dateFrom, dateTo, orgId, timezone]);

  const loadSummary = useCallback(async () => {
    if (!orgId) return;
    setLoadingSummary(true);
    setSummaryError('');
    try {
      const [weeklyRes, monthlyRes] = await Promise.all([
        apiClient.authFetch(`/time-station/my/summary?period=weekly&limit=12&timezone=${encodeURIComponent(timezone)}`),
        apiClient.authFetch(`/time-station/my/summary?period=monthly&limit=12&timezone=${encodeURIComponent(timezone)}`),
      ]);

      const weeklyPayload = await weeklyRes.json().catch(() => ({}));
      const monthlyPayload = await monthlyRes.json().catch(() => ({}));
      if (!weeklyRes.ok) throw new Error((weeklyPayload as any)?.error || 'Failed loading weekly summary');
      if (!monthlyRes.ok) throw new Error((monthlyPayload as any)?.error || 'Failed loading monthly summary');

      setWeeklyRows(Array.isArray((weeklyPayload as any)?.rows) ? (weeklyPayload as any).rows : []);
      setMonthlyRows(Array.isArray((monthlyPayload as any)?.rows) ? (monthlyPayload as any).rows : []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed loading summaries';
      setSummaryError(message);
      setWeeklyRows([]);
      setMonthlyRows([]);
    } finally {
      setLoadingSummary(false);
    }
  }, [orgId, timezone]);

  const loadUsers = useCallback(async () => {
    if (!orgId || !canReview) return;
    try {
      const res = await apiClient.authFetch(`/users?organizationId=${orgId}`);
      const payload = await res.json().catch(() => ([]));
      if (!res.ok || !Array.isArray(payload)) {
        setUsers([]);
        return;
      }
      const activeUsers = (payload as User[]).filter((entry) => entry.is_active);
      setUsers(activeUsers.sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      setUsers([]);
    }
  }, [canReview, orgId]);

  const loadTimesheets = useCallback(async () => {
    if (!canViewOrgTimesheets || !orgId) return;
    setLoadingTimesheets(true);
    setTimesheetError('');
    try {
      const query = new URLSearchParams({ timezone });
      if (statusFilter) query.set('status', statusFilter);
      if (selectedUserId) query.set('userId', selectedUserId);
      if (weekFrom) query.set('weekFrom', weekFrom);
      if (weekTo) query.set('weekTo', weekTo);
      if (hasRole('SuperAdmin')) query.set('organizationId', orgId);

      const res = await apiClient.authFetch(`/time-station/timesheets?${query.toString()}`);
      const payload = await res.json().catch(() => ([]));
      if (!res.ok) throw new Error((payload as any)?.error || 'Failed loading timesheets');
      setTimesheets(Array.isArray(payload) ? payload as TimesheetRow[] : []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed loading timesheets';
      setTimesheetError(message);
      setTimesheets([]);
    } finally {
      setLoadingTimesheets(false);
    }
  }, [canViewOrgTimesheets, hasRole, orgId, selectedUserId, statusFilter, timezone, weekFrom, weekTo]);

  useEffect(() => {
    loadHistory();
    loadSummary();
  }, [loadHistory, loadSummary]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    loadTimesheets();
  }, [loadTimesheets]);

  const handleClockAction = useCallback(async (action: 'in' | 'out') => {
    const result = action === 'in' ? await clockIn() : await clockOut();
    if (result.success) {
      refreshStatus();
      loadHistory();
      loadSummary();
      if (canViewOrgTimesheets) loadTimesheets();
    }
  }, [canViewOrgTimesheets, clockIn, clockOut, loadHistory, loadSummary, loadTimesheets, refreshStatus]);

  const reviewTimesheet = useCallback(async (row: TimesheetRow, decision: 'approve' | 'reject') => {
    setActionRowId(row.id);
    try {
      let comment = '';
      if (decision === 'reject') {
        comment = (window.prompt('Reason for rejection (required):') || '').trim();
        if (!comment) {
          setActionRowId('');
          return;
        }
      }
      const res = await apiClient.authFetch(`/time-station/timesheets/${row.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision, comment }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((payload as any)?.error || 'Action failed');
      await loadTimesheets();
      await loadSummary();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Action failed';
      alert(message);
    } finally {
      setActionRowId('');
    }
  }, [loadSummary, loadTimesheets]);

  const forwardTimesheet = useCallback(async (row: TimesheetRow) => {
    setActionRowId(row.id);
    try {
      const res = await apiClient.authFetch(`/time-station/timesheets/${row.id}/forward`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((payload as any)?.error || 'Failed forwarding to Finance');
      await loadTimesheets();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Action failed';
      alert(message);
    } finally {
      setActionRowId('');
    }
  }, [loadTimesheets]);

  const exportPersonalCsv = () => {
    if (!history) return;
    const header = ['Date', 'Clock Ins', 'Clock Outs', 'Completed (HH:MM:SS)', 'Active (HH:MM:SS)', 'Total (HH:MM:SS)'];
    const rows = history.daily.map((row) => [
      row.local_date,
      row.clock_in_count,
      row.clock_out_count,
      formatDuration(row.completed_work_seconds),
      formatDuration(row.active_work_seconds),
      formatDuration(row.total_work_seconds),
    ]);
    downloadCsv(`time_station_${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows]);
  };

  const printPersonalPdf = () => {
    if (!history) return;
    const popup = window.open('', '_blank');
    if (!popup) return;

    const rowsHtml = history.daily.map((row) => `
      <tr>
        <td>${row.local_date}</td>
        <td>${row.clock_in_count}</td>
        <td>${row.clock_out_count}</td>
        <td>${formatDuration(row.total_work_seconds)}</td>
      </tr>
    `).join('');

    popup.document.write(`
      <html>
        <head>
          <title>Time Station Report</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; }
            h1 { margin: 0 0 8px; }
            p { color: #555; margin: 0 0 16px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
            th { background: #f5f7fb; }
          </style>
        </head>
        <body>
          <h1>Time Station Report</h1>
          <p>${user?.name || 'User'} | ${history.date_from} to ${history.date_to}</p>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Clock Ins</th>
                <th>Clock Outs</th>
                <th>Total Time</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </body>
      </html>
    `);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  const filteredTimesheets = useMemo(() => timesheets, [timesheets]);
  const currentWeekStart = useMemo(
    () => weekStartForDate(status?.local_date || dateISO(0)),
    [status?.local_date],
  );
  const currentWeekRow = useMemo(
    () => weeklyRows.find((row) => row.week_start === currentWeekStart),
    [weeklyRows, currentWeekStart],
  );
  const currentWeekStatus = currentWeekRow?.status || 'Draft';
  const timesheetColSpan = canReview ? 8 : 7;

  const submitCurrentWeekTime = useCallback(async () => {
    if (!status) return;
    setSubmitLoading(true);
    setSubmitError('');
    try {
      const res = await apiClient.authFetch('/time-station/timesheets/submit', {
        method: 'POST',
        body: JSON.stringify({
          timezone,
          week_start: currentWeekStart,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((payload as any)?.error || 'Failed submitting time');
      await refreshStatus();
      await loadSummary();
      if (canViewOrgTimesheets) await loadTimesheets();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed submitting time';
      setSubmitError(message);
    } finally {
      setSubmitLoading(false);
    }
  }, [canViewOrgTimesheets, currentWeekStart, loadSummary, loadTimesheets, refreshStatus, status, timezone]);

  const toggleSelectDate = useCallback((localDate: string) => {
    setSelectedDates((prev) => (prev.includes(localDate) ? prev.filter((d) => d !== localDate) : [...prev, localDate]));
  }, []);

  const submitSelected = useCallback(async () => {
    if (!selectedDates.length) return;
    setSubmitSelectedLoading(true);
    setSubmitSelectedError('');
    try {
      const weeks = Array.from(new Set(selectedDates.map((d) => weekStartForDate(d))));
      for (const week_start of weeks) {
        const res = await apiClient.authFetch('/time-station/timesheets/submit', {
          method: 'POST',
          body: JSON.stringify({ timezone, week_start }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((payload as any)?.error || `Failed submitting week ${week_start}`);
      }
      await refreshStatus();
      await loadHistory();
      await loadSummary();
      if (canViewOrgTimesheets) await loadTimesheets();
      setSelectedDates([]);
      // small success hint
      window.alert('Selected weeks submitted for approval');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed submitting selected weeks';
      setSubmitSelectedError(message);
    } finally {
      setSubmitSelectedLoading(false);
    }
  }, [selectedDates, timezone, refreshStatus, loadHistory, loadSummary, loadTimesheets, canViewOrgTimesheets]);

  const exportTimesheetsCsv = () => {
    if (!filteredTimesheets.length) return;
    const header = ['User', 'Role', 'Week Start', 'Week End', 'Status', 'Reviewed By', 'Review Note', 'Total Hours', 'Days Worked', 'Forwarded To Finance'];
    const rows = filteredTimesheets.map((row) => ([
      row.user_name || row.user_id,
      row.user_role || '-',
      row.week_start,
      row.week_end,
      row.status,
      row.admin_reviewer_name || row.admin_reviewed_by || '-',
      row.admin_comment || '-',
      formatDuration(row.total_work_seconds),
      row.days_worked,
      row.forwarded_to_finance ? 'Yes' : 'No',
    ]));
    downloadCsv(`timesheets_${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows]);
  };

  if (!orgId) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Time Station is available for organization users only.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Time Station</h1>
          <p className="text-sm text-slate-500 mt-1">
            Daily clock tracking, weekly approvals, and payroll-ready summaries.
          </p>
        </div>
        <button
          onClick={() => {
            refreshStatus();
            loadHistory();
            loadSummary();
            loadTimesheets();
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_36px_-30px_rgba(15,23,42,0.75)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Live Actions</p>
            <h2 className="text-lg font-semibold text-slate-900 mt-1">Clock In / Clock Out</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleClockAction('in')}
              disabled={loadingStatus || actionLoading || !!status?.is_clocked_in}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              Clock In
            </button>
            <button
              onClick={() => handleClockAction('out')}
              disabled={loadingStatus || actionLoading || !status?.is_clocked_in}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              Clock Out
            </button>
            {/* Submit moved into Daily Log History with per-day selection */}
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Current Week Status: <span className="font-semibold text-slate-700">{currentWeekStatus}</span>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-xl border border-blue-200 bg-blue-50/80 px-3 py-3">
            <p className="text-xs font-medium text-blue-700">Active Work Time</p>
            <p className="text-xl font-semibold text-blue-900 mt-1">
              {status?.is_clocked_in ? formatDuration(activeElapsedSeconds) : '00:00:00'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3">
            <p className="text-xs font-medium text-slate-500">Today&apos;s Total Hours</p>
            <p className="text-xl font-semibold text-slate-900 mt-1">
              {status ? formatHoursMinutes(status.today.total_work_seconds) : '--'}
            </p>
          </div>
        </div>

        {status?.forgot_clock_out_alert && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Open session detected from {status.forgot_clock_out_from_date}. Please clock out before new clock-ins.
          </div>
        )}
        {statusError && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {statusError}
          </div>
        )}
        {submitError && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {submitError}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_36px_-30px_rgba(15,23,42,0.75)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Daily Log History</h3>
              <p className="text-xs text-slate-500 mt-1">Review your date-wise attendance and tracked time.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={exportPersonalCsv}
                disabled={!history?.daily?.length}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Download className="w-4 h-4" /> CSV
              </button>
              <button
                onClick={printPersonalPdf}
                disabled={!history?.daily?.length}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <FileText className="w-4 h-4" /> PDF
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Date From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Date To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={loadHistory}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Calendar className="w-4 h-4" /> Apply
            </button>
          </div>

          {loadingHistory ? (
            <p className="mt-4 text-sm text-slate-500">Loading history...</p>
          ) : historyError ? (
            <p className="mt-4 text-sm text-red-600">{historyError}</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70">
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Select</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Date</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Clock In</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Clock Out</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Completed</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Active</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {history?.daily?.length ? history.daily.map((row) => (
                    <tr key={row.local_date} className="border-b border-slate-100">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedDates.includes(row.local_date)}
                          onChange={() => toggleSelectDate(row.local_date)}
                          disabled={!(row.clock_in_count > 0 && row.clock_out_count > 0)}
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-900">{row.local_date}</td>
                      <td className="px-3 py-2 text-slate-600">{row.clock_in_count}</td>
                      <td className="px-3 py-2 text-slate-600">{row.clock_out_count}</td>
                      <td className="px-3 py-2 text-slate-700">{formatDuration(row.completed_work_seconds)}</td>
                      <td className="px-3 py-2 text-slate-700">{formatDuration(row.active_work_seconds)}</td>
                      <td className="px-3 py-2 font-semibold text-slate-900">{formatDuration(row.total_work_seconds)}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-slate-500">No records in selected range</td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="mt-3 flex items-center justify-between">
                <div>
                  {submitSelectedError && (
                    <p className="text-sm text-red-600">{submitSelectedError}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedDates([])}
                    disabled={!selectedDates.length || submitSelectedLoading}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Clear
                  </button>
                  <button
                    onClick={submitSelected}
                    disabled={!selectedDates.length || submitSelectedLoading}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {submitSelectedLoading ? 'Submitting...' : 'Submit Selected'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_36px_-30px_rgba(15,23,42,0.75)]">
          <h3 className="text-lg font-semibold text-slate-900">Time Summary</h3>
          {loadingSummary ? (
            <p className="mt-3 text-sm text-slate-500">Loading summaries...</p>
          ) : (
            <div className="mt-3 rounded-xl border border-slate-200 p-3">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Weekly</p>
                  <div className="mt-2 space-y-2">
                    {weeklyRows.length ? weeklyRows.slice(0, 4).map((row) => (
                      <div key={row.id} className="rounded-lg border border-slate-200 px-3 py-2">
                        <p className="text-xs text-slate-500">{row.week_start} to {row.week_end}</p>
                        <p className="font-semibold text-slate-900 mt-1">{formatHoursMinutes(row.total_work_seconds)}</p>
                        <p className="text-xs text-slate-500 mt-1">{row.days_worked} working day(s)</p>
                      </div>
                    )) : <p className="text-sm text-slate-500">No weekly rows yet.</p>}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Monthly</p>
                  <div className="mt-2 space-y-2">
                    {monthlyRows.length ? monthlyRows.slice(0, 4).map((row) => (
                      <div key={row.month} className="rounded-lg border border-slate-200 px-3 py-2">
                        <p className="text-xs text-slate-500">{row.label}</p>
                        <p className="font-semibold text-slate-900 mt-1">{formatHoursMinutes(row.total_work_seconds)}</p>
                        <p className="text-xs text-slate-500 mt-1">{row.session_count} session(s)</p>
                      </div>
                    )) : <p className="text-sm text-slate-500">No monthly rows yet.</p>}
                  </div>
                </div>
              </div>
            </div>
          )}
          {summaryError && <p className="mt-3 text-sm text-red-600">{summaryError}</p>}
        </div>
      </div>

      {canViewOrgTimesheets && (
        <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_36px_-30px_rgba(15,23,42,0.75)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                {canReview ? 'Admin Approval Dashboard' : 'Finance Timesheet View'}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {canReview
                  ? 'Review pending timesheets and forward approved records to Finance.'
                  : 'View admin-approved and pending approval timesheets.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">{filteredTimesheets.length} row(s)</span>
              <button
                onClick={exportTimesheetsCsv}
                disabled={!filteredTimesheets.length}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">All</option>
                <option value="Pending Approval">Pending Approval</option>
                <option value="Approved">Approved</option>
                <option value="Rejected">Rejected</option>
              </select>
            </div>
            {canReview && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">User</label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">All Users</option>
                  {users.map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.name} ({entry.role})</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Week From</label>
              <input
                type="date"
                value={weekFrom}
                onChange={(e) => setWeekFrom(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Week To</label>
              <input
                type="date"
                value={weekTo}
                onChange={(e) => setWeekTo(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                onClick={loadTimesheets}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Apply
              </button>
              <button
                onClick={() => {
                  setStatusFilter(isFinance ? '' : 'Pending Approval');
                  setSelectedUserId('');
                  setWeekFrom('');
                  setWeekTo('');
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Reset
              </button>
            </div>
          </div>

          {timesheetError && <p className="mt-3 text-sm text-red-600">{timesheetError}</p>}
          {loadingTimesheets ? (
            <p className="mt-3 text-sm text-slate-500">Loading timesheets...</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70">
                    <th className="px-3 py-2 text-left font-medium text-slate-600">User</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Week</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Status</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Total</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Days</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Finance</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Review</th>
                    {canReview && <th className="px-3 py-2 text-right font-medium text-slate-600">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredTimesheets.length ? filteredTimesheets.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-900">{row.user_name || row.user_id.slice(0, 8)}</p>
                        <p className="text-xs text-slate-500">{row.user_role || '-'}</p>
                      </td>
                      <td className="px-3 py-2 text-slate-700">{row.week_start} to {row.week_end}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                          row.status === 'Approved' ? 'bg-emerald-100 text-emerald-700'
                            : row.status === 'Pending Approval' ? 'bg-amber-100 text-amber-700'
                              : row.status === 'Rejected' ? 'bg-red-100 text-red-700'
                                : 'bg-slate-100 text-slate-700'
                        }`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-900 font-semibold">{formatHoursMinutes(row.total_work_seconds)}</td>
                      <td className="px-3 py-2 text-slate-700">{row.days_worked}</td>
                      <td className="px-3 py-2">
                        {row.forwarded_to_finance ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Forwarded
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500">Not forwarded</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {row.status === 'Approved' && (
                          <>
                            <p className="text-xs font-medium text-emerald-700">
                              Approved by {row.admin_reviewer_name || row.admin_reviewed_by || '-'}
                            </p>
                            {row.admin_comment && <p className="mt-1 text-xs text-slate-600">{row.admin_comment}</p>}
                          </>
                        )}
                        {row.status === 'Rejected' && (
                          <>
                            <p className="text-xs font-medium text-red-700">
                              Rejected by {row.admin_reviewer_name || row.admin_reviewed_by || '-'}
                            </p>
                            <p className="mt-1 text-xs text-red-700">{row.admin_comment || 'Reason not provided'}</p>
                          </>
                        )}
                        {row.status === 'Pending Approval' && (
                          <p className="text-xs text-amber-700">Awaiting admin review</p>
                        )}
                        {row.status === 'Draft' && (
                          <p className="text-xs text-slate-500">Not submitted</p>
                        )}
                      </td>
                      {canReview && (
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {row.status === 'Pending Approval' && (
                              <>
                                <button
                                  onClick={() => reviewTimesheet(row, 'approve')}
                                  disabled={actionRowId === row.id}
                                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                                </button>
                                <button
                                  onClick={() => reviewTimesheet(row, 'reject')}
                                  disabled={actionRowId === row.id}
                                  className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
                                >
                                  <XCircle className="w-3.5 h-3.5" /> Reject
                                </button>
                              </>
                            )}
                            {row.status === 'Approved' && !row.forwarded_to_finance && (
                              <button
                                onClick={() => forwardTimesheet(row)}
                                disabled={actionRowId === row.id}
                                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                              >
                                <Send className="w-3.5 h-3.5" /> Forward
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={timesheetColSpan} className="px-3 py-8 text-center text-slate-500">No timesheets found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
