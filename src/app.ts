import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { MulterError } from "multer";
import type { Config } from "./config/env.js";
import { tedRoutes } from "./routes/ted.routes.js";
import { csrfGuard } from "./middleware/security.js";
import { AppError } from "./utils/errors.js";
export function createApp(config: Config) {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxyHops) app.set("trust proxy", config.trustProxyHops);
  app.use(helmet());
  app.use(cors({ origin: config.origin, credentials: true }));
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader("X-Request-ID", req.requestId);
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/healthz", (_req, res) =>
    res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({
      status: mongoose.connection.readyState === 1 ? "ok" : "unavailable",
      service: "ted-intake",
    }),
  );
  app.use(
    "/api",
    csrfGuard(config.origin),
    cookieParser(),
    express.json({ limit: "50kb" }),
    tedRoutes(config),
  );
  app.use((_req, res) => {
    res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "ไม่พบเส้นทางที่เรียก" } });
  });
  app.use(
    (
      error: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (res.headersSent) {
        next(error);
        return;
      }
      let safe =
        error instanceof AppError
          ? error
          : new AppError(
              500,
              "INTERNAL_ERROR",
              "ระบบทำงานไม่สำเร็จ กรุณาลองใหม่",
            );
      if (error instanceof MulterError)
        safe = new AppError(
          400,
          "INVALID_FILE",
          "ไฟล์ต้องไม่เกิน 20 MB และอัปโหลดได้ครั้งละหนึ่งไฟล์",
        );
      if (error instanceof SyntaxError)
        safe = new AppError(400, "INVALID_INPUT", "รูปแบบ JSON ไม่ถูกต้อง");
      if ((error as { code?: number })?.code === 11000)
        safe = new AppError(409, "CONFLICT", "มีคำขอนี้แล้ว กรุณาโหลดใหม่");
      if ((error as { type?: string })?.type === "entity.too.large")
        safe = new AppError(413, "TOO_LARGE", "ข้อมูลเกินขนาดที่กำหนด");
      res.status(safe.status).json({
        error: {
          code: safe.code,
          message: safe.message,
          requestId: req.requestId,
        },
      });
    },
  );
  return app;
}
