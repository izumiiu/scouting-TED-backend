import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { parseDocument } from "../src/services/document-parser.js";
import { structureDocument } from "../src/services/documents/ted-structure.js";
import { selectSources } from "../src/services/source-selection.js";
import { documentCheckResult } from "../src/services/document-check.js";
import type { RawBlock } from "../src/services/documents/blocks.js";
import { topics, type SourceUnit } from "../src/domain/intake.js";
const fixture = (name: string) =>
  readFile(new URL(`./fixtures/${name}`, import.meta.url));
describe("TED form structure", () => {
  it("does not classify a blank TED form or forward instructions", async () => {
    const doc = await parseDocument(await fixture("ted-blank.docx"), "docx");
    expect(doc.assessment?.templateProgram).toBe("TED_IDEA");
    expect(doc.assessment?.quality).toBe("NO_PROJECT_DATA");
    expect(doc.units).toEqual([]);
    const result = documentCheckResult(doc, []);
    expect(result?.tedAssessment.classification).toBe("INSUFFICIENT_DATA");
    expect(result?.summary).toContain("ยังไม่ได้เรียก AI");
  });
  it("preserves an answer appended to a known heading on the same line", () => {
    const blocks: RawBlock[] = [
      {
        text: "TED Youth Startup Ideation Incentive Program (IDEA)",
        locator: "cover",
      },
      {
        text: "3.5 รายละเอียดของแนวคิดหรือเทคโนโลยีใหม่ที่ใช้ในโครงการ: สร้างเซนเซอร์และทดลองในแปลงแล้วหกสิบวัน มีบันทึกผลให้ตรวจสอบ",
        locator: "answer",
      },
      { text: "4.2 การวางแผนธุรกิจนวัตกรรม (Lean Canvas)", locator: "last" },
    ];
    const doc = structureDocument(blocks, null, []);
    expect(
      doc.units.some(
        (u) =>
          u.text.includes("ทดลองในแปลงแล้วหกสิบวัน") &&
          u.locator.includes("ข้อ 3.5"),
      ),
    ).toBe(true);
  });
  it("keeps applicant responses and excludes identical template instructions", async () => {
    const doc = await parseDocument(await fixture("ted-answered.docx"), "docx");
    expect(doc.assessment?.templateProgram).toBe("TED_IDEA");
    const text = doc.units.map((u) => u.text).join("\n");
    expect(text).toContain("ทดลองในแปลงแล้ว 60 วัน");
    expect(text).not.toContain("อธิบายที่มา");
    expect(
      doc.units.find((u) => u.text.includes("สร้างต้นแบบ"))?.locator,
    ).toContain("ข้อ 3.5");
    const selected = selectSources(doc, {});
    expect(selected.sources.some((s) => s.topics?.includes("technology"))).toBe(
      true,
    );
    const revenue = doc.units.find((u) => u.text.includes("มีแผนคิดค่าสมาชิก"));
    expect(revenue?.context).toContain("Revenue Stream");
    expect(revenue?.topics).toEqual(["revenue"]);
    // Template program is filing metadata; the facts may support a different route.
    expect(doc.assessment?.templateProgram).toBe("TED_IDEA");
    expect(documentCheckResult(doc, selected.sources)).toBeNull();
  });
  it("retains zero and forecast amounts with their exact Word row/year", async () => {
    const doc = await parseDocument(
      await fixture("ted-financial.docx"),
      "docx",
    );
    expect(doc.assessment?.templateProgram).toBe("TED_POC");
    const first = doc.units.find((u) => u.text === "100,000"),
      second = doc.units.find((u) => u.text === "150,000"),
      zero = doc.units.find((u) => u.text === "0");
    expect(first?.context).toContain("ปีที่ 1");
    expect(second?.context).toContain("ปีที่ 2");
    expect(first?.context).toContain("รายได้จากการขาย");
    expect(first?.claimType).toBe("forecast");
    expect(second?.claimType).toBe("forecast");
    expect(zero?.context).toContain("กำไรสุทธิ");
  });
  it("retains PDF forecast rows with a visible warning about approximate columns", async () => {
    const doc = await parseDocument(await fixture("ted-financial.pdf"), "pdf");
    const row = doc.units.find((u) => u.text.includes("100,000"));
    expect(row?.locator).toContain("หน้า 1");
    expect(row?.claimType).toBe("forecast");
    expect(row?.context).toContain("Year 1");
    expect(row?.context).toContain("Year 2");
    expect(doc.warnings.join(" ")).toContain("ประมาณ");
  });
  it("preserves merged column headers when separating owner and fund amounts", async () => {
    const doc = await parseDocument(
      await fixture("ted-financial.docx"),
      "docx",
    );
    const owner = doc.units.find((u) => u.text === "50,000"),
      fund = doc.units.find((u) => u.text === "500,000");
    expect(owner?.context).toContain("ผู้เสนอโครงการ");
    expect(owner?.context).not.toContain("กองทุนฯ");
    expect(fund?.context).toContain("กองทุนฯ");
    expect(fund?.context).not.toContain("ผู้เสนอโครงการ");
  });
  it("does not turn every TRL option or the tick instruction into project evidence", () => {
    const blocks: RawBlock[] = [
      {
        text: "TED Youth Startup Ideation Incentive Program (IDEA)",
        locator: "cover",
      },
      {
        text: "1.7 การประเมินความพร้อมของเทคโนโลยีและธุรกิจนวัตกรรม",
        locator: "heading",
      },
      {
        text: "หมายเหตุ: กรุณากรอกระดับความพร้อมของเทคโนโลยีที่ระดับ 1 – 9 และโปรดทำเครื่องหมาย √ ในตารางประเมินโครงการข้างล่างนี้",
        locator: "hint",
      },
      { text: "□ TRL 7 ทดลองต้นแบบในภาคสนาม", locator: "option" },
      {
        text: "✓ TRL 4 องค์ประกอบสำคัญสาธิตในห้องปฏิบัติการ",
        locator: "selected",
      },
      { text: "4.2 การวางแผนธุรกิจนวัตกรรม (Lean Canvas)", locator: "last" },
    ];
    const doc = structureDocument(blocks, null, []);
    expect(doc.units).toHaveLength(1);
    expect(doc.units[0]?.claimType).toBe("selection_unverified");
    expect(doc.units[0]?.text).toContain("TRL 4");
    expect(doc.units[0]?.text).not.toContain("TRL 7");
  });
  it("reads a reported numeric readiness value without certifying it", () => {
    const doc = structureDocument(
      [
        {
          text: "TED Youth Startup Ideation Incentive Program (IDEA)",
          locator: "cover",
        },
        {
          text: "1.7 การประเมินความพร้อมของเทคโนโลยีและธุรกิจนวัตกรรม",
          locator: "heading",
        },
        {
          text: "4",
          locator: "table",
          table: 1,
          row: 2,
          column: 1,
          columnLabel: "TRL (Technological Readiness Level)",
        },
        { text: "4.2 การวางแผนธุรกิจนวัตกรรม (Lean Canvas)", locator: "last" },
      ],
      null,
      [],
    );
    expect(doc.units[0]?.text).toContain("TRL");
    expect(doc.units[0]?.claimType).toBe("selection_unverified");
  });
  it("keeps a marked schedule month as a plan rather than completed work", () => {
    const doc = structureDocument(
      [
        {
          text: "TED Youth Startup Ideation Incentive Program (IDEA)",
          locator: "cover",
        },
        {
          text: "4.2 การวางแผนธุรกิจนวัตกรรม (Lean Canvas)",
          locator: "canvas",
        },
        { text: "6. แผนการดำเนินงานของโครงการ", locator: "heading" },
        {
          text: "X",
          locator: "table",
          table: 1,
          row: 3,
          column: 4,
          rowLabel: "ทดสอบกับผู้ใช้",
          columnLabel: "เดือนที่ / 3",
        },
      ],
      null,
      [],
    );
    expect(doc.units[0]?.text).toContain("เดือนที่วางแผน: 3");
    expect(doc.units[0]?.claimType).toBe("forecast");
  });
  it("selects more than 14 small answers while covering all nine topics", () => {
    const units: SourceUnit[] = Array.from({ length: 27 }, (_, i) => ({
      id: `S${i}`,
      locator: `ข้อ ${i}`,
      text: `คำตอบจริงสำหรับ ${topics[i % topics.length]} ${i}`,
      kind: "document",
      topics: [topics[i % topics.length]!],
    }));
    const picked = selectSources(
      { units, warnings: [], pageCount: null, extractorVersion: "fixture" },
      {},
    );
    expect(picked.sources.length).toBeGreaterThan(14);
    expect(picked.coverage.topics?.every((t) => t.selected > 0)).toBe(true);
    expect(picked.coverage.selectedChars).toBeLessThanOrEqual(5000);
  });
  it("requires substantial officer information before using AI with a blank form", async () => {
    const doc = await parseDocument(await fixture("ted-blank.docx"), "docx");
    expect(
      documentCheckResult(
        doc,
        selectSources(doc, { technology: "ยังไม่ทราบ" }).sources,
      ),
    ).not.toBeNull();
    expect(
      documentCheckResult(
        doc,
        selectSources(doc, {
          technology:
            "เจ้าหน้าที่ตรวจเอกสารผลทดสอบแล้ว มีต้นแบบเซนเซอร์และการทดลองในโรงเรือนต่อเนื่องสามสิบวัน",
        }).sources,
      ),
    ).toBeNull();
  });
});
