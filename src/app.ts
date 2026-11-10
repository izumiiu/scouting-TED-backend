import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { tedRoutes } from './routes/ted.routes.js';
export function createApp(origin: string) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin }));
  app.use(express.json({ limit: '100kb' }));
  // Process liveness only; no database/provider readiness is claimed yet.
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', service: 'ted-intake', phase: 'foundation' });
  });
  app.use('/api', tedRoutes());
  app.use((_req, res) => {
    res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'ไม่พบเส้นทางที่เรียก' } });
  });
  return app;
}
