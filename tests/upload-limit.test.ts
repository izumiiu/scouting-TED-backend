import { describe, it, expect } from "vitest";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";
import { MulterError } from "multer";
import { upload, validateFile } from "../src/middleware/upload.js";

// Exercise the real multipart middleware without storing documents or calling AI.
const app = express();
app.post("/upload", upload, validateFile, (req, res) => res.json({size: req.file!.size}));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  res.status(400).json({code: error instanceof MulterError ? error.code : "INVALID_FILE"});
});
describe("TED upload size boundary", () => {
  it.each([12 * 1024 * 1024, 20 * 1024 * 1024])("accepts a DOCX upload of %i bytes", async size => {
    const buffer = Buffer.alloc(size);
    buffer.set([0x50, 0x4b, 0x03, 0x04]);
    const response = await request(app).post("/upload").attach("file", buffer, {
      filename: "size-check.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }).expect(200);
    expect(response.body.size).toBe(size);
  });
  it("rejects even one byte over 20 MiB", async () => {
    const response = await request(app).post("/upload").attach("file", Buffer.alloc(20 * 1024 * 1024 + 1), {
      filename: "too-large.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }).expect(400);
    expect(response.body.code).toBe("LIMIT_FILE_SIZE");
  });
});
