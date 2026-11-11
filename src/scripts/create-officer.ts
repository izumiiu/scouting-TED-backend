import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { loadConfig } from "../config/env.js";
import { connectDatabase } from "../config/database.js";
import { Staff } from "../models/Staff.js";
async function main() {
  const c = loadConfig(),
    email = (process.env.OFFICER_EMAIL ?? "").trim().toLowerCase(),
    password = process.env.OFFICER_PASSWORD ?? "",
    name = (process.env.OFFICER_NAME ?? "เจ้าหน้าที่ TED").trim(),
    organizationId = (process.env.ORGANIZATION_ID ?? "ted").trim();
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    password.length < 12 ||
    Buffer.byteLength(password) > 72 ||
    !name ||
    !organizationId
  )
    throw new Error(
      "ตั้ง OFFICER_EMAIL, OFFICER_PASSWORD 12–72 bytes, OFFICER_NAME, ORGANIZATION_ID",
    );
  await connectDatabase(c.mongoUri, c.dbName);
  await Staff.init();
  if (await Staff.exists({ email }))
    throw new Error("มีอีเมลนี้แล้ว ไม่เปลี่ยนรหัสผ่านเดิม");
  await Staff.create({
    email,
    name,
    organizationId,
    passwordHash: await bcrypt.hash(password, 12),
  });
  console.log(
    "สร้างเจ้าหน้าที่ในฐาน TED แล้ว ลบ OFFICER_PASSWORD จาก .env ได้",
  );
}
main()
  .catch((e) => {
    console.error(
      e instanceof Error && /ตั้ง |มีอีเมล/.test(e.message)
        ? e.message
        : "สร้างเจ้าหน้าที่ไม่สำเร็จ ตรวจการเชื่อมต่อฐาน TED",
    );
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
