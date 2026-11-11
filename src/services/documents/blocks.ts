import { createHash } from "node:crypto";
export interface RawBlock {
  text: string;
  locator: string;
  page?: number;
  table?: number;
  row?: number;
  column?: number;
  rowLabel?: string;
  columnLabel?: string;
  context?: string;
}
export const normalize = (text: string) =>
  text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
export const fingerprint = (text: string) =>
  createHash("sha256")
    .update(
      normalize(
        text
          .replace(/[✓✔☑☒√]/g, " CHECKED ")
          .replace(/[□☐\uF0A3\uF0A0\uF0A8]/g, " UNCHECKED "),
      ),
    )
    .digest("hex");
export function documentFingerprint(blocks: RawBlock[]) {
  return fingerprint(blocks.map((b) => b.text).join(""));
}

export const cellFingerprint = (b: RawBlock) =>
  fingerprint(`${b.rowLabel ?? ""}#${b.columnLabel ?? ""}#${b.text}`);
