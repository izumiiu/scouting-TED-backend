import 'dotenv/config';
export function loadConfig() {
  const port = Number(process.env.PORT ?? 4100);
  const origin = process.env.APP_ORIGIN ?? 'http://localhost:5174';
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT ไม่ถูกต้อง');
  const parsed = new URL(origin);
  if (!['http:', 'https:'].includes(parsed.protocol))
    throw new Error('APP_ORIGIN ไม่ถูกต้อง');
  return { port, origin: parsed.origin };
}
