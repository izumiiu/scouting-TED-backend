let workerData: { buffer: Buffer; type: "pdf" | "docx" };
import { readDocx } from "./documents/docx-reader.js";
import { readPdf } from "./documents/pdf-reader.js";
import { structureDocument } from "./documents/ted-structure.js";
async function parse() {
  const buffer = Buffer.from(workerData.buffer);
  const result =
    workerData.type === "docx"
      ? {
          blocks: await readDocx(buffer),
          pageCount: null,
          warnings: [
            "DOCX อ้างอิงตามหัวข้อ ย่อหน้า และตำแหน่งในตาราง ไม่ใช้เลขหน้า · ไม่อ่านข้อความในรูปภาพหรือสีระบายช่องตาราง",
          ],
        }
      : await readPdf(buffer);
  const chars = result.blocks.reduce((n, b) => n + b.text.length, 0);
  if (chars > 150000)
    throw new Error("ข้อความใน DOCX/PDF เกิน 150,000 ตัวอักษร");
  if (chars < 40)
    throw new Error("อ่านตัวหนังสือไม่ได้ ยังไม่รองรับ PDF สแกน/OCR");
  const document = structureDocument(
    result.blocks,
    result.pageCount,
    result.warnings,
  );
  if (document.units.length > 2500)
    throw new Error("DOCX/PDF มีส่วนข้อความเกิน 2,500 ส่วน");
  return document;
}
process.once("message", (data: typeof workerData) => {
  workerData = data;
  parse()
    .then((result) => process.send?.({ result }))
    .catch((error: unknown) =>
      process.send?.({
        error:
          error instanceof Error && /DOCX|PDF|OCR|XML/.test(error.message)
            ? error.message
            : "อ่านไฟล์ไม่ได้ อาจเสียหาย เข้ารหัส หรือเป็นรูปแบบที่ไม่รองรับ",
      }),
    );
});
