import "dotenv/config";
export interface Config {
  port: number;
  origin: string;
  mongoUri: string;
  dbName: string;
  jwtSecret: string;
  production: boolean;
  trustProxyHops: number;
  aiProvider: "groq" | "openai";
  aiKey: string;
  aiModel: string;
  workerEnabled: boolean;
  providerIntervalMs: number;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 4100),
    origin = new URL(env.APP_ORIGIN ?? "http://localhost:5174");
  const dbName = env.MONGODB_DB_NAME ?? "ted_intake_dev",
    jwtSecret = env.JWT_SECRET ?? "",
    mongoUri = env.MONGODB_URI ?? "";
  const aiProvider = env.AI_PROVIDER ?? "groq",
    production = env.NODE_ENV === "production",
    trustProxyHops = Number(env.TRUST_PROXY_HOPS ?? 0),
    providerIntervalMs = Number(env.AI_REQUEST_INTERVAL_MS ?? 65000);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !["http:", "https:"].includes(origin.protocol) ||
    (production && origin.protocol !== "https:")
  )
    throw new Error("ตรวจ PORT / APP_ORIGIN (production ต้อง HTTPS)");
  if (
    !/^[a-zA-Z0-9_-]+$/.test(dbName) ||
    ["scouting_dev", "admin", "local", "config"].includes(dbName)
  )
    throw new Error("ตั้ง MONGODB_DB_NAME แยกสำหรับ TED");
  if (!/^mongodb(\+srv)?:\/\//.test(mongoUri) || jwtSecret.length < 32)
    throw new Error(
      "ตั้ง MONGODB_URI และ JWT_SECRET อย่างน้อย 32 ตัวอักษรใน backend/.env",
    );
  if (
    !["groq", "openai"].includes(aiProvider) ||
    !Number.isInteger(trustProxyHops) ||
    trustProxyHops < 0 ||
    trustProxyHops > 5 ||
    !Number.isInteger(providerIntervalMs) ||
    providerIntervalMs < 0 ||
    providerIntervalMs > 86400000
  )
    throw new Error(
      "ตรวจ AI_PROVIDER / TRUST_PROXY_HOPS / AI_REQUEST_INTERVAL_MS",
    );
  return {
    port,
    origin: origin.origin,
    mongoUri,
    dbName,
    jwtSecret,
    production,
    trustProxyHops,
    aiProvider: aiProvider as Config["aiProvider"],
    aiKey:
      (aiProvider === "groq" ? env.GROQ_API_KEY : env.OPENAI_API_KEY)?.trim() ??
      "",
    aiModel:
      (aiProvider === "groq" ? env.GROQ_MODEL : env.OPENAI_MODEL)?.trim() ?? "",
    workerEnabled: env.ENABLE_WORKER !== "false",
    providerIntervalMs,
  };
}
