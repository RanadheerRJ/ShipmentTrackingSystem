import { Router } from 'express';
import db from '../db';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, AuthedRequest } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const TRACKING_MANAGER_ROLES = new Set(['FRONT_DESK', 'OrgAdmin', 'SuperAdmin']);
const SHIPMENT_CREATOR_ROLES = new Set(['Paralegal', 'Attorney', 'FRONT_DESK', 'OrgAdmin', 'SuperAdmin']);
const SHIPMENT_EDITOR_ROLES = new Set(['FRONT_DESK', 'OrgAdmin', 'SuperAdmin', 'Finance']);
const WIDE_SHIPMENT_ACCESS_ROLES = new Set(['FRONT_DESK', 'OrgAdmin', 'SuperAdmin']);
const SHIPMENT_DELETE_ALL_ROLES = new Set(['FRONT_DESK', 'OrgAdmin', 'SuperAdmin']);

const SHIPMENT_SORT_FIELDS = new Set([
  'created_at',
  'updated_at',
  'beneficiary_name',
  'petitioner_name',
  'tracking_number',
  'status',
  'payment_status',
  'ship_date',
]);

function currentShipDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNullableText(value: unknown) {
  const s = normalizeText(value);
  return s || null;
}

function asDbBool(value: unknown) {
  return value ? 1 : 0;
}

function getOrgIdForRequest(req: AuthedRequest, requestedOrgId?: string | null) {
  if (req.user.role === 'SuperAdmin') return requestedOrgId || null;
  return req.user.organization_id;
}

function canManageTracking(req: AuthedRequest) {
  return TRACKING_MANAGER_ROLES.has(req.user.role);
}

function canViewShipment(req: AuthedRequest, shipment: any) {
  if (!shipment) return false;
  if (req.user.role === 'SuperAdmin') return true;
  if (shipment.organization_id !== req.user.organization_id) return false;
  if (WIDE_SHIPMENT_ACCESS_ROLES.has(req.user.role)) return true;
  return [shipment.attorney_id, shipment.paralegal_id].includes(req.user.id);
}

function hasAssignedTrackingNumber(shipment: any) {
  const individualTracking = normalizeText(shipment?.tracking_number);
  if (individualTracking) return true;
  if (!shipment?.tracking_group_id) return false;
  const group = db.prepare('SELECT tracking_number FROM tracking_groups WHERE id = ?').get(shipment.tracking_group_id) as { tracking_number?: string } | undefined;
  return !!normalizeText(group?.tracking_number);
}

function canAssignedUserEditUntrackedShipment(req: AuthedRequest, shipment: any) {
  if (!shipment) return false;
  if (shipment.organization_id !== req.user.organization_id) return false;
  const isAssignedUser = shipment.attorney_id === req.user.id || shipment.paralegal_id === req.user.id;
  return isAssignedUser && !hasAssignedTrackingNumber(shipment);
}

function getShipmentDeleteRestriction(req: AuthedRequest, shipment: any) {
  if (!shipment) return 'Shipment not found';
  if (req.user.role !== 'SuperAdmin' && shipment.organization_id !== req.user.organization_id) {
    return 'Insufficient role';
  }

  if (SHIPMENT_DELETE_ALL_ROLES.has(req.user.role)) return null;

  if (req.user.role === 'Paralegal') {
    if (!canViewShipment(req, shipment)) return 'Insufficient role';
    if (hasAssignedTrackingNumber(shipment)) {
      return 'Paralegal can only delete shipments without assigned tracking number';
    }
    return null;
  }

  return 'Insufficient role';
}

function resolveTrackingGroupId(
  organizationId: string,
  shipDate: string,
  serviceCenterId: string,
  courierServiceId: string,
  serviceTypeId: string,
  mailDeliveryTypeId: string,
  createdBy?: string | null,
) {
  if (!organizationId || !shipDate || !serviceCenterId || !courierServiceId || !serviceTypeId) return null;

  const existing = db.prepare(`
    SELECT id FROM tracking_groups
    WHERE organization_id = ? AND ship_date = ? AND service_center_id = ? AND courier_service_id = ? AND service_type_id = ? AND mail_delivery_type_id = ?
    LIMIT 1
  `).get(organizationId, shipDate, serviceCenterId, courierServiceId, serviceTypeId, mailDeliveryTypeId) as { id?: string } | undefined;

  if (existing?.id) return existing.id;

  const id = uuidv4();
  const now = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO tracking_groups (
        id, organization_id, ship_date, service_center_id, courier_service_id, service_type_id, mail_delivery_type_id,
        tracking_number, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    `).run(id, organizationId, shipDate, serviceCenterId, courierServiceId, serviceTypeId, mailDeliveryTypeId, createdBy ?? null, now, now);
    return id;
  } catch (err: any) {
    const message = String(err?.message || '');
    const legacyUniqueViolation = message.includes('UNIQUE constraint failed: tracking_groups.organization_id, tracking_groups.ship_date, tracking_groups.service_center_id, tracking_groups.courier_service_id, tracking_groups.service_type_id');
    if (legacyUniqueViolation) {
      const legacy = db.prepare(`
        SELECT id FROM tracking_groups
        WHERE organization_id = ? AND ship_date = ? AND service_center_id = ? AND courier_service_id = ? AND service_type_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `).get(organizationId, shipDate, serviceCenterId, courierServiceId, serviceTypeId) as { id?: string } | undefined;
      if (legacy?.id) return legacy.id;
    }
    throw err;
  }
}

router.get('/', (req: AuthedRequest, res) => {
  const q = req.query as any;
  const orgId = getOrgIdForRequest(req, q.organizationId as string | undefined);
  let where: string[] = ['s.is_deleted = 0'];
  const params: any[] = [];
  const canViewAllOrgShipments = WIDE_SHIPMENT_ACCESS_ROLES.has(req.user.role);

  if (orgId) {
    where.push('s.organization_id = ?');
    params.push(orgId);
  }

  if (!canViewAllOrgShipments) {
    where.push('(s.attorney_id = ? OR s.paralegal_id = ?)');
    params.push(req.user.id, req.user.id);
  }

  if (q.search) {
    const s = `%${String(q.search).toLowerCase()}%`;
    where.push(`(
      lower(coalesce(s.beneficiary_name, '')) LIKE ?
      OR lower(coalesce(s.petitioner_name, '')) LIKE ?
      OR lower(coalesce(s.tracking_number, '')) LIKE ?
      OR lower(coalesce(tg.tracking_number, '')) LIKE ?
    )`);
    params.push(s, s, s, s);
  }

  if (q.caseType) { where.push('s.case_type_id = ?'); params.push(q.caseType); }
  if (q.serviceCenter) { where.push('s.service_center_id = ?'); params.push(q.serviceCenter); }
  if (q.courierService) { where.push('s.courier_service_id = ?'); params.push(q.courierService); }
  if (q.serviceType) { where.push('s.service_type_id = ?'); params.push(q.serviceType); }
  if (q.attorney) { where.push('s.attorney_id = ?'); params.push(q.attorney); }
  if (q.paymentStatus) { where.push('s.payment_status = ?'); params.push(q.paymentStatus); }
  if (q.status) { where.push('s.status = ?'); params.push(q.status); }
  if (q.shipDate) { where.push('s.ship_date = ?'); params.push(q.shipDate); }
  if (q.shipDateFrom) { where.push('s.ship_date >= ?'); params.push(q.shipDateFrom); }
  if (q.shipDateTo) { where.push('s.ship_date <= ?'); params.push(q.shipDateTo); }
  const reportUserId = normalizeText(q.reportUserId);
  if (reportUserId) {
    if (!canViewAllOrgShipments && reportUserId !== req.user.id) {
      return res.status(403).json({ error: 'Insufficient role' });
    }
    where.push('(s.created_by = ? OR s.attorney_id = ? OR s.paralegal_id = ?)');
    params.push(reportUserId, reportUserId, reportUserId);
  }
  if (q.dateFrom) { where.push('s.created_at >= ?'); params.push(q.dateFrom); }
  if (q.dateTo) { where.push('s.created_at <= ?'); params.push(q.dateTo + 'T23:59:59Z'); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortBy = SHIPMENT_SORT_FIELDS.has(String(q.sortBy || '')) ? String(q.sortBy) : 'created_at';
  const sortDir = q.sortDir === 'asc' ? 'ASC' : 'DESC';
  const page = Number(q.page || 1);
  const pageSize = Number(q.pageSize || 20);
  const offset = (page - 1) * pageSize;
  const fromSql = 'FROM shipments s LEFT JOIN tracking_groups tg ON s.tracking_group_id = tg.id';

  const totalStmt = db.prepare(`SELECT COUNT(*) as cnt ${fromSql} ${whereSql}`);
  const total = (totalStmt.get(...params) as { cnt: number } | undefined)?.cnt ?? 0;

  const stmt = db.prepare(`
    SELECT
      s.*,
      COALESCE(NULLIF(s.tracking_number, ''), tg.tracking_number, '') as effective_tracking_number,
      s.tracking_number as individual_tracking_number,
      tg.tracking_number as group_tracking_number
    ${fromSql}
    ${whereSql}
    ORDER BY s.${sortBy} ${sortDir}
    LIMIT ? OFFSET ?
  `);
  const rows = stmt.all(...params, pageSize, offset);
  res.json({ data: rows, total });
});

router.get('/frontdesk/groups', (req: AuthedRequest, res) => {
  if (!canManageTracking(req)) return res.status(403).json({ error: 'Insufficient role' });

  const q = req.query as any;
  const orgId = getOrgIdForRequest(req, q.organizationId as string | undefined);
  if (!orgId) return res.status(400).json({ error: 'organizationId is required' });
  const shipDate = normalizeText(q.date) || currentShipDate();

  const rows = db.prepare(`
    SELECT
      s.id,
      s.ship_date,
      s.service_center_id,
      s.courier_service_id,
      s.service_type_id,
      s.mail_delivery_type_id,
      s.tracking_group_id,
      s.created_by as shipment_created_by,
      uc.name as shipment_created_by_name,
      s.beneficiary_name,
      s.petitioner_name,
      s.status,
      (
        SELECT al.performed_by
        FROM audit_logs al
        WHERE al.entity_type = 'TrackingGroup'
          AND al.action_type = 'UPDATE'
          AND al.entity_id = tg.id
        ORDER BY al.timestamp DESC
        LIMIT 1
      ) as tracking_assigned_by,
      (
        SELECT al.performed_by_name
        FROM audit_logs al
        WHERE al.entity_type = 'TrackingGroup'
          AND al.action_type = 'UPDATE'
          AND al.entity_id = tg.id
        ORDER BY al.timestamp DESC
        LIMIT 1
      ) as tracking_assigned_by_name,
      tg.created_by as group_created_by,
      ug.name as group_created_by_name,
      tg.updated_at as group_updated_at,
      s.tracking_number as individual_tracking_number,
      tg.tracking_number as group_tracking_number,
      COALESCE(NULLIF(s.tracking_number, ''), tg.tracking_number, '') as effective_tracking_number
    FROM shipments s
    LEFT JOIN tracking_groups tg ON s.tracking_group_id = tg.id
    LEFT JOIN users ug ON ug.id = tg.created_by
    LEFT JOIN users uc ON uc.id = s.created_by
    WHERE s.is_deleted = 0
      AND s.organization_id = ?
      AND s.ship_date = ?
      AND s.status IN ('Draft', 'Submitted', 'In Transit')
    ORDER BY s.service_center_id, s.mail_delivery_type_id, s.courier_service_id, s.service_type_id, s.created_at
  `).all(orgId, shipDate) as Array<{
    id: string;
    ship_date: string;
    service_center_id: string;
    courier_service_id: string;
    service_type_id: string;
    mail_delivery_type_id: string;
    tracking_group_id: string | null;
    shipment_created_by: string | null;
    shipment_created_by_name: string | null;
    beneficiary_name: string;
    petitioner_name: string;
    status: string;
    tracking_assigned_by: string | null;
    tracking_assigned_by_name: string | null;
    group_created_by: string | null;
    group_created_by_name: string | null;
    group_updated_at: string | null;
    individual_tracking_number: string | null;
    group_tracking_number: string | null;
    effective_tracking_number: string | null;
  }>;

  const groups = new Map<string, any>();
  rows.forEach((row) => {
    const fallbackKey = `${row.ship_date}|${row.service_center_id}|${row.mail_delivery_type_id}|${row.courier_service_id}|${row.service_type_id}`;
    const groupKey = `${row.tracking_group_id || 'nogroup'}|${fallbackKey}`;
    const existing = groups.get(groupKey) || {
      group_id: row.tracking_group_id || null,
      ship_date: row.ship_date,
      service_center_id: row.service_center_id,
      courier_service_id: row.courier_service_id,
      service_type_id: row.service_type_id,
      mail_delivery_type_id: row.mail_delivery_type_id || '',
      group_tracking_number: row.group_tracking_number || '',
      created_by: row.shipment_created_by || row.group_created_by || null,
      created_by_name: row.shipment_created_by_name || row.group_created_by_name || '',
      tracking_assigned_by: row.tracking_assigned_by || row.group_created_by || null,
      tracking_assigned_by_name: row.tracking_assigned_by_name || row.group_created_by_name || '',
      fallback_created_by: row.group_created_by || null,
      fallback_created_by_name: row.group_created_by_name || '',
      updated_at: row.group_updated_at || null,
      total_packets: 0,
      tracked_packets: 0,
      untracked_packets: 0,
      submitted_packets: 0,
      ready_to_submit_packets: 0,
      _creator_ids: new Set<string>(),
      _creator_names: new Set<string>(),
      shipments: [] as any[],
    };

    const hasTracking = !!(row.effective_tracking_number && String(row.effective_tracking_number).trim());
    const isSubmitted = row.status === 'In Transit' || row.status === 'Delivered';
    const canSubmitStatus = row.status === 'Draft' || row.status === 'Submitted';
    existing.total_packets += 1;
    existing.tracked_packets += hasTracking ? 1 : 0;
    existing.untracked_packets += hasTracking ? 0 : 1;
    existing.submitted_packets += isSubmitted ? 1 : 0;
    existing.ready_to_submit_packets += canSubmitStatus && hasTracking ? 1 : 0;
    const shipmentCreatorId = normalizeText(row.shipment_created_by);
    const shipmentCreatorName = normalizeText(row.shipment_created_by_name);
    if (shipmentCreatorId) existing._creator_ids.add(shipmentCreatorId);
    if (shipmentCreatorName) existing._creator_names.add(shipmentCreatorName);
    existing.shipments.push({
      id: row.id,
      beneficiary_name: row.beneficiary_name,
      petitioner_name: row.petitioner_name,
      status: row.status,
      tracking_number: row.effective_tracking_number || '',
      individual_tracking_number: row.individual_tracking_number || '',
      group_tracking_number: row.group_tracking_number || '',
      created_by: row.shipment_created_by || '',
      created_by_name: row.shipment_created_by_name || '',
    });

    groups.set(groupKey, existing);
  });

  const formattedGroups = Array.from(groups.values()).map((group: any) => {
    const creatorIds = Array.from(group._creator_ids as Set<string>);
    const creatorNames = Array.from(group._creator_names as Set<string>);

    if (creatorNames.length === 1) {
      group.created_by_name = creatorNames[0];
      group.created_by = creatorIds[0] || group.created_by || null;
    } else if (creatorNames.length > 1) {
      group.created_by_name = 'Multiple';
      group.created_by = null;
    } else if (!normalizeText(group.created_by_name)) {
      group.created_by_name = normalizeText(group.fallback_created_by_name);
      group.created_by = group.fallback_created_by || group.created_by || null;
    }

    delete group._creator_ids;
    delete group._creator_names;
    delete group.fallback_created_by;
    delete group.fallback_created_by_name;
    return group;
  });

  const memberSummary = db.prepare(`
    SELECT
      s.created_by as user_id,
      COALESCE(u.name, 'Unknown') as user_name,
      SUM(CASE WHEN s.status IN ('In Transit', 'Delivered') THEN 1 ELSE 0 END) as submitted_packets,
      COUNT(*) as total_packets
    FROM shipments s
    LEFT JOIN users u ON u.id = s.created_by
    WHERE s.is_deleted = 0
      AND s.organization_id = ?
      AND s.ship_date = ?
      AND s.status IN ('Draft', 'Submitted', 'In Transit', 'Delivered')
    GROUP BY s.created_by, u.name
    ORDER BY submitted_packets DESC, user_name ASC
  `).all(orgId, shipDate);

  res.json({ date: shipDate, groups: formattedGroups, member_summary: memberSummary });
});

router.post('/frontdesk/bulk-tracking', (req: AuthedRequest, res) => {
  try {
    if (!canManageTracking(req)) return res.status(403).json({ error: 'Insufficient role' });

    const body = req.body || {};
    const orgId = getOrgIdForRequest(req, body.organization_id as string | undefined);
    if (!orgId) return res.status(400).json({ error: 'organization_id is required' });

    const shipDate = normalizeText(body.ship_date) || currentShipDate();
    const serviceCenterId = normalizeText(body.service_center_id);
    const courierServiceId = normalizeText(body.courier_service_id);
    const serviceTypeId = normalizeText(body.service_type_id);
    const mailDeliveryTypeId = normalizeText(body.mail_delivery_type_id);
    const trackingNumber = normalizeText(body.tracking_number);

    if (!serviceCenterId || !courierServiceId || !serviceTypeId || !trackingNumber) {
      return res.status(400).json({ error: 'ship_date, service_center_id, courier_service_id, service_type_id, and tracking_number are required' });
    }

    const trackingGroupId = resolveTrackingGroupId(orgId, shipDate, serviceCenterId, courierServiceId, serviceTypeId, mailDeliveryTypeId, req.user.id);
    if (!trackingGroupId) return res.status(400).json({ error: 'Unable to resolve tracking group' });

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE tracking_groups
      SET tracking_number = ?,
          created_by = CASE
            WHEN tracking_number IS NULL OR trim(tracking_number) = '' OR created_by IS NULL OR trim(created_by) = '' THEN ?
            ELSE created_by
          END,
          updated_at = ?
      WHERE id = ?
    `).run(trackingNumber, req.user.id, now, trackingGroupId);

    const result = db.prepare(`
      UPDATE shipments
      SET tracking_group_id = ?,
          updated_at = ?,
          updated_by = ?
      WHERE organization_id = ?
        AND is_deleted = 0
        AND ship_date = ?
        AND service_center_id = ?
        AND courier_service_id = ?
        AND service_type_id = ?
        AND mail_delivery_type_id = ?
    `).run(trackingGroupId, now, req.user.id, orgId, shipDate, serviceCenterId, courierServiceId, serviceTypeId, mailDeliveryTypeId) as any;

    db.prepare(`
      INSERT INTO audit_logs (
        id, entity_type, entity_id, action_type, old_value, new_value,
        performed_by, performed_by_name, organization_id, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      'TrackingGroup',
      trackingGroupId,
      'UPDATE',
      null,
      JSON.stringify({ ship_date: shipDate, service_center_id: serviceCenterId, courier_service_id: courierServiceId, service_type_id: serviceTypeId, mail_delivery_type_id: mailDeliveryTypeId, tracking_number: trackingNumber }),
      req.user.id,
      req.user.name,
      orgId,
      now,
    );

    res.json({
      success: true,
      tracking_group_id: trackingGroupId,
      updated_shipments: Number(result?.changes || 0),
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed applying bulk tracking', details: err?.message || 'Unknown error' });
  }
});

router.post('/frontdesk/submit-group', (req: AuthedRequest, res) => {
  try {
    if (!canManageTracking(req)) return res.status(403).json({ error: 'Insufficient role' });

    const body = req.body || {};
    const orgId = getOrgIdForRequest(req, body.organization_id as string | undefined);
    if (!orgId) return res.status(400).json({ error: 'organization_id is required' });

    const shipDate = normalizeText(body.ship_date) || currentShipDate();
    const serviceCenterId = normalizeText(body.service_center_id);
    const courierServiceId = normalizeText(body.courier_service_id);
    const serviceTypeId = normalizeText(body.service_type_id);
    const mailDeliveryTypeId = normalizeText(body.mail_delivery_type_id);

    if (!serviceCenterId || !courierServiceId || !serviceTypeId) {
      return res.status(400).json({ error: 'ship_date, service_center_id, courier_service_id, and service_type_id are required' });
    }

    const rows = db.prepare(`
      SELECT
        s.id,
        s.status,
        s.organization_id,
        s.tracking_group_id,
        COALESCE(NULLIF(s.tracking_number, ''), tg.tracking_number, '') as effective_tracking_number
      FROM shipments s
      LEFT JOIN tracking_groups tg ON s.tracking_group_id = tg.id
      WHERE s.is_deleted = 0
        AND s.organization_id = ?
        AND s.ship_date = ?
        AND s.service_center_id = ?
        AND s.courier_service_id = ?
        AND s.service_type_id = ?
        AND s.mail_delivery_type_id = ?
    `).all(orgId, shipDate, serviceCenterId, courierServiceId, serviceTypeId, mailDeliveryTypeId) as Array<{
      id: string;
      status: string;
      organization_id: string;
      tracking_group_id: string | null;
      effective_tracking_number: string;
    }>;

    if (!rows.length) return res.status(404).json({ error: 'No packets found for the selected group' });

    const pendingRows = rows.filter(r => r.status === 'Draft' || r.status === 'Submitted');
    const missingTracking = pendingRows.filter(r => !normalizeText(r.effective_tracking_number));
    if (missingTracking.length) {
      return res.status(400).json({ error: `Assign tracking number to all pending packets before bulk submit (${missingTracking.length} missing)` });
    }

    const eligibleIds = pendingRows.map(r => r.id);
    if (!eligibleIds.length) {
      return res.json({ success: true, updated_shipments: 0, already_submitted: true });
    }

    const now = new Date().toISOString();
    const placeholders = eligibleIds.map(() => '?').join(',');
    db.prepare(`
      UPDATE shipments
      SET status = 'In Transit',
          updated_at = ?,
          updated_by = ?
      WHERE id IN (${placeholders})
    `).run(now, req.user.id, ...eligibleIds);

    const firstRow = rows[0];
    db.prepare(`
      INSERT INTO audit_logs (
        id, entity_type, entity_id, action_type, old_value, new_value,
        performed_by, performed_by_name, organization_id, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      'TrackingGroup',
      firstRow.tracking_group_id || `${orgId}|${shipDate}|${serviceCenterId}|${courierServiceId}|${serviceTypeId}|${mailDeliveryTypeId}`,
      'UPDATE',
      null,
      JSON.stringify({
        submit_type: 'bulk_group',
        ship_date: shipDate,
        service_center_id: serviceCenterId,
        courier_service_id: courierServiceId,
        service_type_id: serviceTypeId,
        mail_delivery_type_id: mailDeliveryTypeId,
        submitted_count: eligibleIds.length,
      }),
      req.user.id,
      req.user.name,
      orgId,
      now,
    );

    return res.json({ success: true, updated_shipments: eligibleIds.length });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed submitting group packets', details: err?.message || 'Unknown error' });
  }
});

router.put('/:id/submit', (req: AuthedRequest, res) => {
  try {
    if (!canManageTracking(req)) return res.status(403).json({ error: 'Insufficient role' });

    const { id } = req.params;
    const shipment = db.prepare(`
      SELECT
        s.*,
        COALESCE(NULLIF(s.tracking_number, ''), tg.tracking_number, '') as effective_tracking_number
      FROM shipments s
      LEFT JOIN tracking_groups tg ON s.tracking_group_id = tg.id
      WHERE s.id = ? AND s.is_deleted = 0
    `).get(id) as any;
    if (!shipment) return res.status(404).json({ error: 'Not found' });

    if (req.user.role !== 'SuperAdmin' && shipment.organization_id !== req.user.organization_id) {
      return res.status(403).json({ error: 'Insufficient role' });
    }

    if (!normalizeText(shipment.effective_tracking_number)) {
      return res.status(400).json({ error: 'Assign tracking number before submit' });
    }

    if (shipment.status === 'In Transit' || shipment.status === 'Delivered') {
      return res.json({ success: true, id, status: shipment.status, already_submitted: true });
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE shipments
      SET status = 'In Transit',
          updated_at = ?,
          updated_by = ?
      WHERE id = ?
    `).run(now, req.user.id, id);

    db.prepare(`
      INSERT INTO audit_logs (
        id, entity_type, entity_id, action_type, old_value, new_value,
        performed_by, performed_by_name, organization_id, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      'Shipment',
      id,
      'UPDATE',
      JSON.stringify({ status: shipment.status }),
      JSON.stringify({ status: 'In Transit', submit_type: 'individual' }),
      req.user.id,
      req.user.name,
      shipment.organization_id,
      now,
    );

    return res.json({ success: true, id, status: 'In Transit' });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed submitting packet', details: err?.message || 'Unknown error' });
  }
});

router.put('/:id/tracking', (req: AuthedRequest, res) => {
  try {
    if (!canManageTracking(req)) return res.status(403).json({ error: 'Insufficient role' });

    const { id } = req.params;
    const shipment = db.prepare('SELECT * FROM shipments WHERE id = ? AND is_deleted = 0').get(id) as any;
    if (!shipment) return res.status(404).json({ error: 'Not found' });

    if (req.user.role !== 'SuperAdmin' && shipment.organization_id !== req.user.organization_id) {
      return res.status(403).json({ error: 'Insufficient role' });
    }

    const trackingNumber = normalizeNullableText(req.body?.tracking_number);
    const nextStatus = shipment.status;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE shipments
      SET tracking_number = ?, status = ?, updated_at = ?, updated_by = ?
      WHERE id = ?
    `).run(trackingNumber, nextStatus, now, req.user.id, id);

    db.prepare(`
      INSERT INTO audit_logs (
        id, entity_type, entity_id, action_type, old_value, new_value,
        performed_by, performed_by_name, organization_id, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      'Shipment',
      id,
      'UPDATE',
      JSON.stringify({ tracking_number: shipment.tracking_number, status: shipment.status }),
      JSON.stringify({ tracking_number: trackingNumber, status: nextStatus }),
      req.user.id,
      req.user.name,
      shipment.organization_id,
      now,
    );

    const updated = db.prepare(`
      SELECT
        s.*,
        COALESCE(NULLIF(s.tracking_number, ''), tg.tracking_number, '') as effective_tracking_number,
        s.tracking_number as individual_tracking_number,
        tg.tracking_number as group_tracking_number
      FROM shipments s
      LEFT JOIN tracking_groups tg ON s.tracking_group_id = tg.id
      WHERE s.id = ?
    `).get(id);

    res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed saving individual tracking', details: err?.message || 'Unknown error' });
  }
});

router.get('/:id', (req: AuthedRequest, res) => {
  const { id } = req.params;
  const s = db.prepare(`
    SELECT
      s.*,
      COALESCE(NULLIF(s.tracking_number, ''), tg.tracking_number, '') as effective_tracking_number,
      s.tracking_number as individual_tracking_number,
      tg.tracking_number as group_tracking_number
    FROM shipments s
    LEFT JOIN tracking_groups tg ON s.tracking_group_id = tg.id
    WHERE s.id = ? AND s.is_deleted = 0
  `).get(id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (!canViewShipment(req, s)) return res.status(403).json({ error: 'Insufficient role' });
  res.json(s);
});

router.post('/', (req: AuthedRequest, res) => {
  if (!SHIPMENT_CREATOR_ROLES.has(req.user.role)) return res.status(403).json({ error: 'Insufficient role' });

  const data = req.body || {};
  const orgId = getOrgIdForRequest(req, data.organization_id as string | undefined);
  if (!orgId) return res.status(400).json({ error: 'organization_id is required' });
  if (req.user.role !== 'SuperAdmin' && orgId !== req.user.organization_id) return res.status(403).json({ error: 'Insufficient role' });

  const required = [
    'beneficiary_name', 'petitioner_name', 'case_type_id', 'service_center_id',
    'courier_service_id', 'service_type_id', 'mail_delivery_type_id',
    'notes', 'invoice_number', 'payment_status',
  ];
  if (req.user.role !== 'Attorney') required.push('attorney_id');
  const missing = required.filter((field) => !normalizeText((data as any)[field]));
  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
  }

  const now = new Date().toISOString();
  const shipDate = normalizeText(data.ship_date) || currentShipDate();
  const status = req.user.role === 'Paralegal' ? 'Submitted' : (normalizeText(data.status) || 'Draft');
  const trackingNumber = req.user.role === 'Paralegal' ? '' : normalizeText(data.tracking_number);
  const attorneyId = normalizeText(data.attorney_id) || (req.user.role === 'Attorney' ? req.user.id : '');
  const paralegalId = normalizeText(data.paralegal_id) || req.user.id;
  if (!attorneyId) return res.status(400).json({ error: 'Missing fields: attorney_id' });
  const trackingGroupId = resolveTrackingGroupId(
    orgId,
    shipDate,
    normalizeText(data.service_center_id),
    normalizeText(data.courier_service_id),
    normalizeText(data.service_type_id),
    normalizeText(data.mail_delivery_type_id),
    null,
  );

  const id = uuidv4();
  db.prepare(`
    INSERT INTO shipments (
      id, organization_id, beneficiary_name, petitioner_name, tracking_number,
      case_type_id, service_center_id, service_type_id, mail_delivery_type_id, courier_service_id,
      ship_date, tracking_group_id,
      attorney_id, paralegal_id, tva_payment, notes, invoice_number,
      payment_status, status, created_at, created_by, updated_at, updated_by, is_deleted
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    id,
    orgId,
    normalizeText(data.beneficiary_name),
    normalizeText(data.petitioner_name),
    trackingNumber,
    normalizeText(data.case_type_id),
    normalizeText(data.service_center_id),
    normalizeText(data.service_type_id),
    normalizeText(data.mail_delivery_type_id),
    normalizeText(data.courier_service_id),
    shipDate,
    trackingGroupId,
    attorneyId,
    paralegalId,
    asDbBool(data.tva_payment),
    normalizeText(data.notes),
    normalizeText(data.invoice_number),
    normalizeText(data.payment_status),
    status,
    now,
    data.created_by ?? req.user.id,
    now,
    req.user.id,
  );

  db.prepare(`
    INSERT INTO audit_logs (
      id, entity_type, entity_id, action_type, old_value, new_value,
      performed_by, performed_by_name, organization_id, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    'Shipment',
    id,
    'CREATE',
    null,
    JSON.stringify({ ...data, organization_id: orgId, tracking_group_id: trackingGroupId, ship_date: shipDate, status, attorney_id: attorneyId, paralegal_id: paralegalId }),
    req.user.id,
    req.user.name,
    orgId,
    now,
  );

  res.status(201).json({ id, ...data, organization_id: orgId, tracking_group_id: trackingGroupId, ship_date: shipDate, status, attorney_id: attorneyId, paralegal_id: paralegalId });
});

router.put('/:id', (req: AuthedRequest, res) => {
  const { id } = req.params;
  const updates = req.body || {};
  const shipment = db.prepare('SELECT * FROM shipments WHERE id = ? AND is_deleted = 0').get(id) as any;
  if (!shipment) return res.status(404).json({ error: 'Not found' });

  const canAssignedUserEditUntracked = canAssignedUserEditUntrackedShipment(req, shipment);
  if (!SHIPMENT_EDITOR_ROLES.has(req.user.role) && !canAssignedUserEditUntracked) return res.status(403).json({ error: 'Insufficient role' });
  if (req.user.role !== 'SuperAdmin' && shipment.organization_id !== req.user.organization_id) {
    return res.status(403).json({ error: 'Insufficient role' });
  }

  const now = new Date().toISOString();

  if (req.user.role === 'Finance') {
    db.prepare(`
      UPDATE shipments
      SET invoice_number = ?, payment_status = ?, updated_at = ?, updated_by = ?
      WHERE id = ?
    `).run(
      normalizeText(updates.invoice_number ?? shipment.invoice_number),
      normalizeText(updates.payment_status ?? shipment.payment_status),
      now,
      req.user.id,
      id,
    );

    db.prepare(`
      INSERT INTO audit_logs (
        id, entity_type, entity_id, action_type, old_value, new_value,
        performed_by, performed_by_name, organization_id, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      'Shipment',
      id,
      'UPDATE',
      JSON.stringify({ invoice_number: shipment.invoice_number, payment_status: shipment.payment_status }),
      JSON.stringify({ invoice_number: updates.invoice_number, payment_status: updates.payment_status }),
      req.user.id,
      req.user.name,
      shipment.organization_id,
      now,
    );
    return res.json({ id, ...updates });
  }

  const next = {
    beneficiary_name: normalizeText(updates.beneficiary_name ?? shipment.beneficiary_name),
    petitioner_name: normalizeText(updates.petitioner_name ?? shipment.petitioner_name),
    tracking_number: normalizeText(updates.tracking_number ?? shipment.tracking_number),
    case_type_id: normalizeText(updates.case_type_id ?? shipment.case_type_id),
    service_center_id: normalizeText(updates.service_center_id ?? shipment.service_center_id),
    service_type_id: normalizeText(updates.service_type_id ?? shipment.service_type_id),
    mail_delivery_type_id: normalizeText(updates.mail_delivery_type_id ?? shipment.mail_delivery_type_id),
    courier_service_id: normalizeText(updates.courier_service_id ?? shipment.courier_service_id),
    ship_date: normalizeText(updates.ship_date ?? shipment.ship_date) || currentShipDate(),
    attorney_id: normalizeText(updates.attorney_id ?? shipment.attorney_id),
    paralegal_id: normalizeText(updates.paralegal_id ?? shipment.paralegal_id),
    tva_payment: updates.tva_payment === undefined ? asDbBool(shipment.tva_payment) : asDbBool(updates.tva_payment),
    notes: normalizeText(updates.notes ?? shipment.notes),
    invoice_number: normalizeText(updates.invoice_number ?? shipment.invoice_number),
    payment_status: normalizeText(updates.payment_status ?? shipment.payment_status),
    status: normalizeText(updates.status ?? shipment.status),
  };

  const trackingGroupId = resolveTrackingGroupId(
    shipment.organization_id,
    next.ship_date,
    next.service_center_id,
    next.courier_service_id,
    next.service_type_id,
    next.mail_delivery_type_id,
    null,
  ) || shipment.tracking_group_id;

  db.prepare(`
    UPDATE shipments SET
      beneficiary_name = ?, petitioner_name = ?, tracking_number = ?,
      case_type_id = ?, service_center_id = ?, service_type_id = ?, mail_delivery_type_id = ?, courier_service_id = ?,
      ship_date = ?, tracking_group_id = ?,
      attorney_id = ?, paralegal_id = ?, tva_payment = ?, notes = ?, invoice_number = ?, payment_status = ?, status = ?,
      updated_at = ?, updated_by = ?
    WHERE id = ?
  `).run(
    next.beneficiary_name,
    next.petitioner_name,
    next.tracking_number,
    next.case_type_id,
    next.service_center_id,
    next.service_type_id,
    next.mail_delivery_type_id,
    next.courier_service_id,
    next.ship_date,
    trackingGroupId,
    next.attorney_id,
    next.paralegal_id,
    next.tva_payment,
    next.notes,
    next.invoice_number,
    next.payment_status,
    next.status,
    now,
    req.user.id,
    id,
  );

  db.prepare(`
    INSERT INTO audit_logs (
      id, entity_type, entity_id, action_type, old_value, new_value,
      performed_by, performed_by_name, organization_id, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    'Shipment',
    id,
    'UPDATE',
    JSON.stringify(shipment),
    JSON.stringify({ ...shipment, ...next, tracking_group_id: trackingGroupId }),
    req.user.id,
    req.user.name,
    shipment.organization_id,
    now,
  );

  res.json({ id, ...next, tracking_group_id: trackingGroupId });
});

router.post('/bulk-delete', (req: AuthedRequest, res) => {
  const body = req.body || {};
  const rawIds = Array.isArray(body.shipment_ids) ? body.shipment_ids : [];
  const shipmentIds: string[] = Array.from(new Set(
    rawIds
      .map((id: unknown) => normalizeText(id))
      .filter((id: string): id is string => !!id)
  ));

  if (!shipmentIds.length) {
    return res.status(400).json({ error: 'shipment_ids is required' });
  }

  const placeholders = shipmentIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM shipments WHERE is_deleted = 0 AND id IN (${placeholders})`).all(...shipmentIds) as any[];
  const byId = new Map<string, any>();
  rows.forEach((row) => byId.set(row.id, row));

  const deletable: any[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  shipmentIds.forEach((id) => {
    const shipment = byId.get(id);
    if (!shipment) {
      skipped.push({ id, reason: 'Shipment not found or already deleted' });
      return;
    }
    const restriction = getShipmentDeleteRestriction(req, shipment);
    if (restriction) {
      skipped.push({ id, reason: restriction });
      return;
    }
    deletable.push(shipment);
  });

  if (!deletable.length) {
    const hasParalegalTrackingRestriction = skipped.some(x => x.reason.includes('assigned tracking number'));
    return res.status(hasParalegalTrackingRestriction ? 400 : 403).json({
      error: skipped[0]?.reason || 'Insufficient role',
      deleted_count: 0,
      skipped_count: skipped.length,
      skipped,
    });
  }

  const now = new Date().toISOString();
  const softDeleteWithAudit = db.transaction((shipments: any[]) => {
    const deleteStmt = db.prepare('DELETE FROM shipments WHERE id = ?');
    const auditStmt = db.prepare(`
      INSERT INTO audit_logs (
        id, entity_type, entity_id, action_type, old_value, new_value,
        performed_by, performed_by_name, organization_id, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    shipments.forEach((shipment) => {
      deleteStmt.run(shipment.id);
      auditStmt.run(
        uuidv4(),
        'Shipment',
        shipment.id,
        'DELETE',
        JSON.stringify(shipment),
        null,
        req.user.id,
        req.user.name,
        shipment.organization_id,
        now,
      );
    });
  });

  softDeleteWithAudit(deletable);

  res.json({
    success: true,
    deleted_count: deletable.length,
    skipped_count: skipped.length,
    skipped,
  });
});

router.delete('/:id', (req: AuthedRequest, res) => {
  const { id } = req.params;
  const shipment = db.prepare('SELECT * FROM shipments WHERE id = ? AND is_deleted = 0').get(id) as any;
  if (!shipment) return res.status(404).json({ error: 'Not found' });

  const deleteRestriction = getShipmentDeleteRestriction(req, shipment);
  if (deleteRestriction) {
    const isParalegalTrackingRestriction = deleteRestriction.includes('assigned tracking number');
    return res.status(isParalegalTrackingRestriction ? 400 : 403).json({ error: deleteRestriction });
  }

  const now = new Date().toISOString();
  db.prepare('DELETE FROM shipments WHERE id = ?').run(id);
  db.prepare(`
    INSERT INTO audit_logs (
      id, entity_type, entity_id, action_type, old_value, new_value,
      performed_by, performed_by_name, organization_id, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    'Shipment',
    id,
    'DELETE',
    JSON.stringify(shipment),
    null,
    req.user.id,
    req.user.name,
    shipment.organization_id,
    now,
  );
  res.json({ success: true });
});

export default router;
