import { Router } from 'express';
import db from '../db';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);
const allowedTypes = ['service_centers', 'case_types', 'mail_delivery_types', 'courier_services', 'service_types'];

router.get('/:type', (req, res) => {
  const { type } = req.params;
  const orgId = req.query.organizationId || req.user.organization_id;
  if (!allowedTypes.includes(type)) return res.status(400).json({ error: 'Invalid type' });
  const rows = db.prepare(`SELECT * FROM ${type} WHERE organization_id = ? AND is_active = 1`).all(orgId);
  res.json(rows);
});

router.post('/:type', (req, res) => {
  const { type } = req.params;
  const { name, organization_id } = req.body;
  if (!allowedTypes.includes(type)) return res.status(400).json({ error: 'Invalid type' });
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO ${type} (id, organization_id, name, is_active, created_at) VALUES (?, ?, ?, 1, ?)`)
    .run(id, organization_id ?? req.user.organization_id, name, now);
  db.prepare('INSERT INTO audit_logs (id, entity_type, entity_id, action_type, old_value, new_value, performed_by, performed_by_name, organization_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), 'Dropdown', id, 'CREATE', null, JSON.stringify({ type, id, name }), req.user.id, req.user.name, organization_id ?? req.user.organization_id, now);
  res.status(201).json({ id, name });
});

router.delete('/:type/:id', (req, res) => {
  const { type, id } = req.params;
  if (!allowedTypes.includes(type)) return res.status(400).json({ error: 'Invalid type' });
  const item = db.prepare(`SELECT * FROM ${type} WHERE id = ?`).get(id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE ${type} SET is_active = 0 WHERE id = ?`).run(id);
  db.prepare('INSERT INTO audit_logs (id, entity_type, entity_id, action_type, old_value, new_value, performed_by, performed_by_name, organization_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), 'Dropdown', id, 'DELETE', JSON.stringify(item), null, req.user.id, req.user.name, item.organization_id, new Date().toISOString());
  res.json({ success: true });
});

export default router;
