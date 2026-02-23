import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';

const DATA_DIR = process.env.DATA_DIR || './data';
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = join(DATA_DIR, 'shipment.db');

const db = new Database(DB_PATH);

// Enable foreign keys
db.pragma('foreign_keys = ON');

function initSchema() {
  // Organizations
  db.prepare(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone_number TEXT,
    location TEXT,
    logo_data_url TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();

  // Users
  db.prepare(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    phone_number TEXT,
    address TEXT,
    profile_photo_data_url TEXT,
    organization_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(organization_id) REFERENCES organizations(id)
  )`).run();

  // Shipments
  db.prepare(`CREATE TABLE IF NOT EXISTS shipments (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    beneficiary_name TEXT,
    petitioner_name TEXT,
    tracking_number TEXT,
    case_type_id TEXT,
    service_center_id TEXT,
    service_type_id TEXT,
    mail_delivery_type_id TEXT,
    courier_service_id TEXT,
    ship_date TEXT,
    tracking_group_id TEXT,
    attorney_id TEXT,
    paralegal_id TEXT,
    tva_payment INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    invoice_number TEXT,
    payment_status TEXT,
    status TEXT,
    created_at TEXT NOT NULL,
    created_by TEXT,
    updated_at TEXT NOT NULL,
    updated_by TEXT,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(organization_id) REFERENCES organizations(id)
  )`).run();

  // Dropdowns: service_centers, case_types, mail_delivery_types, courier_services, service_types
  ['service_centers', 'case_types', 'mail_delivery_types', 'courier_services', 'service_types'].forEach((t) => {
    db.prepare(`CREATE TABLE IF NOT EXISTS ${t} (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY(organization_id) REFERENCES organizations(id)
    )`).run();
  });

  // Audit logs
  db.prepare(`CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    performed_by TEXT,
    performed_by_name TEXT,
    organization_id TEXT,
    timestamp TEXT NOT NULL
  )`).run();

  // Bulk label/tracking groups. One group represents one daily outgoing label bucket:
  // ship_date + service_center + courier + service_type + mail_delivery_type
  db.prepare(`CREATE TABLE IF NOT EXISTS tracking_groups (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    ship_date TEXT NOT NULL,
    service_center_id TEXT NOT NULL,
    courier_service_id TEXT NOT NULL,
    service_type_id TEXT NOT NULL,
    mail_delivery_type_id TEXT NOT NULL DEFAULT '',
    tracking_number TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(organization_id) REFERENCES organizations(id)
  )`).run();
  // Tracking group indexes are finalized in ensureTrackingGroupColumns() to keep
  // compatibility with older DBs where mail_delivery_type_id may not exist yet.

  // Time station event logs (clock in / clock out)
  db.prepare(`CREATE TABLE IF NOT EXISTS time_entries (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    occurred_at_utc TEXT NOT NULL,
    local_date TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    ip_address TEXT,
    device_info TEXT,
    created_at TEXT NOT NULL,
    created_by TEXT,
    FOREIGN KEY(organization_id) REFERENCES organizations(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`).run();

  // Weekly approval unit for payroll workflow.
  db.prepare(`CREATE TABLE IF NOT EXISTS timesheets (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    week_start TEXT NOT NULL,
    week_end TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    status TEXT NOT NULL DEFAULT 'Draft',
    submitted_at TEXT,
    submitted_by TEXT,
    admin_reviewed_at TEXT,
    admin_reviewed_by TEXT,
    admin_comment TEXT,
    forwarded_to_finance INTEGER NOT NULL DEFAULT 0,
    finance_forwarded_at TEXT,
    finance_forwarded_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(organization_id, user_id, week_start),
    FOREIGN KEY(organization_id) REFERENCES organizations(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`).run();
}

function tableHasColumn(table: string, column: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some(c => c.name === column);
}

function ensureShipmentColumns() {
  const requiredColumns: Array<{ name: string; type: string }> = [
    { name: 'service_type_id', type: 'TEXT' },
    { name: 'mail_delivery_type_id', type: 'TEXT' },
    { name: 'courier_service_id', type: 'TEXT' },
    { name: 'ship_date', type: 'TEXT' },
    { name: 'tracking_group_id', type: 'TEXT' },
    { name: 'paralegal_id', type: 'TEXT' },
    { name: 'tva_payment', type: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'notes', type: 'TEXT' },
    { name: 'invoice_number', type: 'TEXT' },
    { name: 'created_by', type: 'TEXT' },
  ];

  requiredColumns.forEach(({ name, type }) => {
    if (!tableHasColumn('shipments', name)) {
      db.prepare(`ALTER TABLE shipments ADD COLUMN ${name} ${type}`).run();
    }
  });
}

function ensureUserColumns() {
  const requiredColumns: Array<{ name: string; type: string }> = [
    { name: 'phone_number', type: 'TEXT' },
    { name: 'address', type: 'TEXT' },
    { name: 'profile_photo_data_url', type: 'TEXT' },
  ];

  requiredColumns.forEach(({ name, type }) => {
    if (!tableHasColumn('users', name)) {
      db.prepare(`ALTER TABLE users ADD COLUMN ${name} ${type}`).run();
    }
  });
}

function ensureTrackingGroupColumns() {
  if (!tableHasColumn('tracking_groups', 'mail_delivery_type_id')) {
    db.prepare(`ALTER TABLE tracking_groups ADD COLUMN mail_delivery_type_id TEXT`).run();
  }

  if (tableHasColumn('shipments', 'mail_delivery_type_id')) {
    db.prepare(`
      UPDATE tracking_groups
      SET mail_delivery_type_id = (
        SELECT s.mail_delivery_type_id
        FROM shipments s
        WHERE s.tracking_group_id = tracking_groups.id
          AND s.mail_delivery_type_id IS NOT NULL
          AND trim(s.mail_delivery_type_id) != ''
        ORDER BY s.updated_at DESC, s.created_at DESC
        LIMIT 1
      )
      WHERE mail_delivery_type_id IS NULL OR trim(mail_delivery_type_id) = ''
    `).run();
  }

  db.prepare(`UPDATE tracking_groups SET mail_delivery_type_id = '' WHERE mail_delivery_type_id IS NULL`).run();
  db.prepare('DROP INDEX IF EXISTS idx_tracking_groups_unique').run();
  db.prepare('DROP INDEX IF EXISTS idx_tracking_groups_unique_v2').run();
  db.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tracking_groups_unique_v2
    ON tracking_groups (organization_id, ship_date, service_center_id, courier_service_id, service_type_id, mail_delivery_type_id)
  `).run();
}

function ensureOrganizationColumns() {
  const requiredColumns: Array<{ name: string; type: string }> = [
    { name: 'phone_number', type: 'TEXT' },
    { name: 'location', type: 'TEXT' },
    { name: 'logo_data_url', type: 'TEXT' },
  ];

  requiredColumns.forEach(({ name, type }) => {
    if (!tableHasColumn('organizations', name)) {
      db.prepare(`ALTER TABLE organizations ADD COLUMN ${name} ${type}`).run();
    }
  });
}

function ensureTimeStationColumns() {
  if (!tableHasColumn('time_entries', 'timezone')) {
    db.prepare(`ALTER TABLE time_entries ADD COLUMN timezone TEXT`).run();
    db.prepare(`UPDATE time_entries SET timezone = 'UTC' WHERE timezone IS NULL OR trim(timezone) = ''`).run();
  }
  if (!tableHasColumn('time_entries', 'ip_address')) {
    db.prepare(`ALTER TABLE time_entries ADD COLUMN ip_address TEXT`).run();
  }
  if (!tableHasColumn('time_entries', 'device_info')) {
    db.prepare(`ALTER TABLE time_entries ADD COLUMN device_info TEXT`).run();
  }

  if (!tableHasColumn('timesheets', 'timezone')) {
    db.prepare(`ALTER TABLE timesheets ADD COLUMN timezone TEXT`).run();
    db.prepare(`UPDATE timesheets SET timezone = 'UTC' WHERE timezone IS NULL OR trim(timezone) = ''`).run();
  }
  if (!tableHasColumn('timesheets', 'forwarded_to_finance')) {
    db.prepare(`ALTER TABLE timesheets ADD COLUMN forwarded_to_finance INTEGER NOT NULL DEFAULT 0`).run();
  }
  if (!tableHasColumn('timesheets', 'finance_forwarded_at')) {
    db.prepare(`ALTER TABLE timesheets ADD COLUMN finance_forwarded_at TEXT`).run();
  }
  if (!tableHasColumn('timesheets', 'finance_forwarded_by')) {
    db.prepare(`ALTER TABLE timesheets ADD COLUMN finance_forwarded_by TEXT`).run();
  }
  if (!tableHasColumn('timesheets', 'admin_comment')) {
    db.prepare(`ALTER TABLE timesheets ADD COLUMN admin_comment TEXT`).run();
  }

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_time_entries_user_date
    ON time_entries (user_id, local_date, occurred_at_utc)
  `).run();
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_time_entries_org_date
    ON time_entries (organization_id, local_date, occurred_at_utc)
  `).run();
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_timesheets_org_status_week
    ON timesheets (organization_id, status, week_start)
  `).run();
  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_timesheets_user_week
    ON timesheets (user_id, week_start)
  `).run();
}

function seedDropdownDefaults() {
  const organizations = db.prepare('SELECT id FROM organizations').all() as Array<{ id: string }>;
  if (!organizations.length) return;

  const defaultsByTable: Record<string, string[]> = {
    courier_services: ['FedEx', 'UPS', 'USPS'],
    service_types: ['Overnight', '2-Day', 'Ground'],
  };
  const now = new Date().toISOString();

  Object.entries(defaultsByTable).forEach(([tableName, defaults]) => {
    const existing = db.prepare(`SELECT id FROM ${tableName} WHERE organization_id = ? AND lower(name) = lower(?) AND is_active = 1 LIMIT 1`);
    const insert = db.prepare(`INSERT INTO ${tableName} (id, organization_id, name, is_active, created_at) VALUES (?, ?, ?, 1, ?)`);

    organizations.forEach(({ id: organizationId }) => {
      defaults.forEach((name) => {
        if (!existing.get(organizationId, name)) {
          insert.run(uuidv4(), organizationId, name, now);
        }
      });
    });
  });
}

function backfillShipDates() {
  if (!tableHasColumn('shipments', 'ship_date')) return;
  db.prepare(`
    UPDATE shipments
    SET ship_date = substr(created_at, 1, 10)
    WHERE ship_date IS NULL OR trim(ship_date) = ''
  `).run();
}

function backfillCourierServiceFromLegacyFedExColumn() {
  if (!tableHasColumn('shipments', 'fedex_service_type') || !tableHasColumn('shipments', 'courier_service_id')) return;

  const fedexByOrg = new Map<string, string>();
  const fedexStmt = db.prepare("SELECT id FROM courier_services WHERE organization_id = ? AND lower(name) = 'fedex' AND is_active = 1 LIMIT 1");
  const shipments = db.prepare(
    "SELECT id, organization_id FROM shipments WHERE is_deleted = 0 AND (courier_service_id IS NULL OR courier_service_id = '') AND fedex_service_type IS NOT NULL AND trim(fedex_service_type) != ''"
  ).all() as Array<{ id: string; organization_id: string }>;
  const update = db.prepare('UPDATE shipments SET courier_service_id = ?, updated_at = ? WHERE id = ?');
  const now = new Date().toISOString();

  shipments.forEach((shipment) => {
    let fedexId = fedexByOrg.get(shipment.organization_id);
    if (!fedexId) {
      const row = fedexStmt.get(shipment.organization_id) as { id?: string } | undefined;
      fedexId = row?.id;
      if (fedexId) fedexByOrg.set(shipment.organization_id, fedexId);
    }

    if (fedexId) {
      update.run(fedexId, now, shipment.id);
    }
  });
}

function backfillServiceTypeFromLegacyFedExColumn() {
  if (!tableHasColumn('shipments', 'fedex_service_type') || !tableHasColumn('shipments', 'service_type_id')) return;

  const serviceTypeIdByOrgAndName = new Map<string, string>();
  const serviceTypeStmt = db.prepare('SELECT id FROM service_types WHERE organization_id = ? AND lower(name) = lower(?) AND is_active = 1 LIMIT 1');
  const shipments = db.prepare(
    "SELECT id, organization_id, fedex_service_type FROM shipments WHERE is_deleted = 0 AND (service_type_id IS NULL OR service_type_id = '') AND fedex_service_type IS NOT NULL AND trim(fedex_service_type) != ''"
  ).all() as Array<{ id: string; organization_id: string; fedex_service_type: string }>;
  const update = db.prepare('UPDATE shipments SET service_type_id = ?, updated_at = ? WHERE id = ?');
  const now = new Date().toISOString();

  shipments.forEach((shipment) => {
    const cacheKey = `${shipment.organization_id}|${shipment.fedex_service_type.toLowerCase()}`;
    let serviceTypeId = serviceTypeIdByOrgAndName.get(cacheKey);
    if (!serviceTypeId) {
      const row = serviceTypeStmt.get(shipment.organization_id, shipment.fedex_service_type) as { id?: string } | undefined;
      serviceTypeId = row?.id;
      if (serviceTypeId) serviceTypeIdByOrgAndName.set(cacheKey, serviceTypeId);
    }
    if (serviceTypeId) {
      update.run(serviceTypeId, now, shipment.id);
    }
  });
}

function backfillMissingServiceTypeFromDefault() {
  if (!tableHasColumn('shipments', 'service_type_id')) return;
  const organizations = db.prepare('SELECT id FROM organizations').all() as Array<{ id: string }>;
  if (!organizations.length) return;

  const firstServiceType = db.prepare(`
    SELECT id FROM service_types
    WHERE organization_id = ? AND is_active = 1
    ORDER BY created_at
    LIMIT 1
  `);
  const update = db.prepare(`
    UPDATE shipments
    SET service_type_id = ?, updated_at = ?
    WHERE organization_id = ? AND (service_type_id IS NULL OR trim(service_type_id) = '')
  `);
  const now = new Date().toISOString();

  organizations.forEach((org) => {
    const row = firstServiceType.get(org.id) as { id?: string } | undefined;
    if (!row?.id) return;
    update.run(row.id, now, org.id);
  });
}

function resolveTrackingGroupIdForBackfill(
  organizationId: string,
  shipDate: string,
  serviceCenterId: string,
  courierServiceId: string,
  serviceTypeId: string,
  mailDeliveryTypeId: string
) {
  const existing = db.prepare(`
    SELECT id FROM tracking_groups
    WHERE organization_id = ? AND ship_date = ? AND service_center_id = ? AND courier_service_id = ? AND service_type_id = ? AND mail_delivery_type_id = ?
    LIMIT 1
  `).get(organizationId, shipDate, serviceCenterId, courierServiceId, serviceTypeId, mailDeliveryTypeId) as { id?: string } | undefined;

  if (existing?.id) return existing.id;

  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO tracking_groups (
      id, organization_id, ship_date, service_center_id, courier_service_id, service_type_id, mail_delivery_type_id,
      tracking_number, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
  `).run(id, organizationId, shipDate, serviceCenterId, courierServiceId, serviceTypeId, mailDeliveryTypeId, now, now);
  return id;
}

function backfillTrackingGroupsFromShipmentData() {
  if (!tableHasColumn('shipments', 'tracking_group_id')) return;

  const shipments = db.prepare(`
    SELECT id, organization_id, ship_date, created_at, service_center_id, courier_service_id, service_type_id, mail_delivery_type_id
    FROM shipments
    WHERE is_deleted = 0
      AND (tracking_group_id IS NULL OR trim(tracking_group_id) = '')
      AND service_center_id IS NOT NULL AND trim(service_center_id) != ''
      AND courier_service_id IS NOT NULL AND trim(courier_service_id) != ''
      AND service_type_id IS NOT NULL AND trim(service_type_id) != ''
  `).all() as Array<{
    id: string;
    organization_id: string;
    ship_date?: string;
    created_at?: string;
    service_center_id: string;
    courier_service_id: string;
    service_type_id: string;
    mail_delivery_type_id?: string;
  }>;

  const update = db.prepare('UPDATE shipments SET tracking_group_id = ?, ship_date = ?, updated_at = ? WHERE id = ?');
  const now = new Date().toISOString();

  shipments.forEach((shipment) => {
    const shipDate = (shipment.ship_date && shipment.ship_date.trim()) || (shipment.created_at ? shipment.created_at.slice(0, 10) : now.slice(0, 10));
    const trackingGroupId = resolveTrackingGroupIdForBackfill(
      shipment.organization_id,
      shipDate,
      shipment.service_center_id,
      shipment.courier_service_id,
      shipment.service_type_id,
      (shipment.mail_delivery_type_id || '').trim()
    );
    update.run(trackingGroupId, shipDate, now, shipment.id);
  });
}

initSchema();
ensureOrganizationColumns();
ensureUserColumns();
ensureShipmentColumns();
ensureTrackingGroupColumns();
ensureTimeStationColumns();
seedDropdownDefaults();
backfillShipDates();
backfillCourierServiceFromLegacyFedExColumn();
backfillServiceTypeFromLegacyFedExColumn();
backfillMissingServiceTypeFromDefault();
backfillTrackingGroupsFromShipmentData();

// Create initial super admin if none exists
const adminExists = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (!adminExists) {
  const id = '00000000-0000-4000-8000-000000000001';
  const now = new Date().toISOString();
  const password_hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (id, email, name, password_hash, role, organization_id, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)')
    .run(id, 'admin@system.com', 'System Admin', password_hash, 'SuperAdmin', null, now, now);
}

export default db;
