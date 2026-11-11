import type { Request, Response } from "express";
import type { Config } from "../config/env.js";
import { actorOf } from "../middleware/auth.js";
import { id, key } from "../validators/common.js";
import { IntakeCase } from "../models/Intake.js";
import * as service from "../services/intake.service.js";
import { bucket } from "../services/file-store.js";
import { pipeline } from "node:stream/promises";
export const intakeController = (config: Config) => ({
  list: async (req: Request, res: Response) => {
    res.json({
      cases: await IntakeCase.find({
        organizationId: actorOf(req).organizationId,
      })
        .select(
          "title fileName revision decisionVersion activeAnalysisId latestAnalysisId createdAt updatedAt",
        )
        .sort({ _id: -1 })
        .limit(100)
        .lean(),
    });
  },
  create: async (req: Request, res: Response) => {
    res
      .status(201)
      .json(
        await service.createIntake(
          actorOf(req),
          req.file!,
          req.body,
          key(req.get("Idempotency-Key")),
          config,
        ),
      );
  },
  detail: async (req: Request, res: Response) => {
    res.json(await service.detail(id(req.params.id), actorOf(req)));
  },
  update: async (req: Request, res: Response) => {
    await service.queueAnalysis(
      id(req.params.id),
      actorOf(req),
      req.body,
      config,
      true,
    );
    res.status(202).json({ queued: true });
  },
  retry: async (req: Request, res: Response) => {
    await service.queueAnalysis(
      id(req.params.id),
      actorOf(req),
      req.body,
      config,
      false,
    );
    res.status(202).json({ queued: true });
  },
  review: async (req: Request, res: Response) => {
    await service.reviewIntake(
      id(req.params.id),
      actorOf(req),
      req.body,
      key(req.get("Idempotency-Key")),
    );
    res.status(201).json({ saved: true });
  },
  download: async (req: Request, res: Response) => {
    const c = await service.findCase(id(req.params.id), actorOf(req));

    res.attachment(c.fileName);
    res.type("application/octet-stream");
    await pipeline(bucket().openDownloadStream(c.fileId), res);
  },
});
