import { Router } from 'express';
import db from '../db';
import { v4 as uuidv4 } from 'uuid';
import { requireRole, } from '../middleware/rbac';
import { requireAuth } from '../middleware/auth';
import { hashPassword } from '../utils/hash';
import { normalizeOptionalImageField } from '../utils/imageDataUrl';

const router = Router();

router.use(requireAuth);

interface CountRow {
  c: number;
}

interface OrganizationRow {
  id: string;
  name: string;
  phone_number: string | null;
  location: string | null;
  logo_data_url: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM organizations').all();
  res.json(rows);
});

router.get('/:id/stats', (req, res) => {
  const { id } = req.params;
  const actor = (req as any).user;
  if (actor.role !== 'SuperAdmin' && actor.organization_id !== id) {
    return res.status(403).json({ error: 'Insufficient role' });
  }

  const canViewAllOrgShipments = actor.role === 'SuperAdmin' || actor.role === 'OrgAdmin' || actor.role === 'FRONT_DESK';
  const shipmentParams: any[] = [id];
  let shipmentSql = 'SELECT * FROM shipments WHERE organization_id = ? AND is_deleted = 0';
  if (!canViewAllOrgShipments) {
    shipmentSql += ' AND (attorney_id = ? OR paralegal_id = ?)';
    shipmentParams.push(actor.id, actor.id);
  }

  const shipments = db.prepare(shipmentSql).all(...shipmentParams);
  const users = db.prepare('SELECT * FROM users WHERE organization_id = ? AND is_active = 1').all(id);
  const stats = {
    totalShipments: shipments.length,
    draftShipments: shipments.filter((s: any) => s.status === 'Draft').length,
    submittedShipments: shipments.filter((s: any) => s.status === 'Submitted').length,
    inTransitShipments: shipments.filter((s: any) => s.status === 'In Transit').length,
    deliveredShipments: shipments.filter((s: any) => s.status === 'Delivered').length,
    paidShipments: shipments.filter((s: any) => s.payment_status === 'Paid').length,
    unpaidShipments: shipments.filter((s: any) => s.payment_status === 'Not Paid').length,
    totalUsers: users.length,
  };
  res.json(stats);
});

router.get('/stats/global', (req, res) => {
  if ((req as any).user.role !== 'SuperAdmin') {
    return res.status(403).json({ error: 'Insufficient role' });
  }
  const shipments = db.prepare('SELECT * FROM shipments WHERE is_deleted = 0').all();
  const orgs = db.prepare('SELECT * FROM organizations').all();
  const users = db.prepare('SELECT * FROM users WHERE is_active = 1').all();
  const stats = {
    totalOrgs: orgs.length,
    activeOrgs: orgs.filter((o: any) => o.is_active).length,
    totalShipments: shipments.length,
    totalUsers: users.length,
    recentAuditCount: db.prepare<[], CountRow>('SELECT COUNT(*) as c FROM audit_logs').get()?.c ?? 0,
  };
  res.json(stats);
});

router.post('/', requireRole('SuperAdmin'), async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const phoneNumber = typeof req.body?.phone_number === 'string' ? req.body.phone_number.trim() : '';
  const location = typeof req.body?.location === 'string' ? req.body.location.trim() : '';
  const logoField = normalizeOptionalImageField(req.body?.logo_data_url, 'Org logo');
  const adminEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const adminPassword = typeof req.body?.password === 'string' ? req.body.password : '';

  if (logoField.error) {
    return res.status(400).json({ error: logoField.error });
  }
  if (!name || !phoneNumber || !location || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: 'Name, phone number, location, email and password are required' });
  }
  if (!/^\d+$/.test(phoneNumber)) {
    return res.status(400).json({ error: 'Phone number must contain numbers only' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  if (adminPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const existingUser = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(adminEmail);
  if (existingUser) {
    return res.status(400).json({ error: 'Email already exists' });
  }

  const id = uuidv4();
  const adminId = uuidv4();
  const now = new Date().toISOString();
  const password_hash = await hashPassword(adminPassword);
  const orgAdminName = `${name} Admin`;
  const actor = (req as any).user;
  const logoDataUrl = logoField.value;

  const createOrgAndAdmin = db.transaction(() => {
    db.prepare('INSERT INTO organizations (id, name, phone_number, location, logo_data_url, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
      .run(id, name, phoneNumber, location, logoDataUrl, now, now);

    const insertCourier = db.prepare('INSERT INTO courier_services (id, organization_id, name, is_active, created_at) VALUES (?, ?, ?, 1, ?)');
    ['FedEx', 'UPS', 'USPS'].forEach((serviceName) => {
      insertCourier.run(uuidv4(), id, serviceName, now);
    });

    const insertServiceType = db.prepare('INSERT INTO service_types (id, organization_id, name, is_active, created_at) VALUES (?, ?, ?, 1, ?)');
    ['Overnight', '2-Day', 'Ground'].forEach((serviceType) => {
      insertServiceType.run(uuidv4(), id, serviceType, now);
    });

    db.prepare('INSERT INTO users (id, email, name, password_hash, role, organization_id, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)')
      .run(adminId, adminEmail, orgAdminName, password_hash, 'OrgAdmin', id, now, now);

    db.prepare('INSERT INTO audit_logs (id, entity_type, entity_id, action_type, old_value, new_value, performed_by, performed_by_name, organization_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uuidv4(), 'Organization', id, 'CREATE', null, JSON.stringify({ id, name, phone_number: phoneNumber, location, logo_data_url: logoDataUrl }), actor.id, actor.name, null, now);

    db.prepare('INSERT INTO audit_logs (id, entity_type, entity_id, action_type, old_value, new_value, performed_by, performed_by_name, organization_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uuidv4(), 'User', adminId, 'CREATE', null, JSON.stringify({ id: adminId, email: adminEmail, name: orgAdminName, role: 'OrgAdmin', organization_id: id }), actor.id, actor.name, id, now);
  });

  try {
    createOrgAndAdmin();
  } catch {
    return res.status(400).json({ error: 'Failed to create organization' });
  }

  res.status(201).json({
    id,
    name,
    phone_number: phoneNumber,
    location,
    logo_data_url: logoDataUrl,
    orgAdmin: { id: adminId, email: adminEmail, role: 'OrgAdmin' },
  });
});

router.put('/:id', requireRole('SuperAdmin'), (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const existing = db.prepare<[string], OrganizationRow>('SELECT * FROM organizations WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const logoField = normalizeOptionalImageField(updates?.logo_data_url, 'Org logo');
  if (logoField.error) {
    return res.status(400).json({ error: logoField.error });
  }
  if (updates.phone_number !== undefined && updates.phone_number !== null) {
    const phoneNumber = String(updates.phone_number).trim();
    if (phoneNumber && !/^\d+$/.test(phoneNumber)) {
      return res.status(400).json({ error: 'Phone number must contain numbers only' });
    }
  }
  const nextName = updates.name ?? existing.name;
  const nextPhoneNumber = updates.phone_number ?? existing.phone_number ?? null;
  const nextLocation = updates.location ?? existing.location ?? null;
  const nextLogoDataUrl = logoField.provided ? logoField.value : (existing.logo_data_url ?? null);
  const nextIsActive = (updates.is_active === undefined ? existing.is_active : (updates.is_active ? 1 : 0));
  const now = new Date().toISOString();
  db.prepare('UPDATE organizations SET name = ?, phone_number = ?, location = ?, logo_data_url = ?, is_active = ?, updated_at = ? WHERE id = ?')
    .run(
      nextName,
      nextPhoneNumber,
      nextLocation,
      nextLogoDataUrl,
      nextIsActive,
      now,
      id
    );
  const nextValues = {
    ...existing,
    name: nextName,
    phone_number: nextPhoneNumber,
    location: nextLocation,
    logo_data_url: nextLogoDataUrl,
    is_active: nextIsActive,
    updated_at: now,
  };
  db.prepare('INSERT INTO audit_logs (id, entity_type, entity_id, action_type, old_value, new_value, performed_by, performed_by_name, organization_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), 'Organization', id, 'UPDATE', JSON.stringify(existing), JSON.stringify(nextValues), (req as any).user.id, (req as any).user.name, null, now);
  res.json({
    id,
    name: nextName,
    phone_number: nextPhoneNumber,
    location: nextLocation,
    logo_data_url: nextLogoDataUrl,
    is_active: !!nextIsActive,
    updated_at: now,
  });
});

router.delete('/:id', requireRole('SuperAdmin'), (req, res) => {
  const { id } = req.params;
  const existing = db.prepare<[string], OrganizationRow>('SELECT * FROM organizations WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const cleanupAndDelete = db.transaction((organizationId: string) => {
    db.prepare('DELETE FROM tracking_groups WHERE organization_id = ?').run(organizationId);
    db.prepare('DELETE FROM shipments WHERE organization_id = ?').run(organizationId);
    db.prepare('DELETE FROM users WHERE organization_id = ?').run(organizationId);
    db.prepare('DELETE FROM service_centers WHERE organization_id = ?').run(organizationId);
    db.prepare('DELETE FROM case_types WHERE organization_id = ?').run(organizationId);
    db.prepare('DELETE FROM mail_delivery_types WHERE organization_id = ?').run(organizationId);
    db.prepare('DELETE FROM courier_services WHERE organization_id = ?').run(organizationId);
    db.prepare('DELETE FROM service_types WHERE organization_id = ?').run(organizationId);
    db.prepare('DELETE FROM organizations WHERE id = ?').run(organizationId);
  });

  try {
    cleanupAndDelete(id);
  } catch {
    return res.status(400).json({ error: 'Failed to delete organization' });
  }

  const now = new Date().toISOString();
  db.prepare('INSERT INTO audit_logs (id, entity_type, entity_id, action_type, old_value, new_value, performed_by, performed_by_name, organization_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), 'Organization', id, 'DELETE', JSON.stringify(existing), null, (req as any).user.id, (req as any).user.name, null, now);

  res.json({ id, deleted: true });
});

export default router;
