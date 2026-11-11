import multer from "multer";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors.js";
const pdf = "application/pdf",
  docx =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
    fields: 3,
    fieldSize: 3000,
    parts: 4,
  },
  fileFilter: (_req, file, done) => {
    const ext = file.originalname.toLowerCase();
    if (
      (ext.endsWith(".pdf") && file.mimetype === pdf) ||
      (ext.endsWith(".docx") && file.mimetype === docx)
    )
      done(null, true);
    else done(new AppError(400, "INVALID_FILE", "รับเฉพาะ PDF และ DOCX"));
  },
}).single("file");
export function validateFile(req: Request, _res: Response, next: NextFunction) {
  const f = req.file;
  if (!f) {
    next(new AppError(400, "INVALID_FILE", "กรุณาเลือกไฟล์"));
    return;
  }
  const valid =
    f.mimetype === pdf
      ? f.buffer.subarray(0, 5).toString() === "%PDF-"
      : f.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (!valid) {
    next(new AppError(400, "INVALID_FILE", "เนื้อหาไฟล์ไม่ตรงกับชนิดที่ระบุ"));
    return;
  }
  const decoded = Buffer.from(f.originalname, "latin1").toString("utf8");
  f.originalname = (decoded.includes("\uFFFD") ? f.originalname : decoded)
    .replace(/[\\/\x00-\x1f\x7f]/g, "_")
    .slice(-180);
  next();
}
