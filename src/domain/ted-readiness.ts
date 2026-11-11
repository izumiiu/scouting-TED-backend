import type { TedAssessment, TedFundingReadiness } from "./types.js";
export function tedFundingReadiness(
  classification: TedAssessment["classification"],
  funding: string,
  evidenceRefs: string[],
): TedFundingReadiness {
  if (classification !== "TED_POC")
    return {
      status: "NOT_ASSESSED",
      evidenceRefs: [],
      reason:
        classification === "TED_IDEA"
          ? "เงินสมทบอย่างน้อย 10% เป็นเงื่อนไข POC จึงยังไม่ตรวจในผลที่แนะนำ IDEA"
          : "ยังแยก IDEA/POC ไม่ได้ จึงยังไม่ประเมินเงื่อนไขเงินสมทบ POC",
    };
  return {
    status: "NEEDS_VERIFICATION",
    evidenceRefs: funding ? evidenceRefs : [],
    reason: `${funding ? `ข้อมูลที่รายงานเรื่องเงินทุน: “${funding}” ` : "ยังไม่พบข้อมูลเรื่องเงินสมทบในข้อความที่นำมาวิเคราะห์ "}ยังไม่รับรองว่ามีเงินสมทบเองอย่างน้อย 10% เจ้าหน้าที่ต้องตรวจจำนวนเงิน ฐานคำนวณ และหลักฐานตามเงื่อนไขทุน การรอตรวจนี้ไม่เปลี่ยนประเภท POC เป็น IDEA`,
  };
}
