import { promptVersion } from "../services/ai.service.js";
import type { RequestHandler } from "express";
import type { Config } from "../config/env.js";
import { tedCriteria } from "../domain/ted-criteria.js";
import { topics, topicLabels } from "../domain/intake.js";
export function getTedCatalog(config: Config): RequestHandler {
  return (_req, res) =>
    res.json({
      programs: [
        { code: "TED_IDEA", label: "TED IDEA" },
        { code: "TED_POC", label: "TED POC" },
      ],
      fields: topics.map((id) => ({ id, label: topicLabels[id] })),
      tedCriteria,
      analysisVersion: promptVersion,
      aiConfigured: !!(config.aiKey && config.aiModel && config.workerEnabled),
    });
}
