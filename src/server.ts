import mongoose from "mongoose";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { connectDatabase } from "./config/database.js";
import { startWorker } from "./services/worker.js";
import {
  IntakeCase,
  IntakeRun,
  IntakeReview,
  ProviderGate,
  IntakeEvent,
} from "./models/Intake.js";
import { Staff } from "./models/Staff.js";
import { RateBucket } from "./models/RateBucket.js";
async function main() {
  const config = loadConfig();
  await connectDatabase(config.mongoUri, config.dbName);
  await Promise.all([
    IntakeCase.init(),
    IntakeRun.init(),
    IntakeReview.init(),
    ProviderGate.init(),
    IntakeEvent.init(),
    Staff.init(),
    RateBucket.init(),
  ]);
  const stop = config.workerEnabled ? startWorker(config) : async () => {};
  const server = createApp(config).listen(config.port, () =>
    console.log(`TED Intake listening on http://localhost:${config.port}`),
  );
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    server.close();
    await stop();
    await mongoose.disconnect();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}
main().catch(() => {
  console.error(
    "TED startup failed: ตรวจ backend/.env, MongoDB user/IP และฐานข้อมูล TED แยก",
  );
  process.exitCode = 1;
  void mongoose.disconnect();
});
