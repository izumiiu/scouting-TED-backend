import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ParsedDocument } from "../domain/intake.js";
import { AppError } from "../utils/errors.js";
// Separate process: malformed parsers and native PDF libraries must not crash
// the API process. Never inherit test-runner/--input-type flags into the child.
export async function parseDocument(
  buffer: Buffer,
  type: "pdf" | "docx",
): Promise<ParsedDocument> {
  return new Promise((resolve, reject) => {
    const url = new URL(
      import.meta.url.endsWith(".ts")
        ? "../../dist/services/document-parser.worker.js"
        : "./document-parser.worker.js",
      import.meta.url,
    );
    const child = fork(fileURLToPath(url), [], {
      execArgv: ["--max-old-space-size=192"],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      serialization: "advanced",
      windowsHide: true,
    });
    let settled = false;
    const finish = (error?: string, result?: ParsedDocument) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(new AppError(422, "DOCUMENT_UNREADABLE", error));
      else if (result) resolve(result);
    };
    const timer = setTimeout(
      () => finish("อ่านไฟล์เกินเวลาที่กำหนด กรุณาลดขนาดเอกสาร"),
      25000,
    );
    child.once(
      "message",
      (message: { result?: ParsedDocument; error?: string }) =>
        finish(message.error, message.result),
    );
    child.once("error", () =>
      finish("เปิดตัวอ่านเอกสารไม่ได้ กรุณาตรวจการติดตั้ง"),
    );
    child.once("exit", () => {
      if (!settled)
        finish(
          "ตัวอ่านเอกสารหยุดทำงาน ไฟล์อาจเสียหายหรือใช้ทรัพยากรมากเกินกำหนด",
        );
    });
    child.send({ buffer, type }, (error) => {
      if (error) finish("ส่งเอกสารให้ตัวอ่านไม่ได้");
    });
  });
}
