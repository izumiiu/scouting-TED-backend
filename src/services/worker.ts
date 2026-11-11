import { randomUUID } from "node:crypto";
import type { Config } from "../config/env.js";
import { IntakeCase, IntakeRun, ProviderGate } from "../models/Intake.js";
import { readFile } from "./file-store.js";
import { parseDocument } from "./document-parser.js";
import { selectSources } from "./source-selection.js";
import { createAnalyzer, type Analyze } from "./ai.service.js";
import { extractorVersion } from "../domain/document-version.js";
import { documentCheckResult } from "./document-check.js";
import { AppError } from "../utils/errors.js";
// Durable queue: a lease prevents two workers processing the same run. Abandoned
// calls fail for explicit officer retry; automatic retries could duplicate cost.
export async function processNext(
  config: Config,
  analyze: Analyze = createAnalyzer(config),
): Promise<boolean> {
  const expired = await IntakeRun.find({
    status: { $in: ["extracting", "analyzing"] },
    leaseUntil: { $lt: new Date() },
  }).select("_id caseId");
  for (const run of expired) {
    const changed = await IntakeRun.updateOne(
      {
        _id: run._id,
        status: { $in: ["extracting", "analyzing"] },
        leaseUntil: { $lt: new Date() },
      },
      {
        $set: {
          status: "failed",
          error: "งานหยุดกลางทาง กรุณาตรวจแล้วกดลองใหม่",
          finishedAt: new Date(),
        },
      },
    );
    if (changed.modifiedCount)
      await IntakeCase.updateOne(
        { _id: run.caseId, activeAnalysisId: run._id },
        { $set: { activeAnalysisId: null, latestAnalysisId: run._id } },
      );
  }
  const pendingPointers = await IntakeCase.find({
    activeAnalysisId: { $ne: null },
  })
    .select("_id activeAnalysisId revision")
    .limit(100)
    .lean();
  for (const c of pendingPointers) {
    const terminal = await IntakeRun.findOne({
      _id: c.activeAnalysisId,
      caseId: c._id,
      revision: c.revision,
      status: { $in: ["succeeded", "failed"] },
    })
      .select("_id")
      .lean();
    if (terminal)
      await IntakeCase.updateOne(
        { _id: c._id, activeAnalysisId: terminal._id },
        { $set: { activeAnalysisId: null, latestAnalysisId: terminal._id } },
      );
  }
  const leaseId = randomUUID();
  const run = await IntakeRun.findOneAndUpdate(
    { status: "queued", availableAt: { $lte: new Date() } },
    {
      $set: {
        status: "extracting",
        leaseId,
        leaseUntil: new Date(Date.now() + 180000),
      },
    },
    { sort: { createdAt: 1 }, returnDocument: "after" },
  );
  if (!run) return false;
  try {
    const c = await IntakeCase.findOne({
      _id: run.caseId,
      organizationId: run.organizationId,
      revision: run.revision,
      activeAnalysisId: run._id,
    });
    if (!c) throw new AppError(409, "STALE", "ข้อมูลถูกเปลี่ยนระหว่างรอ");
    let document = c.document;
    if (!document || document.extractorVersion !== extractorVersion) {
      document = await parseDocument(
        await readFile(c.fileId),
        c.mime === "application/pdf" ? "pdf" : "docx",
      );
      await IntakeCase.updateOne(
        { _id: c._id, revision: run.revision, activeAnalysisId: run._id },
        { $set: { document } },
      );
    }
    const selection = selectSources(document, run.overrides);
    run.sources = selection.sources;
    run.coverage = selection.coverage;
    const local = documentCheckResult(document, selection.sources);
    const metadata = {
      documentAssessment: document.assessment ?? null,
      extractorVersion: document.extractorVersion,
      processingMode: local ? "DOCUMENT_CHECK" : "AI",
    };
    await IntakeRun.updateOne(
      { _id: run._id, leaseId, status: "extracting" },
      { $set: { ...metadata, sources: run.sources, coverage: run.coverage } },
    );
    if (local) {
      const changed = await IntakeRun.updateOne(
        { _id: run._id, leaseId, status: "extracting" },
        {
          $set: {
            status: "succeeded",
            result: local,
            finishedAt: new Date(),
            leaseUntil: null,
          },
        },
      );
      if (changed.modifiedCount)
        await IntakeCase.updateOne(
          { _id: c._id, revision: run.revision, activeAnalysisId: run._id },
          { $set: { activeAnalysisId: null, latestAnalysisId: run._id } },
        );
      return true;
    }
    // One reservation shared by all TED worker processes in this database.
    await ProviderGate.updateOne(
      { _id: "ai" },
      { $setOnInsert: { nextAt: new Date(0) } },
      { upsert: true },
    ).catch((e) => {
      if (e.code !== 11000) throw e;
    });
    const gate = await ProviderGate.findOneAndUpdate(
      { _id: "ai", nextAt: { $lte: new Date() } },
      { $set: { nextAt: new Date(Date.now() + config.providerIntervalMs) } },
      { returnDocument: "after" },
    );
    if (!gate) {
      const next = await ProviderGate.findById("ai");
      await IntakeRun.updateOne(
        { _id: run._id, leaseId, status: "extracting" },
        {
          $set: {
            status: "queued",
            availableAt: next?.nextAt ?? new Date(Date.now() + 65000),
            leaseId: null,
            leaseUntil: null,
            sources: run.sources,
            coverage: run.coverage,
          },
        },
      );
      return true;
    }
    const claimed = await IntakeRun.updateOne(
      { _id: run._id, leaseId, status: "extracting" },
      {
        $set: {
          status: "analyzing",
          sources: run.sources,
          coverage: run.coverage,
        },
      },
    );
    if (!claimed.modifiedCount) return true;
    const output = await analyze(run.sources, run.criteria);
    const changed = await IntakeRun.updateOne(
      { _id: run._id, leaseId, status: "analyzing" },
      {
        $set: {
          status: "succeeded",
          result: output.result,
          providerRequestId: output.requestId,
          finishedAt: new Date(),
          leaseUntil: null,
        },
      },
    );
    if (changed.modifiedCount)
      await IntakeCase.updateOne(
        { _id: c._id, revision: run.revision, activeAnalysisId: run._id },
        { $set: { activeAnalysisId: null, latestAnalysisId: run._id } },
      );
  } catch (error) {
    const message =
      error instanceof AppError
        ? error.message
        : "ประมวลผลไม่สำเร็จ กรุณาตรวจไฟล์ การเชื่อมต่อ และการตั้งค่า AI ก่อนลองใหม่";
    const changed = await IntakeRun.updateOne(
      { _id: run._id, leaseId, status: { $in: ["extracting", "analyzing"] } },
      {
        $set: {
          status: "failed",
          error: message,
          finishedAt: new Date(),
          leaseUntil: null,
        },
      },
    );
    if (changed.modifiedCount)
      await IntakeCase.updateOne(
        { _id: run.caseId, activeAnalysisId: run._id },
        { $set: { activeAnalysisId: null, latestAnalysisId: run._id } },
      );
  }
  return true;
}
export function startWorker(config: Config) {
  let stopping = false;
  let active: Promise<void> | null = null;
  const tick = () => {
    if (stopping || active) return;
    active = processNext(config)
      .then(() => {})
      .catch(() => console.error("TED worker database operation failed"))
      .finally(() => {
        active = null;
      });
  };
  const timer = setInterval(tick, 1500);
  tick();
  return async () => {
    stopping = true;
    clearInterval(timer);
    await active;
  };
}
