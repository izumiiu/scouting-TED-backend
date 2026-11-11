import { AppError } from "../utils/errors.js";
export const invalid = (message: string) =>
  new AppError(400, "INVALID_INPUT", message);
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid("รูปแบบข้อมูลไม่ถูกต้อง");
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string, max = 2000): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > max)
    throw invalid(`${label}ไม่ถูกต้องหรือยาวเกินกำหนด`);
  return value.trim();
}
export function id(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f\d]{24}$/i.test(value))
    throw invalid("รหัสรายการไม่ถูกต้อง");
  return value;
}
export function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw invalid("รุ่นข้อมูลไม่ถูกต้อง");
  return value;
}
export function key(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9-]{36}$/i.test(value))
    throw invalid("ต้องมี Idempotency-Key");
  return value;
}
