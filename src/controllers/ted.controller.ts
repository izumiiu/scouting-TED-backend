import type { RequestHandler } from 'express';
import { tedCriteria } from '../domain/ted-criteria.js';
export const getTedCatalog: RequestHandler = (_req, res) => {
  res.json({
    programs: [
      { code: 'TED_IDEA', label: 'TED IDEA' },
      { code: 'TED_POC', label: 'TED POC' },
    ],
    fields: [
      { id: 'C2', label: 'ขั้นการพัฒนาผลิตภัณฑ์หรือต้นแบบ' },
      { id: 'D5', label: 'ข้อมูลเงินทุนที่รายงาน' },
    ],
    tedCriteria,
  });
};
