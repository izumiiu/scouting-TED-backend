import { Router } from "express";
import type { Config } from "../config/env.js";
import { authController } from "../controllers/auth.controller.js";
import { intakeController } from "../controllers/intake.controller.js";
import { authentication } from "../middleware/auth.js";
import { rateLimit } from "../middleware/security.js";
import { upload, validateFile } from "../middleware/upload.js";
import { getTedCatalog } from "../controllers/ted.controller.js";
export function tedRoutes(config: Config) {
  const r = Router(),
    auth = authController(config),
    intake = intakeController(config);
  r.post("/auth/login", rateLimit("login", 15, 15 * 60000), auth.login);
  r.use(authentication(config));
  r.get("/auth/me", auth.me);
  r.post("/auth/logout", auth.logout);
  r.get("/catalog", getTedCatalog(config));
  r.get("/cases", intake.list);
  r.post(
    "/cases",
    rateLimit("upload", 10, 60 * 60000),
    upload,
    validateFile,
    intake.create,
  );
  r.get("/cases/:id", intake.detail);
  r.get("/cases/:id/file", intake.download);
  r.put(
    "/cases/:id/overrides",
    rateLimit("analysis", 12, 60 * 60000),
    intake.update,
  );
  r.post(
    "/cases/:id/retry",
    rateLimit("analysis", 12, 60 * 60000),
    intake.retry,
  );
  r.post("/cases/:id/reviews", intake.review);
  return r;
}
