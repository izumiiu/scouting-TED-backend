import { Router } from 'express';
import { getTedCatalog } from '../controllers/ted.controller.js';
export function tedRoutes() {
  const router = Router();
  router.get('/catalog', getTedCatalog);
  return router;
}
