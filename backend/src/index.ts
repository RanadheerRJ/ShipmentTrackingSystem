import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import authRoutes from './routes/auth';
import orgRoutes from './routes/organizations';
import userRoutes from './routes/users';
import shipmentRoutes from './routes/shipments';
import dropdownRoutes from './routes/dropdowns';
import auditRoutes from './routes/audit';
import timeStationRoutes from './routes/timeStation';
import db from './db';

dotenv.config();

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(cookieParser());

// Allow browser requests from frontend (simple dev CORS policy)
app.use(cors({ origin: true, credentials: true }));

app.use('/api/auth', authRoutes);
app.use('/api/organizations', orgRoutes);
app.use('/api/users', userRoutes);
app.use('/api/shipments', shipmentRoutes);
app.use('/api/dropdowns', dropdownRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/time-station', timeStationRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
  console.log('DB file:', (db as any).name || 'shipment.db');
});
