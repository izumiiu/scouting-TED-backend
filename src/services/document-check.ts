import {
  topics,
  topicLabels,
  type ParsedDocument,
  type TedResult,
  type SourceUnit,
} from "../domain/intake.js";
import { tedFundingReadiness } from "../domain/ted-readiness.js";
export function documentCheckResult(
  document: ParsedDocument,
  sources: SourceUnit[],
): TedResult | null {
  if (sources.some((s) => s.kind === "officer" && s.text.trim().length >= 40))
    return null;
  if (document.assessment?.quality !== "NO_PROJECT_DATA") return null;
  return {
    summary:
      "ยังไม่พบคำตอบโครงการที่แยกออกจากแบบฟอร์มต้นแบบได้ ระบบจึงยังไม่ได้เรียก AI เพื่อจำแนก",
    fields: topics.map((key) => ({ key, value: null, evidenceRefs: [] })),
    tedAssessment: {
      classification: "INSUFFICIENT_DATA",
      reason:
        "มีเพียงหัวข้อ คำแนะนำ หรือข้อมูลต้นแบบ จึงยังใช้เป็นหลักฐานประเมินโครงการไม่ได้",
      alternativeReason:
        "การใช้แบบฟอร์ม IDEA หรือ POC ไม่ได้ยืนยันว่าเนื้อหาโครงการเหมาะกับประเภทนั้น",
      evidenceRefs: [],
      uncertainties: [
        "หากกรอกคำตอบแล้ว กรุณาตรวจว่าข้อความอ่านได้และไม่ได้อยู่ในรูปภาพ หรือเติมข้อมูลที่อ่านตกหล่นโดยเจ้าหน้าที่",
      ],
      developmentStage: {
        stage: "UNCLEAR",
        reason: "ยังไม่มีคำตอบเกี่ยวกับสิ่งที่ทำได้จริงในปัจจุบันให้พิจารณา",
        evidenceRefs: [],
      },
      fundingReadiness: tedFundingReadiness("INSUFFICIENT_DATA", "", []),
    },
    missingInformation: [
      {
        scope: "TED",
        question:
          "กรุณาใช้เอกสารที่กรอกข้อมูลโครงการแล้ว หรือเติมข้อมูลโครงการโดยเจ้าหน้าที่ โดยเฉพาะปัญหา เทคโนโลยี/ต้นแบบ และตลาด",
      },
    ],
  };
}
