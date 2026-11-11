import mongoose, { Types } from "mongoose";
import { createHash } from "node:crypto";
import type { Actor } from "../middleware/auth.js";
import type { Config } from "../config/env.js";
import {
  IntakeCase,
  IntakeRun,
  IntakeReview,
  IntakeEvent,
  type CaseData,
} from "../models/Intake.js";
import { tedCriteria } from "../domain/ted-criteria.js";
import { topics, type Topic } from "../domain/intake.js";
import { AppError, conflict } from "../utils/errors.js";
import { object, text, integer } from "../validators/common.js";
import { bucket, storeFile } from "./file-store.js";
import { promptVersion } from "./ai.service.js";
export const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const missing = () => new AppError(404, "NOT_FOUND", "ไม่พบโครงการ");
export async function findCase(id: string, actor: Actor) {
  const c = await IntakeCase.findOne({
    _id: id,
    organizationId: actor.organizationId,
  });
  if (!c) throw missing();
  return c;
}
function runData(c: CaseData, id: Types.ObjectId, config: Config) {
  return {
    caseId: id,
    organizationId: c.organizationId,
    revision: c.revision,
    provider: config.aiProvider,
    model: config.aiModel,
    promptVersion,
    criteria: tedCriteria,
    overrides: c.overrides,
    status: "queued" as const,
    availableAt: new Date(),
  };
}
export function requireAi(config: Config) {
  if (!config.aiKey || !config.aiModel || !config.workerEnabled)
    throw new AppError(
      503,
      "AI_NOT_CONFIGURED",
      "ผู้ดูแลต้องตั้งค่า Groq และเปิด worker ก่อนอัปโหลดหรือวิเคราะห์",
    );
}
export async function createIntake(
  actor: Actor,
  file: Express.Multer.File,
  body: unknown,
  key: string,
  config: Config,
) {
  requireAi(config);
  const input = object(body),
    title = text(input.title, "ชื่อโครงการ", 200),
    permissionReference = text(
      input.permissionReference,
      "ที่มาของสิทธิ์",
      500,
    );
  if (!title || !permissionReference || input.allowAi !== "true")
    throw new AppError(
      400,
      "INVALID_INPUT",
      "ระบุชื่อโครงการ ที่มาของสิทธิ์ และยืนยันอนุญาตประมวลผลเอกสาร",
    );
  const sha256 = digest(file.buffer),
    createHashValue = digest(
      JSON.stringify({ sha256, title, permissionReference }),
    );
  const prior = await IntakeCase.findOne({
    organizationId: actor.organizationId,
    createdBy: actor.id,
    createKey: key,
  });
  if (prior) {
    if (prior.createHash !== createHashValue)
      throw conflict("คำขอเดิมมีข้อมูลต่างกัน");
    return { id: String(prior._id), duplicate: true };
  }
  const duplicate = await IntakeCase.findOne({
    organizationId: actor.organizationId,
    sha256,
  });
  if (duplicate) return { id: String(duplicate._id), duplicate: true };
  const fileId = await storeFile(file.buffer, file.originalname, file.mimetype);
  let createdId = "";
  try {
    await mongoose.connection.transaction(async (session) => {
      const [c] = await IntakeCase.create(
        [
          {
            organizationId: actor.organizationId,
            title,
            fileId,
            fileName: file.originalname,
            mime: file.mimetype,
            bytes: file.size,
            sha256,
            permissionReference,
            allowAi: true,
            createdBy: actor.id,
            createKey: key,
            createHash: createHashValue,
          },
        ],
        { session },
      );
      if (!c) throw new Error("Creation failed");
      const [run] = await IntakeRun.create([runData(c, c._id, config)], {
        session,
      });
      c.activeAnalysisId = run!._id;
      await c.save({ session });
      createdId = String(c._id);
      await IntakeEvent.create(
        [
          {
            caseId: c._id,
            organizationId: actor.organizationId,
            actorName: actor.name,
            action: "uploaded",
            details: { fileName: c.fileName, sha256, permissionReference },
          },
        ],
        { session },
      );
    });
    return { id: createdId, duplicate: false };
  } catch (error) {
    await bucket()
      .delete(fileId)
      .catch(() => {});
    if ((error as { code?: number }).code === 11000) {
      const winner = await IntakeCase.findOne({
        organizationId: actor.organizationId,
        sha256,
      });
      if (winner) return { id: String(winner._id), duplicate: true };
    }
    throw error;
  }
}
export async function queueAnalysis(
  id: string,
  actor: Actor,
  body: unknown,
  config: Config,
  edit: boolean,
) {
  requireAi(config);
  const input = object(body),
    expected = integer(input.revision);
  let overrides: Partial<Record<Topic, string>> | undefined;
  if (edit) {
    const raw = object(input.overrides);
    if (Object.keys(raw).some((k) => !topics.includes(k as Topic)))
      throw new AppError(400, "INVALID_INPUT", "พบหัวข้อที่ไม่รองรับ");
    overrides = {};
    for (const t of topics) {
      const v = text(raw[t], "ข้อมูลเพิ่มเติม", 1200);
      if (v) overrides[t] = v;
    }
    if (Object.values(overrides).join("").length > 4000)
      throw new AppError(
        400,
        "INVALID_INPUT",
        "ข้อมูลเพิ่มเติมรวมต้องไม่เกิน 4,000 ตัวอักษร",
      );
  }
  await mongoose.connection.transaction(async (session) => {
    const c = await IntakeCase.findOne({
      _id: id,
      organizationId: actor.organizationId,
    }).session(session);
    if (!c) throw missing();
    if (c.revision !== expected || c.activeAnalysisId)
      throw conflict("ข้อมูลเปลี่ยนหรือกำลังวิเคราะห์ กรุณาโหลดใหม่");
    if (edit) {
      c.overrides = overrides!;
      c.revision += 1;
    }
    const [run] = await IntakeRun.create([runData(c, c._id, config)], {
      session,
    });
    c.activeAnalysisId = run!._id;
    c.decisionVersion += 1;
    await c.save({ session });
    await IntakeEvent.create(
      [
        {
          caseId: c._id,
          organizationId: actor.organizationId,
          actorName: actor.name,
          action: edit ? "updated_and_queued" : "retry_requested",
          details: { revision: c.revision, runId: run!._id },
        },
      ],
      { session },
    );
  });
}
export async function reviewIntake(
  id: string,
  actor: Actor,
  body: unknown,
  key: string,
) {
  const input = object(body),
    revision = integer(input.revision),
    decisionVersion = integer(input.decisionVersion),
    notes = text(input.notes, "เหตุผล", 2000),
    destination = input.destination;
  if (
    !notes ||
    (destination !== "TED_IDEA" &&
      destination !== "TED_POC" &&
      destination !== null) ||
    input.acknowledged !== true
  )
    throw new AppError(
      400,
      "INVALID_INPUT",
      "เลือกผลพิจารณา ระบุเหตุผล และยืนยันว่าตรวจข้อมูลแล้ว",
    );
  const payloadHash = digest(
    JSON.stringify({
      revision,
      decisionVersion,
      notes,
      destination,
      analysisId: input.analysisId,
    }),
  );
  const prior = await IntakeReview.findOne({
    organizationId: actor.organizationId,
    caseId: id,
    key,
  });
  if (prior) {
    if (prior.payloadHash !== payloadHash)
      throw conflict("คำขอเดิมมีข้อมูลต่างกัน");
    return;
  }
  await mongoose.connection.transaction(async (session) => {
    const c = await IntakeCase.findOne({
      _id: id,
      organizationId: actor.organizationId,
    }).session(session);
    if (!c) throw missing();
    const run = await IntakeRun.findOne({
      _id: c.latestAnalysisId,
      caseId: c._id,
      organizationId: actor.organizationId,
    }).session(session);
    if (
      c.activeAnalysisId ||
      c.revision !== revision ||
      c.decisionVersion !== decisionVersion ||
      !run ||
      run.status !== "succeeded" ||
      run.processingMode === "DOCUMENT_CHECK" ||
      run.revision !== revision ||
      String(run._id) !== input.analysisId ||
      run.criteria.version !== tedCriteria.version ||
      run.promptVersion !== promptVersion
    )
      throw conflict(
        "ผลวิเคราะห์ไม่ใช่รุ่นปัจจุบัน กรุณาโหลดใหม่หรือวิเคราะห์ตามเกณฑ์ล่าสุด",
      );
    c.decisionVersion += 1;
    await c.save({ session });
    await IntakeReview.create(
      [
        {
          caseId: c._id,
          organizationId: actor.organizationId,
          analysisId: run._id,
          revision,
          decisionVersion: c.decisionVersion,
          destination,
          notes,
          reviewer: actor.id,
          reviewerName: actor.name,
          key,
          payloadHash,
        },
      ],
      { session },
    );
    await IntakeEvent.create(
      [
        {
          caseId: c._id,
          organizationId: actor.organizationId,
          actorName: actor.name,
          action: "reviewed",
          details: { analysisId: run._id, destination, notes },
        },
      ],
      { session },
    );
  });
}
export async function detail(id: string, actor: Actor) {
  const c = await findCase(id, actor);
  const [runs, reviews, events] = await Promise.all([
    IntakeRun.find({ caseId: c._id, organizationId: actor.organizationId })
      .sort({ _id: -1 })
      .limit(10)
      .lean(),
    IntakeReview.find({ caseId: c._id, organizationId: actor.organizationId })
      .sort({ _id: -1 })
      .limit(10)
      .lean(),
    IntakeEvent.find({ caseId: c._id, organizationId: actor.organizationId })
      .sort({ _id: -1 })
      .limit(30)
      .lean(),
  ]);
  const doc = c.document;
  const value = c.toObject();
  return {
    case: {
      ...value,
      document: undefined,
      documentInfo: doc
        ? {
            warnings: doc.warnings,
            pageCount: doc.pageCount,
            units: doc.units.length,
            extractorVersion: doc.extractorVersion,
            assessment: doc.assessment ?? null,
          }
        : null,
    },
    runs,
    reviews,
    events,
  };
}
