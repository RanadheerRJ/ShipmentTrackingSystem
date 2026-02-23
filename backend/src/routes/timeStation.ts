import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { AuthedRequest, requireAuth } from '../middleware/auth';

type TimeActionType = 'IN' | 'OUT';
type TimesheetStatus = 'Draft' | 'Pending Approval' | 'Approved' | 'Rejected';

interface ActorUser {
  id: string;
  name: string;
  role: string;
  organization_id: string | null;
}

interface TimeEntryRow {
  id: string;
  organization_id: string;
  user_id: string;
  action_type: TimeActionType;
  occurred_at_utc: string;
  local_date: string;
  timezone: string;
  ip_address: string | null;
  device_info: string | null;
  created_at: string;
  created_by: string | null;
}

interface SessionRow {
  in_entry_id: string;
  out_entry_id: string | null;
  clock_in_at_utc: string;
  clock_out_at_utc: string | null;
  local_date: string;
  duration_seconds: number;
  is_open: boolean;
}

interface TimesheetRow {
  id: string;
  organization_id: string;
  user_id: string;
  week_start: string;
  week_end: string;
  timezone: string;
  status: TimesheetStatus;
  submitted_at: string | null;
  submitted_by: string | null;
  admin_reviewed_at: string | null;
  admin_reviewed_by: string | null;
  admin_comment: string | null;
  forwarded_to_finance: number;
  finance_forwarded_at: string | null;
  finance_forwarded_by: string | null;
  created_at: string;
  updated_at: string;
  user_name?: string;
  user_email?: string;
  user_role?: string;
  admin_reviewer_name?: string;
}

const router = Router();
router.use(requireAuth);

const MAX_CLOCK_INS_PER_DAY = 2;
const MAX_CLOCK_OUTS_PER_DAY = 2;
const MAX_ACTIONS_PER_DAY = 4;
const ADMIN_VISIBLE_STATUSES: TimesheetStatus[] = ['Pending Approval', 'Approved', 'Rejected'];
const FINANCE_VISIBLE_STATUSES: TimesheetStatus[] = ['Pending Approval', 'Approved', 'Rejected'];

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDate(value: unknown) {
  const s = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  return s;
}

function normalizeTimezone(value: unknown) {
  const timezone = normalizeText(value);
  if (!timezone) return 'UTC';
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return 'UTC';
  }
}

function nowUtcIso() {
  return new Date().toISOString();
}

function localDateFromUtc(utcIso: string, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date(utcIso));
}

function addDays(dateISO: string, days: number) {
  const d = new Date(`${dateISO}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateISO;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekStartForDate(localDate: string) {
  const d = new Date(`${localDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return localDate;
  const mondayOffset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - mondayOffset);
  return d.toISOString().slice(0, 10);
}

function monthLabel(monthKey: string) {
  const d = new Date(`${monthKey}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return monthKey;
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function shiftMonth(localDate: string, monthDelta: number) {
  const d = new Date(`${localDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return localDate;
  d.setUTCMonth(d.getUTCMonth() + monthDelta);
  d.setUTCDate(1);
  return d.toISOString().slice(0, 10);
}

function getClientIp(req: AuthedRequest) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length) {
    return forwarded[0];
  }
  return req.socket.remoteAddress || '';
}

function getDeviceInfo(req: AuthedRequest) {
  const bodyDevice = normalizeText((req.body || {}).device_info);
  if (bodyDevice) return bodyDevice;
  const agent = req.headers['user-agent'];
  return typeof agent === 'string' ? agent.slice(0, 255) : 'Unknown device';
}

function isAdmin(actor: ActorUser) {
  return actor.role === 'OrgAdmin' || actor.role === 'SuperAdmin';
}

function isFinance(actor: ActorUser) {
  return actor.role === 'Finance';
}

function listEntriesForUser(userId: string) {
  return db.prepare(`
    SELECT
      id, organization_id, user_id, action_type, occurred_at_utc, local_date,
      COALESCE(timezone, 'UTC') as timezone,
      ip_address, device_info, created_at, created_by
    FROM time_entries
    WHERE user_id = ?
    ORDER BY occurred_at_utc ASC
  `).all(userId) as TimeEntryRow[];
}

function listEntriesForUserDateRange(userId: string, from: string, to: string) {
  return db.prepare(`
    SELECT
      id, organization_id, user_id, action_type, occurred_at_utc, local_date,
      COALESCE(timezone, 'UTC') as timezone,
      ip_address, device_info, created_at, created_by
    FROM time_entries
    WHERE user_id = ?
      AND local_date >= ?
      AND local_date <= ?
    ORDER BY occurred_at_utc ASC
  `).all(userId, from, to) as TimeEntryRow[];
}

function buildSessions(entries: TimeEntryRow[], nowIso: string) {
  const sessions: SessionRow[] = [];
  let openIn: TimeEntryRow | null = null;

  for (const entry of entries) {
    if (entry.action_type === 'IN') {
      if (!openIn) openIn = entry;
      continue;
    }

    if (!openIn) continue;
    const inMs = Date.parse(openIn.occurred_at_utc);
    const outMs = Date.parse(entry.occurred_at_utc);
    const durationSeconds = Number.isFinite(inMs) && Number.isFinite(outMs)
      ? Math.max(0, Math.floor((outMs - inMs) / 1000))
      : 0;

    sessions.push({
      in_entry_id: openIn.id,
      out_entry_id: entry.id,
      clock_in_at_utc: openIn.occurred_at_utc,
      clock_out_at_utc: entry.occurred_at_utc,
      local_date: openIn.local_date,
      duration_seconds: durationSeconds,
      is_open: false,
    });
    openIn = null;
  }

  if (openIn) {
    const inMs = Date.parse(openIn.occurred_at_utc);
    const nowMs = Date.parse(nowIso);
    const durationSeconds = Number.isFinite(inMs) && Number.isFinite(nowMs)
      ? Math.max(0, Math.floor((nowMs - inMs) / 1000))
      : 0;

    sessions.push({
      in_entry_id: openIn.id,
      out_entry_id: null,
      clock_in_at_utc: openIn.occurred_at_utc,
      clock_out_at_utc: null,
      local_date: openIn.local_date,
      duration_seconds: durationSeconds,
      is_open: true,
    });
  }

  return { sessions, openIn };
}

function ensureTimesheetForWeekStart(actor: ActorUser, weekStart: string, timezone: string, nowIso: string) {
  if (!actor.organization_id) return null;
  const weekEnd = addDays(weekStart, 6);

  const existing = db.prepare(`
    SELECT id
    FROM timesheets
    WHERE organization_id = ? AND user_id = ? AND week_start = ?
    LIMIT 1
  `).get(actor.organization_id, actor.id, weekStart) as { id?: string } | undefined;

  if (existing?.id) {
    db.prepare(`
      UPDATE timesheets
      SET timezone = ?, week_end = ?, updated_at = ?
      WHERE id = ?
    `).run(timezone, weekEnd, nowIso, existing.id);
    return existing.id;
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO timesheets (
      id, organization_id, user_id, week_start, week_end, timezone, status,
      submitted_at, submitted_by, admin_reviewed_at, admin_reviewed_by, admin_comment,
      forwarded_to_finance, finance_forwarded_at, finance_forwarded_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'Draft', NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, ?, ?)
  `).run(id, actor.organization_id, actor.id, weekStart, weekEnd, timezone, nowIso, nowIso);
  return id;
}

function ensureTimesheetForDate(actor: ActorUser, localDate: string, timezone: string, nowIso: string) {
  const weekStart = weekStartForDate(localDate);
  return ensureTimesheetForWeekStart(actor, weekStart, timezone, nowIso);
}

function autoSubmitPastDraftTimesheetsForUser(actor: ActorUser, currentLocalDate: string, nowIso: string) {
  if (!actor.organization_id) return;
  db.prepare(`
    UPDATE timesheets
    SET status = 'Pending Approval',
        submitted_at = COALESCE(submitted_at, ?),
        submitted_by = COALESCE(submitted_by, user_id),
        updated_at = ?
    WHERE organization_id = ?
      AND user_id = ?
      AND status = 'Draft'
      AND week_end < ?
  `).run(nowIso, nowIso, actor.organization_id, actor.id, currentLocalDate);
}

function autoSubmitPastDraftTimesheetsForOrg(organizationId: string | null, currentDate: string, nowIso: string) {
  if (!organizationId) {
    db.prepare(`
      UPDATE timesheets
      SET status = 'Pending Approval',
          submitted_at = COALESCE(submitted_at, ?),
          submitted_by = COALESCE(submitted_by, user_id),
          updated_at = ?
      WHERE status = 'Draft'
        AND week_end < ?
    `).run(nowIso, nowIso, currentDate);
    return;
  }

  db.prepare(`
    UPDATE timesheets
    SET status = 'Pending Approval',
        submitted_at = COALESCE(submitted_at, ?),
        submitted_by = COALESCE(submitted_by, user_id),
        updated_at = ?
    WHERE organization_id = ?
      AND status = 'Draft'
      AND week_end < ?
  `).run(nowIso, nowIso, organizationId, currentDate);
}

function getStatusPayload(actor: ActorUser, timezone: string) {
  const nowIso = nowUtcIso();
  const localDate = localDateFromUtc(nowIso, timezone);
  autoSubmitPastDraftTimesheetsForUser(actor, localDate, nowIso);

  const entries = listEntriesForUser(actor.id);
  const { sessions, openIn } = buildSessions(entries, nowIso);
  const todayEntries = entries.filter((entry) => entry.local_date === localDate);
  const todaySessions = sessions.filter((session) => session.local_date === localDate);

  const clockInsToday = todayEntries.filter((entry) => entry.action_type === 'IN').length;
  const clockOutsToday = todayEntries.filter((entry) => entry.action_type === 'OUT').length;
  const completedTodaySeconds = todaySessions
    .filter((session) => !session.is_open)
    .reduce((sum, session) => sum + session.duration_seconds, 0);
  const activeSeconds = openIn
    ? Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(openIn.occurred_at_utc)) / 1000))
    : 0;
  const activeTodaySeconds = openIn && openIn.local_date === localDate ? activeSeconds : 0;
  const forgotClockOutAlert = !!openIn && openIn.local_date < localDate;

  return {
    now_utc: nowIso,
    timezone,
    local_date: localDate,
    is_clocked_in: !!openIn,
    active_session_started_at_utc: openIn?.occurred_at_utc || null,
    active_work_seconds: activeSeconds,
    today: {
      local_date: localDate,
      clock_in_count: clockInsToday,
      clock_out_count: clockOutsToday,
      completed_work_seconds: completedTodaySeconds,
      total_work_seconds: completedTodaySeconds + activeTodaySeconds,
      remaining_clock_ins: Math.max(0, MAX_CLOCK_INS_PER_DAY - clockInsToday),
      remaining_clock_outs: Math.max(0, MAX_CLOCK_OUTS_PER_DAY - clockOutsToday),
      max_actions: MAX_ACTIONS_PER_DAY,
    },
    forgot_clock_out_alert: forgotClockOutAlert,
    forgot_clock_out_from_date: forgotClockOutAlert ? openIn?.local_date : null,
    recent_entries: entries.slice(-10).reverse(),
  };
}

function timesheetMetrics(userId: string, weekStart: string, weekEnd: string) {
  const entries = listEntriesForUserDateRange(userId, weekStart, weekEnd);
  const { sessions } = buildSessions(entries, nowUtcIso());
  const completedSeconds = sessions
    .filter((session) => !session.is_open && session.local_date >= weekStart && session.local_date <= weekEnd)
    .reduce((sum, session) => sum + session.duration_seconds, 0);
  const activeSeconds = sessions
    .filter((session) => session.is_open && session.local_date >= weekStart && session.local_date <= weekEnd)
    .reduce((sum, session) => sum + session.duration_seconds, 0);
  const daysWorked = new Set(
    sessions
      .filter((session) => session.local_date >= weekStart && session.local_date <= weekEnd)
      .map((session) => session.local_date)
  ).size;
  const clockIns = entries.filter((entry) => entry.action_type === 'IN').length;
  const clockOuts = entries.filter((entry) => entry.action_type === 'OUT').length;

  return {
    completed_work_seconds: completedSeconds,
    active_work_seconds: activeSeconds,
    total_work_seconds: completedSeconds + activeSeconds,
    days_worked: daysWorked,
    clock_in_count: clockIns,
    clock_out_count: clockOuts,
  };
}

function assertOrgActor(req: AuthedRequest, res: any) {
  const actor = req.user as ActorUser;
  if (!actor.organization_id) {
    res.status(400).json({ error: 'Time Station is available only for organization users' });
    return null;
  }
  return actor;
}

router.get('/status', (req: AuthedRequest, res) => {
  const actor = assertOrgActor(req, res);
  if (!actor) return;

  const timezone = normalizeTimezone((req.query as any).timezone);
  return res.json(getStatusPayload(actor, timezone));
});

router.post('/clock-in', (req: AuthedRequest, res) => {
  const actor = assertOrgActor(req, res);
  if (!actor) return;

  const timezone = normalizeTimezone((req.body || {}).timezone);
  const nowIso = nowUtcIso();
  const localDate = localDateFromUtc(nowIso, timezone);
  autoSubmitPastDraftTimesheetsForUser(actor, localDate, nowIso);

  const entries = listEntriesForUser(actor.id);
  const { openIn } = buildSessions(entries, nowIso);
  const todayEntries = entries.filter((entry) => entry.local_date === localDate);
  const clockInsToday = todayEntries.filter((entry) => entry.action_type === 'IN').length;
  const clockOutsToday = todayEntries.filter((entry) => entry.action_type === 'OUT').length;

  if (openIn) return res.status(400).json({ error: 'Already clocked in. Please clock out first.' });
  if (clockInsToday >= MAX_CLOCK_INS_PER_DAY) return res.status(400).json({ error: 'Daily clock-in limit reached (2).' });
  if (clockInsToday + clockOutsToday >= MAX_ACTIONS_PER_DAY) return res.status(400).json({ error: 'Daily action limit reached (2 clock-ins + 2 clock-outs).' });

  const id = uuidv4();
  const ipAddress = getClientIp(req);
  const deviceInfo = getDeviceInfo(req);
  db.prepare(`
    INSERT INTO time_entries (
      id, organization_id, user_id, action_type, occurred_at_utc, local_date, timezone,
      ip_address, device_info, created_at, created_by
    ) VALUES (?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?)
  `).run(id, actor.organization_id, actor.id, nowIso, localDate, timezone, ipAddress, deviceInfo, nowIso, actor.id);

  ensureTimesheetForDate(actor, localDate, timezone, nowIso);

  db.prepare(`
    INSERT INTO audit_logs (
      id, entity_type, entity_id, action_type, old_value, new_value,
      performed_by, performed_by_name, organization_id, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    'TimeEntry',
    id,
    'CREATE',
    null,
    JSON.stringify({
      action_type: 'IN',
      occurred_at_utc: nowIso,
      local_date: localDate,
      timezone,
      ip_address: ipAddress,
      device_info: deviceInfo,
    }),
    actor.id,
    actor.name,
    actor.organization_id,
    nowIso,
  );

  return res.json({
    success: true,
    message: 'Clocked in successfully',
    status: getStatusPayload(actor, timezone),
  });
});

router.post('/clock-out', (req: AuthedRequest, res) => {
  const actor = assertOrgActor(req, res);
  if (!actor) return;

  const timezone = normalizeTimezone((req.body || {}).timezone);
  const nowIso = nowUtcIso();
  const localDate = localDateFromUtc(nowIso, timezone);
  autoSubmitPastDraftTimesheetsForUser(actor, localDate, nowIso);

  const entries = listEntriesForUser(actor.id);
  const { openIn } = buildSessions(entries, nowIso);
  const todayEntries = entries.filter((entry) => entry.local_date === localDate);
  const clockInsToday = todayEntries.filter((entry) => entry.action_type === 'IN').length;
  const clockOutsToday = todayEntries.filter((entry) => entry.action_type === 'OUT').length;

  if (!openIn) return res.status(400).json({ error: 'Cannot clock out before clock in.' });
  if (clockOutsToday >= MAX_CLOCK_OUTS_PER_DAY) return res.status(400).json({ error: 'Daily clock-out limit reached (2).' });
  if (clockInsToday + clockOutsToday >= MAX_ACTIONS_PER_DAY) return res.status(400).json({ error: 'Daily action limit reached (2 clock-ins + 2 clock-outs).' });

  const id = uuidv4();
  const ipAddress = getClientIp(req);
  const deviceInfo = getDeviceInfo(req);
  db.prepare(`
    INSERT INTO time_entries (
      id, organization_id, user_id, action_type, occurred_at_utc, local_date, timezone,
      ip_address, device_info, created_at, created_by
    ) VALUES (?, ?, ?, 'OUT', ?, ?, ?, ?, ?, ?, ?)
  `).run(id, actor.organization_id, actor.id, nowIso, localDate, timezone, ipAddress, deviceInfo, nowIso, actor.id);

  ensureTimesheetForDate(actor, openIn.local_date, timezone, nowIso);
  ensureTimesheetForDate(actor, localDate, timezone, nowIso);

  db.prepare(`
    INSERT INTO audit_logs (
      id, entity_type, entity_id, action_type, old_value, new_value,
      performed_by, performed_by_name, organization_id, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    'TimeEntry',
    id,
    'CREATE',
    null,
    JSON.stringify({
      action_type: 'OUT',
      occurred_at_utc: nowIso,
      local_date: localDate,
      timezone,
      ip_address: ipAddress,
      device_info: deviceInfo,
    }),
    actor.id,
    actor.name,
    actor.organization_id,
    nowIso,
  );

  return res.json({
    success: true,
    message: 'Clocked out successfully',
    status: getStatusPayload(actor, timezone),
  });
});

router.get('/my/history', (req: AuthedRequest, res) => {
  const actor = assertOrgActor(req, res);
  if (!actor) return;

  const timezone = normalizeTimezone((req.query as any).timezone);
  const nowIso = nowUtcIso();
  const localDate = localDateFromUtc(nowIso, timezone);

  const defaultFrom = addDays(localDate, -13);
  const requestedFrom = normalizeDate((req.query as any).dateFrom);
  const requestedTo = normalizeDate((req.query as any).dateTo);
  const dateFrom = requestedFrom || defaultFrom;
  const dateTo = requestedTo || localDate;
  const safeFrom = dateFrom <= dateTo ? dateFrom : dateTo;
  const safeTo = dateFrom <= dateTo ? dateTo : dateFrom;

  autoSubmitPastDraftTimesheetsForUser(actor, localDate, nowIso);

  const allEntries = listEntriesForUser(actor.id);
  const inRangeEntries = allEntries.filter((entry) => entry.local_date >= safeFrom && entry.local_date <= safeTo);
  const { sessions } = buildSessions(allEntries, nowIso);
  const inRangeSessions = sessions.filter((session) => session.local_date >= safeFrom && session.local_date <= safeTo);

  const dailyMap = new Map<string, {
    local_date: string;
    clock_in_count: number;
    clock_out_count: number;
    completed_work_seconds: number;
    active_work_seconds: number;
    total_work_seconds: number;
  }>();

  for (const entry of inRangeEntries) {
    const row = dailyMap.get(entry.local_date) || {
      local_date: entry.local_date,
      clock_in_count: 0,
      clock_out_count: 0,
      completed_work_seconds: 0,
      active_work_seconds: 0,
      total_work_seconds: 0,
    };
    if (entry.action_type === 'IN') row.clock_in_count += 1;
    if (entry.action_type === 'OUT') row.clock_out_count += 1;
    dailyMap.set(entry.local_date, row);
  }

  for (const session of inRangeSessions) {
    const row = dailyMap.get(session.local_date) || {
      local_date: session.local_date,
      clock_in_count: 0,
      clock_out_count: 0,
      completed_work_seconds: 0,
      active_work_seconds: 0,
      total_work_seconds: 0,
    };
    if (session.is_open) row.active_work_seconds += session.duration_seconds;
    else row.completed_work_seconds += session.duration_seconds;
    row.total_work_seconds = row.completed_work_seconds + row.active_work_seconds;
    dailyMap.set(session.local_date, row);
  }

  const daily = Array.from(dailyMap.values()).sort((a, b) => b.local_date.localeCompare(a.local_date));

  return res.json({
    timezone,
    date_from: safeFrom,
    date_to: safeTo,
    entries: inRangeEntries.slice().reverse(),
    sessions: inRangeSessions.slice().reverse(),
    daily,
  });
});

router.get('/my/summary', (req: AuthedRequest, res) => {
  const actor = assertOrgActor(req, res);
  if (!actor) return;

  const period = normalizeText((req.query as any).period).toLowerCase();
  const limitRaw = Number((req.query as any).limit || 8);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(24, Math.floor(limitRaw))) : 8;
  const timezone = normalizeTimezone((req.query as any).timezone);
  const nowIso = nowUtcIso();
  const localDate = localDateFromUtc(nowIso, timezone);
  autoSubmitPastDraftTimesheetsForUser(actor, localDate, nowIso);

  if (period === 'monthly') {
    const startMonthDate = shiftMonth(localDate, -(limit - 1));
    const from = startMonthDate;
    const entries = listEntriesForUserDateRange(actor.id, from, localDate);
    const { sessions } = buildSessions(entries, nowIso);
    const monthly = new Map<string, { month: string; label: string; completed_work_seconds: number; active_work_seconds: number; total_work_seconds: number; session_count: number }>();

    for (const session of sessions) {
      const month = session.local_date.slice(0, 7);
      const existing = monthly.get(month) || {
        month,
        label: monthLabel(month),
        completed_work_seconds: 0,
        active_work_seconds: 0,
        total_work_seconds: 0,
        session_count: 0,
      };
      if (session.is_open) existing.active_work_seconds += session.duration_seconds;
      else existing.completed_work_seconds += session.duration_seconds;
      existing.total_work_seconds = existing.completed_work_seconds + existing.active_work_seconds;
      existing.session_count += 1;
      monthly.set(month, existing);
    }

    const rows = Array.from(monthly.values())
      .sort((a, b) => b.month.localeCompare(a.month))
      .slice(0, limit);
    return res.json({ period: 'monthly', rows });
  }

  const rows = db.prepare(`
    SELECT *
    FROM timesheets
    WHERE user_id = ?
    ORDER BY week_start DESC
    LIMIT ?
  `).all(actor.id, limit) as TimesheetRow[];

  const summary = rows.map((row) => ({
    ...row,
    forwarded_to_finance: !!row.forwarded_to_finance,
    ...timesheetMetrics(row.user_id, row.week_start, row.week_end),
  }));

  return res.json({ period: 'weekly', rows: summary });
});

router.post('/timesheets/submit', (req: AuthedRequest, res) => {
  const actor = assertOrgActor(req, res);
  if (!actor) return;

  const body = req.body || {};
  const timezone = normalizeTimezone(body.timezone);
  const nowIso = nowUtcIso();
  const localDate = localDateFromUtc(nowIso, timezone);
  autoSubmitPastDraftTimesheetsForUser(actor, localDate, nowIso);

  const requestedWeekStart = normalizeDate(body.week_start);
  const weekStart = requestedWeekStart || weekStartForDate(localDate);
  const weekEnd = addDays(weekStart, 6);

  const allEntries = listEntriesForUser(actor.id);
  const { sessions, openIn } = buildSessions(allEntries, nowIso);
  if (openIn) {
    return res.status(400).json({ error: 'Please clock out before submitting time.' });
  }

  const weekEntries = allEntries.filter((entry) => entry.local_date >= weekStart && entry.local_date <= weekEnd);
  if (!weekEntries.length) {
    return res.status(400).json({ error: 'No time entries found for selected week.' });
  }

  const hasCompletedSession = sessions.some((session) => (
    !session.is_open
    && session.local_date >= weekStart
    && session.local_date <= weekEnd
  ));
  if (!hasCompletedSession) {
    return res.status(400).json({ error: 'At least one completed clock in/out session is required before submitting.' });
  }

  const timesheetId = ensureTimesheetForWeekStart(actor, weekStart, timezone, nowIso);
  if (!timesheetId) return res.status(400).json({ error: 'Unable to resolve timesheet.' });

  const timesheet = db.prepare(`
    SELECT *
    FROM timesheets
    WHERE id = ?
    LIMIT 1
  `).get(timesheetId) as TimesheetRow | undefined;
  if (!timesheet) return res.status(404).json({ error: 'Timesheet not found' });

  if (timesheet.status === 'Approved') {
    return res.status(400).json({ error: 'Approved timesheet cannot be re-submitted.' });
  }
  if (timesheet.status === 'Pending Approval') {
    return res.json({ success: true, id: timesheet.id, status: timesheet.status, already_submitted: true });
  }

  db.prepare(`
    UPDATE timesheets
    SET status = 'Pending Approval',
        submitted_at = ?,
        submitted_by = ?,
        admin_reviewed_at = NULL,
        admin_reviewed_by = NULL,
        admin_comment = NULL,
        forwarded_to_finance = 0,
        finance_forwarded_at = NULL,
        finance_forwarded_by = NULL,
        updated_at = ?
    WHERE id = ?
  `).run(nowIso, actor.id, nowIso, timesheet.id);

  db.prepare(`
    INSERT INTO audit_logs (
      id, entity_type, entity_id, action_type, old_value, new_value,
      performed_by, performed_by_name, organization_id, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    'Timesheet',
    timesheet.id,
    'UPDATE',
    JSON.stringify({ status: timesheet.status, submitted_at: timesheet.submitted_at }),
    JSON.stringify({ status: 'Pending Approval', submitted_at: nowIso, submitted_by: actor.id }),
    actor.id,
    actor.name,
    actor.organization_id,
    nowIso,
  );

  return res.json({ success: true, id: timesheet.id, status: 'Pending Approval' });
});

router.get('/timesheets', (req: AuthedRequest, res) => {
  const actor = assertOrgActor(req, res);
  if (!actor) return;

  const q = req.query as any;
  const nowIso = nowUtcIso();
  const timezone = normalizeTimezone(q.timezone);
  const currentDate = localDateFromUtc(nowIso, timezone);
  autoSubmitPastDraftTimesheetsForOrg(actor.role === 'SuperAdmin' ? normalizeText(q.organizationId) || null : actor.organization_id, currentDate, nowIso);

  const where: string[] = [];
  const params: any[] = [];

  if (actor.role === 'SuperAdmin') {
    const organizationId = normalizeText(q.organizationId);
    if (organizationId) {
      where.push('t.organization_id = ?');
      params.push(organizationId);
    }
  } else {
    where.push('t.organization_id = ?');
    params.push(actor.organization_id);
  }

  const requestedUserId = normalizeText(q.userId);
  if (!isAdmin(actor) && !isFinance(actor) && actor.role !== 'SuperAdmin') {
    where.push('t.user_id = ?');
    params.push(actor.id);
  } else if (requestedUserId) {
    where.push('t.user_id = ?');
    params.push(requestedUserId);
  }

  const requestedStatus = normalizeText(q.status) as TimesheetStatus;
  const validStatuses: TimesheetStatus[] = ['Draft', 'Pending Approval', 'Approved', 'Rejected'];
  if (requestedStatus && !validStatuses.includes(requestedStatus)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  if (isFinance(actor)) {
    if (requestedStatus && !FINANCE_VISIBLE_STATUSES.includes(requestedStatus)) {
      return res.status(403).json({ error: 'Finance can view only submitted timesheets' });
    }
    if (requestedStatus) {
      where.push('t.status = ?');
      params.push(requestedStatus);
    } else {
      where.push(`t.status IN ('Pending Approval', 'Approved', 'Rejected')`);
    }
  } else if (isAdmin(actor) || actor.role === 'SuperAdmin') {
    if (requestedStatus && !ADMIN_VISIBLE_STATUSES.includes(requestedStatus)) {
      return res.status(403).json({ error: 'Admin can view only submitted timesheets' });
    }
    if (requestedStatus) {
      where.push('t.status = ?');
      params.push(requestedStatus);
    } else {
      where.push(`t.status IN ('Pending Approval', 'Approved', 'Rejected')`);
    }
  } else if (requestedStatus) {
    where.push('t.status = ?');
    params.push(requestedStatus);
  }

  const weekStart = normalizeDate(q.weekStart);
  if (weekStart) {
    where.push('t.week_start = ?');
    params.push(weekStart);
  }
  const weekFrom = normalizeDate(q.weekFrom);
  if (weekFrom) {
    where.push('t.week_start >= ?');
    params.push(weekFrom);
  }
  const weekTo = normalizeDate(q.weekTo);
  if (weekTo) {
    where.push('t.week_start <= ?');
    params.push(weekTo);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT
      t.*,
      u.name as user_name,
      u.email as user_email,
      u.role as user_role,
      reviewer.name as admin_reviewer_name
    FROM timesheets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN users reviewer ON reviewer.id = t.admin_reviewed_by
    ${whereSql}
    ORDER BY t.week_start DESC, u.name ASC
    LIMIT 500
  `).all(...params) as TimesheetRow[];

  const enriched = rows.map((row) => ({
    ...row,
    forwarded_to_finance: !!row.forwarded_to_finance,
    ...timesheetMetrics(row.user_id, row.week_start, row.week_end),
  }));

  return res.json(enriched);
});

router.post('/timesheets/:id/review', (req: AuthedRequest, res) => {
  const actor = assertOrgActor(req, res);
  if (!actor) return;
  if (!isAdmin(actor)) return res.status(403).json({ error: 'Only admins can review timesheets' });

  const { id } = req.params;
  const decision = normalizeText((req.body || {}).decision).toLowerCase();
  const adminComment = normalizeText((req.body || {}).comment) || null;
  if (decision !== 'approve' && decision !== 'reject') {
    return res.status(400).json({ error: 'decision must be approve or reject' });
  }

  const timesheet = db.prepare('SELECT * FROM timesheets WHERE id = ?').get(id) as TimesheetRow | undefined;
  if (!timesheet) return res.status(404).json({ error: 'Timesheet not found' });
  if (actor.role !== 'SuperAdmin' && timesheet.organization_id !== actor.organization_id) {
    return res.status(403).json({ error: 'Insufficient role' });
  }
  if (timesheet.status !== 'Pending Approval') {
    return res.status(400).json({ error: 'Only Pending Approval timesheets can be reviewed' });
  }

  const nowIso = nowUtcIso();
  const nextStatus: TimesheetStatus = decision === 'approve' ? 'Approved' : 'Rejected';
  const forwardedFlag = decision === 'approve' ? timesheet.forwarded_to_finance : 0;
  const forwardedAt = decision === 'approve' ? timesheet.finance_forwarded_at : null;
  const forwardedBy = decision === 'approve' ? timesheet.finance_forwarded_by : null;

  db.prepare(`
    UPDATE timesheets
    SET status = ?,
        admin_reviewed_at = ?,
        admin_reviewed_by = ?,
        admin_comment = ?,
        forwarded_to_finance = ?,
        finance_forwarded_at = ?,
        finance_forwarded_by = ?,
        updated_at = ?
    WHERE id = ?
  `).run(nextStatus, nowIso, actor.id, adminComment, forwardedFlag, forwardedAt, forwardedBy, nowIso, id);

  db.prepare(`
    INSERT INTO audit_logs (
      id, entity_type, entity_id, action_type, old_value, new_value,
      performed_by, performed_by_name, organization_id, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    'Timesheet',
    id,
    'UPDATE',
    JSON.stringify({ status: timesheet.status, admin_comment: timesheet.admin_comment }),
    JSON.stringify({ status: nextStatus, admin_comment: adminComment, reviewed_by: actor.id }),
    actor.id,
    actor.name,
    timesheet.organization_id,
    nowIso,
  );

  return res.json({ success: true, id, status: nextStatus });
});

router.post('/timesheets/:id/forward', (req: AuthedRequest, res) => {
  const actor = assertOrgActor(req, res);
  if (!actor) return;
  if (!isAdmin(actor)) return res.status(403).json({ error: 'Only admins can forward timesheets to Finance' });

  const { id } = req.params;
  const timesheet = db.prepare('SELECT * FROM timesheets WHERE id = ?').get(id) as TimesheetRow | undefined;
  if (!timesheet) return res.status(404).json({ error: 'Timesheet not found' });
  if (actor.role !== 'SuperAdmin' && timesheet.organization_id !== actor.organization_id) {
    return res.status(403).json({ error: 'Insufficient role' });
  }
  if (timesheet.status !== 'Approved') {
    return res.status(400).json({ error: 'Only approved timesheets can be forwarded to Finance' });
  }
  if (timesheet.forwarded_to_finance) {
    return res.json({ success: true, id, forwarded_to_finance: true, already_forwarded: true });
  }

  const nowIso = nowUtcIso();
  db.prepare(`
    UPDATE timesheets
    SET forwarded_to_finance = 1,
        finance_forwarded_at = ?,
        finance_forwarded_by = ?,
        updated_at = ?
    WHERE id = ?
  `).run(nowIso, actor.id, nowIso, id);

  db.prepare(`
    INSERT INTO audit_logs (
      id, entity_type, entity_id, action_type, old_value, new_value,
      performed_by, performed_by_name, organization_id, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    'Timesheet',
    id,
    'UPDATE',
    JSON.stringify({ forwarded_to_finance: false }),
    JSON.stringify({ forwarded_to_finance: true, finance_forwarded_by: actor.id }),
    actor.id,
    actor.name,
    timesheet.organization_id,
    nowIso,
  );

  return res.json({ success: true, id, forwarded_to_finance: true });
});

export default router;
