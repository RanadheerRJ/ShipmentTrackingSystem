import { Router } from 'express';
import db from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const orgId = req.query.organizationId || req.user.organization_id;
  let rows = db.prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC').all();
  if (orgId) {
    rows = db.prepare('SELECT * FROM audit_logs WHERE organization_id = ? OR organization_id IS NULL ORDER BY timestamp DESC').all(orgId);
  }
  res.json(rows);
});

export default router;
