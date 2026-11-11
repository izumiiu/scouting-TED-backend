import yauzl from "yauzl";
import { DOMParser } from "@xmldom/xmldom";
import type { RawBlock } from "./blocks.js";
const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const elements = (node: Node) =>
  Array.from(node.childNodes).filter((n) => n.nodeType === 1) as Element[];
function visibleText(node: Node): string {
  if (node.nodeType !== 1) return "";
  const e = node as Element;
  if (["del", "moveFrom", "instrText"].includes(e.localName)) return "";
  if (e.namespaceURI === ns && e.localName === "t") return e.textContent ?? "";
  if (e.namespaceURI === ns && e.localName === "tab") return "\t";
  if (e.namespaceURI === ns && ["br", "cr"].includes(e.localName)) return "\n";
  if (e.namespaceURI === ns && e.localName === "sym") {
    const font = e.getAttributeNS(ns, "font"),
      char = e.getAttributeNS(ns, "char");
    if (font === "Wingdings 2" && char === "F0A3") return "□";
    if (font === "Wingdings 2" && char === "F050") return "✓";
    return "";
  }
  return elements(e).map(visibleText).join("");
}
export async function documentXml(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true, autoClose: true },
      (error, zip) => {
        if (error || !zip) {
          reject(new Error("ไฟล์ DOCX ไม่ถูกต้อง"));
          return;
        }
        let entries = 0,
          size = 0,
          xml: string | null = null;
        zip.on("error", reject);
        zip.on("entry", (entry) => {
          size += entry.uncompressedSize;
          entries++;
          if (entries > 5000 || size > 40 * 1024 * 1024) {
            zip.close();
            reject(new Error("ข้อมูลภายใน DOCX เกินกำหนด"));
            return;
          }
          if (entry.fileName !== "word/document.xml") {
            zip.readEntry();
            return;
          }
          if (entry.uncompressedSize > 12 * 1024 * 1024) {
            zip.close();
            reject(new Error("XML ของ DOCX ยาวเกินกำหนด"));
            return;
          }
          zip.openReadStream(entry, (err, stream) => {
            if (err || !stream) {
              zip.close();
              reject(new Error("อ่าน DOCX ไม่ได้"));
              return;
            }
            const chunks: Buffer[] = [];
            let read = 0;
            stream.on("data", (chunk) => {
              read += chunk.length;
              if (read > 12 * 1024 * 1024) {
                stream.destroy(new Error("DOCX XML เกินกำหนด"));
                return;
              }
              chunks.push(Buffer.from(chunk));
            });
            stream.on("error", reject);
            stream.on("end", () => {
              xml = Buffer.concat(chunks).toString("utf8");
              zip.readEntry();
            });
          });
        });
        zip.on("end", () =>
          xml ? resolve(xml) : reject(new Error("ไม่พบข้อความใน DOCX")),
        );
        zip.readEntry();
      },
    );
  });
}
export async function readDocx(buffer: Buffer): Promise<RawBlock[]> {
  const xml = await documentXml(buffer);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("DOCX มี XML ที่ไม่รองรับ");
  const fail = () => {
    throw new Error("XML ของ DOCX ไม่ถูกต้อง");
  };
  const doc = new DOMParser({
    errorHandler: { warning: () => {}, error: fail, fatalError: fail },
  }).parseFromString(xml, "application/xml");
  const body = doc.getElementsByTagNameNS(ns, "body")[0];
  if (!body) throw new Error("ไม่พบเนื้อหา DOCX");
  const blocks: RawBlock[] = [];
  let paragraph = 0,
    table = 0;
  for (const node of elements(body)) {
    if (node.localName === "p") {
      paragraph++;
      const text = visibleText(node).trim();
      if (text) blocks.push({ text, locator: `ย่อหน้า ${paragraph}` });
    } else if (node.localName === "tbl") {
      table++;
      const rows = elements(node).filter((e) => e.localName === "tr");
      const matrix = rows.map((row) => {
        let column = 1;
        return elements(row)
          .filter((e) => e.localName === "tc")
          .map((cell) => {
            const spanNode = cell.getElementsByTagNameNS(ns, "gridSpan")[0];
            const span = Math.max(
              1,
              Math.min(
                30,
                Number(spanNode?.getAttributeNS(ns, "val") ?? 1) || 1,
              ),
            );
            const result = {
              text: Array.from(cell.getElementsByTagNameNS(ns, "p"))
                .map(visibleText)
                .join("\n")
                .trim(),
              column,
              span,
            };
            column += span;
            return result;
          });
      });
      const headerRows = matrix.slice(
        0,
        matrix[0]?.some((c) => c.span > 1) ? 2 : 1,
      );
      for (let ri = 0; ri < matrix.length; ri++) {
        const row = matrix[ri]!;
        const rowLabel =
          row[0]?.text.split(/\n/)[0]?.trim().slice(0, 180) ?? "";
        for (const cell of row) {
          const { text, column } = cell;
          if (!text) continue;
          const columnLabel =
            column > 1
              ? headerRows
                  .flatMap((r) =>
                    r
                      .filter(
                        (c) => c.column <= column && column < c.column + c.span,
                      )
                      .map((c) => c.text),
                  )
                  .filter((v) => v && v.length < 100)
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .join(" / ")
              : "";
          blocks.push({
            text,
            locator: `ตาราง ${table} แถว ${ri + 1} คอลัมน์ ${column}`,
            table,
            row: ri + 1,
            column,
            rowLabel,
            columnLabel,
          });
        }
      }
    }
    // A content control can contain paragraphs/tables. TOCs are intentionally not
    // used as applicant evidence; no field instructions are executed or evaluated.
  }
  return blocks;
}
