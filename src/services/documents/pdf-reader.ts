import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { RawBlock } from "./blocks.js";
interface Span {
  text: string;
  x: number;
  y: number;
  width: number;
}
export async function readPdf(
  buffer: Buffer,
): Promise<{ blocks: RawBlock[]; pageCount: number; warnings: string[] }> {
  const task = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  const blocks: RawBlock[] = [],
    warnings = [
      "PDF อ่านตามตำแหน่งข้อความบนหน้า การจัดคอลัมน์เป็นการประมาณ ต้องตรวจตารางและช่องเลือกกับต้นฉบับ · ไม่รองรับ OCR หรืออ่านข้อความในรูปภาพ",
    ];
  try {
    if (doc.numPages > 100) throw new Error("PDF เกิน 100 หน้า");
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum),
        content = await page.getTextContent();
      const spans: Span[] = content.items
        .filter(
          (
            i,
          ): i is typeof i & {
            str: string;
            transform: number[];
            width: number;
          } => "str" in i,
        )
        .map((i) => ({
          text: i.str,
          x: i.transform[4] ?? 0,
          y: i.transform[5] ?? 0,
          width: i.width,
        }))
        .filter((i) => i.text.trim());
      spans.sort((a, b) => b.y - a.y || a.x - b.x);
      const lines: Span[][] = [];
      for (const span of spans) {
        let line = lines.find((l) => Math.abs(l[0]!.y - span.y) <= 2.5);
        if (!line) {
          line = [];
          lines.push(line);
        }
        line.push(span);
      }
      let headers: { label: string; center: number }[] = [];
      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum]!.sort((a, b) => a.x - b.x);
        const cells: { text: string; x: number; end: number }[] = [];
        for (const span of line) {
          const prev = cells.at(-1);
          if (prev && span.x - prev.end < 12) {
            prev.text += (span.x - prev.end > 2 ? " " : "") + span.text;
            prev.end = Math.max(prev.end, span.x + span.width);
          } else
            cells.push({
              text: span.text,
              x: span.x,
              end: span.x + span.width,
            });
        }
        const text = cells.map((c) => c.text.trim()).join(" | ");
        // Keep column labels with values. Never assert that this geometric grouping
        // proves a table value; that limitation is visible in the UI and AI prompt.
        if (
          cells.length >= 3 &&
          /ปีที่|Year\s*\d|แหล่งที่มาของเงินทุน|ผู้เสนอโครงการ|กองทุน|เดือนที่/.test(
            text,
          )
        ) {
          headers = cells.map((c) => ({
            label: c.text.trim(),
            center: (c.x + c.end) / 2,
          }));
        }
        let context = "";
        if (
          headers.length &&
          cells.length > 1 &&
          !/ปีที่|Year\s*\d|ผู้เสนอโครงการ|กองทุน|เดือนที่/.test(text)
        ) {
          context =
            "คอลัมน์ PDF โดยประมาณ: " +
            cells
              .map((c) => {
                const center = (c.x + c.end) / 2;
                const h = [...headers].sort(
                  (a, b) =>
                    Math.abs(a.center - center) - Math.abs(b.center - center),
                )[0]!;
                return `${h.label}: ${c.text.trim()}`;
              })
              .join(" | ");
        }
        blocks.push({
          text,
          locator: `หน้า ${pageNum} บรรทัด ${lineNum + 1}`,
          page: pageNum,
          ...(context ? { context } : {}),
        });
      }
      if (spans.reduce((n, s) => n + s.text.length, 0) < 10)
        warnings.push(`หน้า ${pageNum} มีข้อความน้อย อาจเป็นภาพหรือหน้าว่าง`);
      page.cleanup();
    }
    return { blocks, pageCount: doc.numPages, warnings };
  } finally {
    await doc.destroy();
  }
}
