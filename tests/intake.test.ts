import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createApp } from "../src/app.js";
import type { Config } from "../src/config/env.js";
import { loadConfig } from "../src/config/env.js";
import { Staff } from "../src/models/Staff.js";
import {
  IntakeCase,
  IntakeRun,
  IntakeReview,
  IntakeEvent,
  ProviderGate,
} from "../src/models/Intake.js";
import { RateBucket } from "../src/models/RateBucket.js";
import { processNext } from "../src/services/worker.js";
import { parseDocument } from "../src/services/document-parser.js";
import {
  validateResult,
  createAnalyzer,
  type Analyze,
} from "../src/services/ai.service.js";
import { topics, type SourceUnit } from "../src/domain/intake.js";
import { selectSources } from "../src/services/source-selection.js";
import { tedCriteria } from "../src/domain/ted-criteria.js";
import { AppError } from "../src/utils/errors.js";
const config: Config = {
  port: 4100,
  origin: "http://localhost:5174",
  mongoUri: "",
  dbName: "ted_test",
  jwtSecret: "test-only-secret-at-least-32-characters",
  production: false,
  trustProxyHops: 0,
  aiProvider: "groq",
  aiKey: "fixture-not-real",
  aiModel: "test-fixture",
  workerEnabled: true,
  providerIntervalMs: 0,
};
const app = createApp(config),
  agent = request.agent(app),
  outsider = request.agent(app);
const headers = { "X-Requested-With": "TedIntake", Origin: config.origin };
const fixture = (name: string) =>
  readFile(new URL(`./fixtures/${name}`, import.meta.url));
const raw = (sources: SourceUnit[]) => ({
  summary: "ข้อมูลจำลองสำหรับทดสอบ ไม่ใช่ผลประเมินจริง",
  fields: topics.map((key) => ({
    key,
    value: key === "technology" ? "ต้นแบบเซนเซอร์ที่มีผลทดสอบ" : null,
    evidenceRefs: key === "technology" ? [sources[0]!.id] : [],
  })),
  tedAssessment: {
    classification: "TED_POC",
    reason: "มีต้นแบบและแผนทดลองตลาด โดยยังต้องตรวจต้นฉบับ",
    alternativeReason: "มีหลักฐานพัฒนาเกินแนวคิด",
    evidenceRefs: [sources[0]!.id],
    uncertainties: ["ยังไม่ตรวจเอกสารประกอบ"],
    developmentStage: {
      stage: "WORKING_PROTOTYPE",
      reason: "ระบุว่าทำงานได้แล้ว",
      evidenceRefs: [sources[0]!.id],
    },
  },
  missingInformation: [
    { scope: "TED_POC", topic: "ผลทดลองกับผู้ใช้", question: "ขอหลักฐานผลทดลองกับผู้ใช้จริง", impact: "ยังยืนยันผลทดลองตลาดไม่ได้" },
  ],
});
const analyze: Analyze = vi.fn(async (sources) => ({
  result: validateResult(raw(sources), sources),
  requestId: "test-request",
}));
let replica: MongoMemoryReplSet,
  caseId: string,
  uploadKey = randomUUID(),
  doc: Buffer;
const upload = (key = uploadKey, title = "โครงการทดสอบ") =>
  agent
    .post("/api/cases")
    .set(headers)
    .set("Idempotency-Key", key)
    .field("title", title)
    .field("permissionReference", "เอกสารทดสอบที่สร้างเอง")
    .field("allowAi", "true")
    .attach("file", doc, {
      filename: "proposal.docx",
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
beforeAll(async () => {
  replica = await MongoMemoryReplSet.create({
    binary: { version: "8.2.6" },
    replSet: { count: 1 },
  });
  await mongoose.connect(replica.getUri(), { dbName: "ted_test" });
  await Promise.all([
    Staff.init(),
    IntakeCase.init(),
    IntakeRun.init(),
    IntakeReview.init(),
    IntakeEvent.init(),
    RateBucket.init(),
    ProviderGate.init(),
  ]);
  const hash = await bcrypt.hash("test-password-123", 4);
  await Staff.create([
    {
      email: "officer@example.test",
      name: "เจ้าหน้าที่",
      passwordHash: hash,
      organizationId: "ted-a",
    },
    {
      email: "other@example.test",
      name: "อีกหน่วยงาน",
      passwordHash: hash,
      organizationId: "ted-b",
    },
  ]);
  await agent
    .post("/api/auth/login")
    .set(headers)
    .send({ email: "officer@example.test", password: "test-password-123" })
    .expect(200);
  await outsider
    .post("/api/auth/login")
    .set(headers)
    .send({ email: "other@example.test", password: "test-password-123" })
    .expect(200);
  doc = await fixture("proposal.docx");
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  await replica?.stop();
});
describe("document parsing", () => {
  it("extracts DOCX with stable text locations", async () => {
    const parsed = await parseDocument(await fixture("proposal.docx"), "docx");
    expect(parsed.units.some((u) => u.text.includes("เซนเซอร์"))).toBe(true);
    expect(parsed.units[0]?.locator).toContain("ย่อหน้า 1");
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });
  it("extracts PDF text with page references", async () => {
    const parsed = await parseDocument(await fixture("proposal.pdf"), "pdf");
    expect(parsed.pageCount).toBe(1);
    expect(parsed.units[0]?.locator).toContain("หน้า 1");
    expect(parsed.units[0]?.text).toContain("working prototype");
  });
  it("rejects blank/scanned PDF and damaged DOCX", async () => {
    await expect(
      parseDocument(await fixture("blank.pdf"), "pdf"),
    ).rejects.toThrow(/OCR/);
    await expect(
      parseDocument(Buffer.from("PK broken"), "docx"),
    ).rejects.toThrow(/DOCX/);
  });
});
describe("authenticated workflow", () => {
  it("requires login and rejects wrong Origin before handling a file", async () => {
    await request(app).get("/api/cases").expect(401);
    await agent
      .post("/api/cases")
      .set({ "X-Requested-With": "TedIntake", Origin: "https://evil.test" })
      .expect(403);
  });
  it("uploads and queues automatically, repeated upload is idempotent", async () => {
    const created = await upload().expect(201);
    caseId = created.body.id;
    expect(caseId).toMatch(/^[a-f\d]{24}$/);
    expect(await IntakeRun.countDocuments()).toBe(1);
    expect((await upload().expect(201)).body.id).toBe(caseId);
    expect(await IntakeRun.countDocuments()).toBe(1);
    await upload(uploadKey, "คำขอเดิมชื่อเปลี่ยน").expect(409);
    expect((await upload(randomUUID()).expect(201)).body.duplicate).toBe(true);
  });
  it("does not reveal metadata or file to other organizations", async () => {
    await outsider.get(`/api/cases/${caseId}`).expect(404);
    await outsider.get(`/api/cases/${caseId}/file`).expect(404);
    expect((await outsider.get("/api/cases")).body.cases).toEqual([]);
  });
  it("one worker processes a run, saves cited results and immutable criteria", async () => {
    await Promise.all([
      processNext(config, analyze),
      processNext(config, analyze),
    ]);
    expect(analyze).toHaveBeenCalledTimes(1);
    const d = (await agent.get(`/api/cases/${caseId}`).expect(200)).body;
    expect(d.runs[0].status).toBe("succeeded");
    expect(d.runs[0].result.tedAssessment.fundingReadiness.status).toBe(
      "NEEDS_VERIFICATION",
    );
    expect(d.case.activeAnalysisId).toBeNull();
    expect(d.case.documentInfo.units).toBeGreaterThan(0);
    expect(d.runs[0].criteria.version).toBe(tedCriteria.version);
    expect(
      d.runs[0].sources.some(
        (s: SourceUnit) =>
          s.id === d.runs[0].result.tedAssessment.evidenceRefs[0],
      ),
    ).toBe(true);
  });
  it("downloads original bytes and stores human confirmation exactly once", async () => {
    const download = await agent.get(`/api/cases/${caseId}/file`).expect(200);
    expect(download.body).toEqual(doc);
    const d = (await agent.get(`/api/cases/${caseId}`)).body;
    const payload = {
        revision: 1,
        decisionVersion: 0,
        analysisId: d.runs[0]._id,
        destination: "TED_IDEA",
        notes: "เจ้าหน้าที่เลือกต่างจาก AI ตามหลักฐานเพิ่มเติม",
        acknowledged: true,
      },
      key = randomUUID();
    await agent
      .post(`/api/cases/${caseId}/reviews`)
      .set(headers)
      .set("Idempotency-Key", key)
      .send(payload)
      .expect(201);
    await agent
      .post(`/api/cases/${caseId}/reviews`)
      .set(headers)
      .set("Idempotency-Key", key)
      .send(payload)
      .expect(201);
    expect(await IntakeReview.countDocuments()).toBe(1);
    await agent
      .post(`/api/cases/${caseId}/reviews`)
      .set(headers)
      .set("Idempotency-Key", randomUUID())
      .send(payload)
      .expect(409);
  });
  it("editing invalidates old review and automatically queues a new revision", async () => {
    await agent
      .put(`/api/cases/${caseId}/overrides`)
      .set(headers)
      .send({
        revision: 1,
        overrides: { market: "เจ้าหน้าที่ตรวจผลทดสอบตลาดแล้ว 5 ราย" },
      })
      .expect(202);
    const d = (await agent.get(`/api/cases/${caseId}`)).body;
    expect(d.case.revision).toBe(2);
    expect(d.case.activeAnalysisId).not.toBeNull();
    await agent
      .put(`/api/cases/${caseId}/overrides`)
      .set(headers)
      .send({ revision: 1, overrides: {} })
      .expect(409);
    await processNext(config, analyze);
    const run = await IntakeRun.findById(d.case.activeAnalysisId);
    expect(
      run?.sources.some((s) => s.id === "O_market" && s.kind === "officer"),
    ).toBe(true);
    expect(await IntakeRun.countDocuments()).toBe(2);
    expect(await IntakeReview.countDocuments()).toBe(1);
  });
  it("keeps provider errors visible and does not retry automatically", async () => {
    await agent
      .post(`/api/cases/${caseId}/retry`)
      .set(headers)
      .send({ revision: 2 })
      .expect(202);
    const failing = vi.fn<Analyze>(async () => {
      throw new AppError(502, "AI_RATE_LIMITED", "โควตาทดสอบเต็ม");
    });
    await processNext(config, failing);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(await processNext(config, failing)).toBe(false);
    expect(failing).toHaveBeenCalledTimes(1);
    const d = (await agent.get(`/api/cases/${caseId}`)).body;
    expect(d.runs[0].error).toBe("โควตาทดสอบเต็ม");
    expect(d.case.activeAnalysisId).toBeNull();
  });
  it("validates file signature, review input and current criteria", async () => {
    await agent
      .post("/api/cases")
      .set(headers)
      .set("Idempotency-Key", randomUUID())
      .field("title", "ปลอม")
      .field("allowAi", "true")
      .field("permissionReference", "ทดสอบ")
      .attach("file", Buffer.from("not PDF"), {
        filename: "fake.pdf",
        contentType: "application/pdf",
      })
      .expect(400);
    await agent
      .post(`/api/cases/${caseId}/reviews`)
      .set(headers)
      .set("Idempotency-Key", randomUUID())
      .send({})
      .expect(400);
    await agent
      .post(`/api/cases/${caseId}/retry`)
      .set(headers)
      .send({ revision: 2 })
      .expect(202);
    await processNext(config, analyze);
    const d = (await agent.get(`/api/cases/${caseId}`)).body;
    await IntakeRun.updateOne(
      { _id: d.runs[0]._id },
      { $set: { "criteria.version": "old" } },
    );
    await agent
      .post(`/api/cases/${caseId}/reviews`)
      .set(headers)
      .set("Idempotency-Key", randomUUID())
      .send({
        revision: 2,
        decisionVersion: d.case.decisionVersion,
        analysisId: d.runs[0]._id,
        destination: "TED_POC",
        notes: "ทดสอบ",
        acknowledged: true,
      })
      .expect(409);
  });
  it("shares a durable provider reservation between queued TED runs", async () => {
    await agent
      .post(`/api/cases/${caseId}/retry`)
      .set(headers)
      .send({ revision: 2 })
      .expect(202);
    await ProviderGate.updateOne(
      { _id: "ai" },
      { $set: { nextAt: new Date(Date.now() + 60000) } },
    );
    const before = vi.mocked(analyze).mock.calls.length;
    await processNext(config, analyze);
    expect(vi.mocked(analyze).mock.calls.length).toBe(before);
    const d = (await agent.get(`/api/cases/${caseId}`)).body;
    expect(d.runs[0].status).toBe("queued");
    expect(new Date(d.runs[0].availableAt).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });
});
describe("structured document worker", () => {
  it("bypasses provider for a blank form and upgrades old cached text on retry", async () => {
    const content = await fixture("ted-blank.docx");
    const upload = await agent
      .post("/api/cases")
      .set(headers)
      .set("Idempotency-Key", randomUUID())
      .field("title", "แบบฟอร์มเปล่าทดสอบ")
      .field("permissionReference", "เอกสารทดสอบสร้างเอง")
      .field("allowAi", "true")
      .attach("file", content, {
        filename: "empty.docx",
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      })
      .expect(201);
    await ProviderGate.updateOne(
      { _id: "ai" },
      { $set: { nextAt: new Date(0) } },
    );
    const before = vi.mocked(analyze).mock.calls.length;
    // First drain any prior eligible fixture run without relying on clock order.
    for (let i = 0; i < 4; i++) {
      const c = await IntakeCase.findById(upload.body.id);
      if (!c?.activeAnalysisId) break;
      await processNext(config, analyze);
    }
    let data = (await agent.get(`/api/cases/${upload.body.id}`).expect(200))
      .body;
    expect(data.runs[0].processingMode).toBe("DOCUMENT_CHECK");
    expect(data.runs[0].result.tedAssessment.classification).toBe(
      "INSUFFICIENT_DATA",
    );
    expect(data.runs[0].providerRequestId).toBeNull();
    const callsAfter = vi.mocked(analyze).mock.calls.length;
    await agent
      .post(`/api/cases/${upload.body.id}/reviews`)
      .set(headers)
      .set("Idempotency-Key", randomUUID())
      .send({
        revision: 1,
        decisionVersion: 0,
        analysisId: data.runs[0]._id,
        destination: "TED_POC",
        notes: "ไม่มีคำตอบโครงการ",
        acknowledged: true,
      })
      .expect(409);
    await IntakeCase.updateOne(
      { _id: upload.body.id },
      {
        $set: {
          document: {
            units: [
              {
                id: "OLD",
                locator: "เก่า",
                text: "ข้อความจากตัวอ่านเก่าที่ต้องไม่ถูกนำไปใช้",
                kind: "document",
              },
            ],
            warnings: [],
            pageCount: null,
            extractorVersion: "ted-text-1",
          },
        },
      },
    );
    await agent
      .post(`/api/cases/${upload.body.id}/retry`)
      .set(headers)
      .send({ revision: 1 })
      .expect(202);
    await processNext(config, analyze);
    data = (await agent.get(`/api/cases/${upload.body.id}`)).body;
    expect(data.case.documentInfo.extractorVersion).toBe("ted-structure-2");
    expect(data.runs[0].sources).toEqual([]);
    expect(data.runs[1].processingMode).toBe("DOCUMENT_CHECK");
    expect(vi.mocked(analyze).mock.calls.length).toBe(callsAfter);
  });
});

describe("worker recovery", () => {
  it("reconciles a finished run after interruption before updating the case pointer", async () => {
    const c = await IntakeCase.create({
      organizationId: "recovery",
      title: "fixture",
      fileId: new mongoose.Types.ObjectId(),
      sha256: randomUUID(),
      createKey: randomUUID(),
      createdBy: new mongoose.Types.ObjectId(),
    });
    const run = await IntakeRun.create({
      caseId: c._id,
      organizationId: "recovery",
      revision: 1,
      status: "succeeded",
      criteria: tedCriteria,
    });
    await IntakeCase.updateOne(
      { _id: c._id },
      { $set: { activeAnalysisId: run._id } },
    );
    await processNext(config, analyze);
    const recovered = await IntakeCase.findById(c._id);
    expect(recovered?.activeAnalysisId).toBeNull();
    expect(String(recovered?.latestAnalysisId)).toBe(String(run._id));
  });
  it("fails an abandoned lease without sending another provider request", async () => {
    const c = await IntakeCase.create({
      organizationId: "recovery2",
      title: "fixture",
      fileId: new mongoose.Types.ObjectId(),
      sha256: randomUUID(),
      createKey: randomUUID(),
      createdBy: new mongoose.Types.ObjectId(),
    });
    const run = await IntakeRun.create({
      caseId: c._id,
      organizationId: "recovery2",
      revision: 1,
      status: "analyzing",
      criteria: tedCriteria,
      leaseUntil: new Date(0),
    });
    await IntakeCase.updateOne(
      { _id: c._id },
      { $set: { activeAnalysisId: run._id } },
    );
    const before = vi.mocked(analyze).mock.calls.length;
    await processNext(config, analyze);
    expect(vi.mocked(analyze).mock.calls.length).toBe(before);
    expect((await IntakeRun.findById(run._id))?.status).toBe("failed");
    expect((await IntakeCase.findById(c._id))?.activeAnalysisId).toBeNull();
  });
});

describe("AI boundaries", () => {
  const sources: SourceUnit[] = [
    { id: "P1_1", locator: "หน้า 1", text: "หลักฐาน", kind: "document" },
  ];
  it("rejects hallucinated references, duplicate fields and uncited facts", () => {
    const a = raw(sources);
    a.tedAssessment.evidenceRefs = ["P999_1"];
    expect(() => validateResult(a, sources)).toThrow();
    const b = raw(sources);
    b.fields[1] = b.fields[0]!;
    expect(() => validateResult(b, sources)).toThrow();
    const c = raw(sources);
    c.fields[0]!.value = "ข้อมูลไร้อ้างอิง";
    expect(() => validateResult(c, sources)).toThrow();
  });
  it("limits selected excerpts and preserves officer provenance", () => {
    const units = Array.from({ length: 100 }, (_, i) => ({
      id: `B_${i}`,
      locator: `ส่วน ${i}`,
      text: "เทคโนโลยี ต้นแบบ ตลาด รายได้ ".repeat(20),
      kind: "document" as const,
    }));
    const picked = selectSources(
      { units, warnings: [], pageCount: null, extractorVersion: "test" },
      { funding: "เงินสมทบรอตรวจ" },
    );
    expect(
      picked.sources.reduce((n, s) => n + s.text.length, 0),
    ).toBeLessThanOrEqual(5000);
    expect(picked.coverage.selected).toBeLessThan(100);
    expect(picked.sources.find((s) => s.id === "O_funding")?.kind).toBe(
      "officer",
    );
  });
  it("uses separate database and cookie configuration", () => {
    expect(() =>
      loadConfig({
        MONGODB_URI: "mongodb://localhost/scouting_dev",
        MONGODB_DB_NAME: "scouting_dev",
        JWT_SECRET: "x".repeat(40),
      }),
    ).toThrow(/แยก/);
    expect(
      loadConfig({
        MONGODB_URI: "mongodb://localhost/scouting_dev",
        JWT_SECRET: "x".repeat(40),
      }).dbName,
    ).toBe("ted_intake_dev");
  });
  it("sends one strict-schema request and refuses invalid output without retry", async () => {
    const mock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: { content: JSON.stringify(raw(sources)) },
              },
            ],
          }),
          { status: 200, headers: { "x-request-id": "fixture" } },
        ),
    );
    vi.stubGlobal("fetch", mock);
    try {
      await createAnalyzer({ ...config, aiModel: "openai/gpt-oss-120b" })(
        sources,
        tedCriteria,
      );
      expect(mock).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(mock.mock.calls[0]![1]!.body as string);
      expect(sent.response_format.type).toBe("json_schema");
      expect(sent.messages[0].content).toContain("UNTRUSTED DATA");
      mock.mockResolvedValue(new Response("", { status: 413 }));
      await expect(
        createAnalyzer(config)(sources, tedCriteria),
      ).rejects.toThrow(/ยาว/);
      expect(mock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
