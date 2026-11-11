import { describe, it, expect } from "vitest";
import { resultSchema, validateResult } from "../src/services/ai.service.js";
import { topics, type SourceUnit } from "../src/domain/intake.js";
const sources: SourceUnit[] = [{id: "B1", locator: "ย่อหน้า 1", text: "มีแนวคิดต้นแบบ", kind: "document"}];
const result = () => ({
  summary: "ข้อมูลยังไม่พอ",
  fields: topics.map(key => ({key, value: null, evidenceRefs: []})),
  tedAssessment: {
    classification: "INSUFFICIENT_DATA", reason: "ต้องยืนยันต้นแบบ", alternativeReason: "ยังแยกประเภทไม่ได้",
    evidenceRefs: [], uncertainties: ["ข้อมูลขัดกัน"],
    developmentStage: {stage: "UNCLEAR", reason: "ต้องตรวจต้นฉบับ", evidenceRefs: []},
  },
  missingInformation: [{scope: "TED", topic: "สถานะต้นแบบ", question: "ปัจจุบันต้นแบบทำงานได้จริงหรือยัง?", impact: "ยังแยก IDEA และ POC ไม่ได้"}],
});
describe("detailed follow-ups", () => {
  it("requires topic, question and scope-specific impact in the provider schema", () => {
    const schema = resultSchema(sources) as any;
    expect(schema.properties.missingInformation.items.required).toEqual(["scope", "topic", "question", "impact"]);
    expect(schema.properties.missingInformation.items.additionalProperties).toBe(false);
  });
  it("preserves Thai details without certifying funding", () => {
    const r = validateResult(result(), sources);
    expect(r.missingInformation[0]?.topic).toBe("สถานะต้นแบบ");
    expect(r.tedAssessment.fundingReadiness?.status).toBe("NOT_ASSESSED");
  });
  it.each(["topic", "question", "impact"])("rejects missing/blank %s on newly generated output", key => {
    const missing = result();
    delete (missing.missingInformation[0] as any)[key];
    expect(() => validateResult(missing, sources)).toThrow();
    const blank = result();
    (blank.missingInformation[0] as any)[key] = " ";
    expect(() => validateResult(blank, sources)).toThrow();
  });
  it("rejects unknown scopes, extra keys and oversized prose", () => {
    const invalid = result(); invalid.missingInformation[0]!.scope = "UBI";
    expect(() => validateResult(invalid, sources)).toThrow();
    const oversized = result(); oversized.missingInformation[0]!.impact = "ก".repeat(351);
    expect(() => validateResult(oversized, sources)).toThrow();
    const injected = result(); (injected.missingInformation[0] as any).approved = true;
    expect(() => validateResult(injected, sources)).toThrow();
  });
});
