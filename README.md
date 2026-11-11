# TED Intake backend

Express + TypeScript + MongoDB Atlas + Groq ระบบ TED แยกจาก Scouting เดิม

## ตั้งค่าในเครื่อง

ใช้ Node 24.x / npm 11.x แล้วรันคำสั่งในโฟลเดอร์ backend

1. `npm ci`
2. ใช้ `.env.example` เป็นแบบสำหรับ `.env` (เครื่องที่พัฒนานี้เตรียม `.env` ว่างพร้อม JWT_SECRET ใหม่ให้แล้ว)
3. ตั้งค่า `MONGODB_URI` เป็น connection string ของ Atlas และ `MONGODB_DB_NAME=ted_intake_dev`
4. สร้าง/ใช้ database user ที่มี `readWrite` เฉพาะฐาน TED และอนุญาต IP ของเครื่องใน Atlas; รหัสผ่าน URI ต้อง percent-encode ถ้ามีอักขระพิเศษ
5. ใส่ `GROQ_API_KEY` ในเครื่อง และตั้ง `GROQ_MODEL` เป็นโมเดลที่บัญชีเข้าถึงและรองรับ strict JSON schema เช่นค่าที่เตรียมในตัวอย่าง ตรวจสิทธิ์/โควตาใน Groq ของตนเอง
6. ตั้ง `OFFICER_EMAIL`, `OFFICER_PASSWORD` (อย่างน้อย 12 ตัวอักษร ไม่เกิน 72 bytes), `OFFICER_NAME`, `ORGANIZATION_ID`
7. `npm run build` แล้ว `npm run create-officer` เพื่อสร้างบัญชีในฐาน TED จากนั้นลบค่า `OFFICER_PASSWORD` ออกจาก `.env`
8. `npm run dev` เปิด API ที่ http://localhost:4100 และ health ที่ http://localhost:4100/healthz

เครื่องอื่นให้สร้าง JWT_SECRET ใหม่ด้วย `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"` และเก็บไว้ใน `.env` ของ backend เท่านั้น

อย่าใส่ key / URI / JWT_SECRET ใน frontend, Git, ภาพหน้าจอ หรือแชต `.gitignore` ยกเว้นเฉพาะ `.env.example` ที่ไม่มีความลับ

`dbName` จากตัวแปร MONGODB_DB_NAME จะทับชื่อฐานที่อยู่ใน URI และระบบบล็อกชื่อ scouting_dev/admin/local/config ตั้งใจแยกข้อมูลและบัญชีของ TED จากระบบเดิม ไม่ได้ย้ายข้อมูลเก่ามา

## เส้นทางทำงาน

รับไฟล์ → เก็บต้นฉบับใน GridFS + สร้างคิวใน transaction → อ่านหัวข้อ/ตารางใน process ต่างหาก → แยกคำแนะนำจากคำตอบ → เลือกคำตอบให้ครอบคลุมหัวข้อ → เรียก AI หนึ่งครั้ง → ตรวจ JSON/แหล่งอ้างอิง → เก็บผลและรอเจ้าหน้าที่

- PDF ที่เลือกข้อความได้ / DOCX ครั้งละไฟล์ ไม่เกิน 20 MB; PDF ไม่เกิน 100 หน้า; ข้อความไม่เกิน 150,000 ตัวอักษร / 2,500 ส่วน
- ตัวอ่านมี timeout 25 วินาทีและ V8 heap limit 192 MB ตรวจขนาด ZIP ภายใน DOCX ก่อนอ่าน ไม่มีการรัน macro หรือแปลงเป็น HTML
- ไม่มี OCR/การอ่านภาพ ตารางซับซ้อนหรือส่วนหัวท้ายอาจอ่านได้ไม่ครบ เจ้าหน้าที่ต้องเทียบต้นฉบับ
- ตัดข้อความเป็นส่วนละไม่เกิน 600 ตัวอักษร แล้วค้นด้วยคำสำคัญไทย/อังกฤษ 9 หัวข้อ ใช้ข้อความและข้อมูลเพิ่มเติมรวมไม่เกิน 5,000 ตัวอักษร เลือกคำตอบสลับตามหัวข้อ แทนการหยุดที่ 14 ส่วนสั้น ๆ; จำกัดไม่เกิน 40 ส่วนเอกสาร และขนาด JSON แหล่งข้อมูลไม่เกินประมาณ 7,000 ตัวอักษร ร่วมกับข้อมูลเจ้าหน้าที่
- เอกสารยาว **ไม่ได้ส่งทั้งหมดไปให้ AI** หน้าเว็บแสดงจำนวนส่วน/ตัวอักษรที่ใช้และข้อความจริง ไม่พบในข้อความที่เลือกไม่ได้แปลว่าเอกสารไม่มีข้อมูลนั้น
- คำขอส่งเฉพาะแหล่งข้อความที่เลือก + เกณฑ์ TED ฉบับย่อ + schema/prompt ไม่ส่งไฟล์ binary, รหัสผ่าน, URI หรือข้อมูลบัญชีเจ้าหน้าที่ไปให้ AI
- จำกัดความยาวด้วยจำนวนตัวอักษร ไม่ใช่ตัวนับ token ที่ตรงกับ provider จึงยังเกิด 413/429 ได้ตามขนาดและโควตาบัญชี ยังไม่ได้รับรองว่าไฟล์ทุกชนิดจะพอดี 8K TPM
- ตั้งระยะห่างคำขอด้วย `AI_REQUEST_INTERVAL_MS=65000` ร่วมกันในฐาน TED; ระบบ Scouting หรือแอปอื่นที่ใช้บัญชี Groq เดียวกันยังแย่งโควตาได้
- AI timeout 60 วินาที ไม่มี retry อัตโนมัติเมื่อ provider ปฏิเสธ/ส่งรูปแบบผิด ใช้ปุ่มลองใหม่หลังตรวจสาเหตุ ป้องกันเรียกซ้ำและค่าใช้จ่ายซ้ำ

## ตัวอ่านแบบฟอร์ม TED V2027

- แนะนำ DOCX จาก Word เป็นรูปแบบหลัก: อ่าน OOXML โดยตรงและเก็บหัวข้อ แถว คอลัมน์ รวมถึงหัวคอลัมน์ที่ merge; ไม่ใช้การดึงข้อความแบนแบบเดิม
- PDF ต้องเลือกข้อความได้: อ่านข้อความตามตำแหน่งบนหน้า เก็บบรรทัดและหัวข้อ คอลัมน์ใน PDF เป็นการประมาณและมีคำเตือนให้ตรวจต้นฉบับ
- ไม่อ่านภาพ สแกน หรือสีระบายช่องตารางเป็นข้อมูล หาก timeline ใช้เพียงสีหรือรูปให้เจ้าหน้าที่เติมเดือน/กิจกรรมเป็นข้อความ
- แยกคำแนะนำ ตัวอย่าง และค่าเดิมของแบบฟอร์มด้วย fingerprint จากแบบ IDEA/POC V2027 ทั้ง Word/PDF ที่ผู้ใช้ให้ เก็บเฉพาะ hash ใน `src/domain/template-reference.ts` ไม่มีไฟล์ต้นฉบับหรือข้อมูลติดต่อของผู้ประสานงานอยู่ใน reference นี้
- การกรองเป็นการเปรียบเทียบต้นแบบและกฎข้อความ ไม่ใช่การรับรองว่าจะแยกคำแนะนำทุกรูปแบบได้ หากแก้รูปแบบมากต้องตรวจผลและเติมข้อมูลที่ตกหล่น
- แบบฟอร์มเปล่าหรือยังไม่พบคำตอบจะแสดงผลตรวจเอกสารในระบบ (`DOCUMENT_CHECK`) ว่าข้อมูลไม่พอ โดยไม่เรียก Groq/ไม่ใช้โควตา AI และยังยืนยันประเภทโครงการไม่ได้
- เติมข้อมูลเจ้าหน้าที่ที่มีสาระแล้วบันทึกเพื่อวิเคราะห์ใหม่ได้ ทุกข้อมูลยังคงแยกแหล่งจากเอกสาร
- `templateProgram` คือแบบฟอร์มที่ตรวจพบ แยกจากประเภทที่ AI แนะนำเสมอ ไม่ใช้ชื่อแบบฟอร์มเป็นหลักฐานความเหมาะสม
- ประมาณการรายได้ แผนงบประมาณ และเดือนดำเนินงานติดป้ายเป็นแผน/ประมาณการ ไม่ใช่รายได้จริงหรือผลที่ทำเสร็จแล้ว
- ระดับ TRL หรือช่องที่ทำเครื่องหมายเป็นค่าที่ผู้สมัครรายงาน ยังต้องตรวจหลักฐานการทำงานจริง ไม่มีการนำ TRL มาเป็นกฎตัดสิทธิ์ TED
- ลิงก์อ้างอิงแสดงข้อ/ย่อหน้า/ตาราง-แถว-คอลัมน์สำหรับ Word หรือข้อ/หน้า-บรรทัดสำหรับ PDF พร้อมความครอบคลุมรายหัวข้อ
- กดวิเคราะห์ใหม่ในเคสเดิมเพื่ออ่านไฟล์ต้นฉบับซ้ำเมื่อ cache เป็นตัวอ่านรุ่นก่อน ผลรอบเก่าคงอยู่ และต้องใช้ผลจาก prompt รุ่นปัจจุบันก่อนยืนยัน

หากต้องปรับชุด reference: `npm run build` แล้ว `node scripts/generate-template-reference.mjs "โฟลเดอร์ที่มีแบบฟอร์มต้นฉบับทั้งสี่"` จากนั้น build ใหม่ เครื่องมืออ่านไฟล์ในเครื่องเท่านั้น ไม่ต่อ Atlas/AI เมื่อเปลี่ยนพฤติกรรมตัวอ่านหรือชุด template ต้องเพิ่ม extractorVersion และ promptVersion เพื่อไม่ใช้ cache/ผลเก่าแทนวิธีใหม่

## การพิจารณาและหลักฐาน

เกณฑ์ TED เดิมที่ผู้ใช้ยืนยัน ใช้วิเคราะห์เชิงคุณภาพ IDEA/POC/ข้อมูลไม่พอ ไม่มีคะแนน ไม่มีเกณฑ์ UBI/TBI หรือคุณสมบัติ TED เดิมมาปน

- เหตุผลและข้อมูลที่สกัดต้องอ้างรหัสส่วนข้อความที่ส่งไปจริง Server ปฏิเสธรหัสที่ AI แต่งขึ้น แต่ไม่สามารถรับรองความถูกต้องเชิงความหมายได้ทั้งหมด
- PDF อ้างหน้าและส่วนข้อความ; DOCX อ้างส่วนข้อความ ไม่อ้างเลขหน้าที่ขึ้นกับการจัดหน้า
- บันทึกเพิ่มเติมเจ้าหน้าที่มีแหล่งแยก `O_...` ไม่แก้ข้อความต้นฉบับ และมีประวัติผู้บันทึก
- เงินสมทบ POC >=10% แยกจากการจำแนกและแสดงรอตรวจ ไม่ให้ AI รับรองสิทธิ์ทุน
- เจ้าหน้าที่เลือกต่างจาก AI ได้ ต้องกรอกเหตุผลและยืนยันว่าตรวจแล้ว การยืนยันนี้ไม่ใช่อนุมัติทุน/ส่งอีเมล/ส่ง PM
- แก้ข้อมูลแล้วเพิ่ม revision และเข้าคิววิเคราะห์ใหม่อัตโนมัติ ผลยืนยันเก่ายังคงเป็นประวัติ แต่ใช้แทนผลปัจจุบันไม่ได้
- ยืนยันได้เฉพาะผลสำเร็จของข้อมูล เกณฑ์ และ prompt รุ่นปัจจุบัน ไม่มีงานค้าง และ decisionVersion ตรงกัน ป้องกันเจ้าหน้าที่สองหน้าต่างเขียนทับกัน
- บันทึกต้นฉบับ SHA-256, สิทธิ์ประมวลผล, ผลแต่ละรอบ, snapshot เกณฑ์/prompt/model, ข้อความที่ส่งจริง, เหตุผลเจ้าหน้าที่ และเวลา
- อัปโหลดไฟล์เดิมในหน่วยงานเดียวกันจะเปิดโครงการเดิม ไม่สร้างงาน AI ซ้ำ

## โครงสร้าง

- `src/routes` เส้นทางและ middleware
- `src/controllers` รับ request/ส่ง response
- `src/services/intake.service.ts` กฎข้อมูลและ transaction
- `src/services/document-parser*` และ `src/services/documents` การอ่านเอกสารใน process แยกและการจัดโครงสร้างแบบฟอร์ม
- `src/services/source-selection.ts` เลือกข้อความและระบุ coverage
- `src/services/ai.service.ts` prompt/schema/provider/ตรวจ output
- `src/services/worker.ts` คิว/lease/โควตา/กู้สถานะหลัง restart
- `src/models` Staff, case, analysis run, review, event, rate limit, provider gate
- `src/domain/ted-criteria.ts` เกณฑ์ไทย; `ted-ai-reference.ts` ฉบับที่ส่งให้ AI ต้องแก้คู่กันและเปลี่ยน version
- `src/domain/ted-readiness.ts` แยกการแจ้งรอตรวจเงินสมทบ

## API

ทุก endpoint ยกเว้น login/health ต้องมี session cookie ของ TED; ทุก mutation ต้องมี X-Requested-With: TedIntake และ Origin ที่ตรง APP_ORIGIN

| Method | Path | หน้าที่ |
|---|---|---|
| POST | /api/auth/login | เข้าสู่ระบบ |
| GET / POST | /api/auth/me / /api/auth/logout | ตรวจ session / ออกจากระบบ |
| GET | /api/catalog | เกณฑ์และสถานะการตั้งค่า AI |
| GET / POST | /api/cases | รายการ 100 ล่าสุด / รับไฟล์ multipart และเริ่มคิว |
| GET | /api/cases/:id | รายละเอียด 10 ผลวิเคราะห์ + 10 ผลยืนยัน + 30 events ล่าสุด |
| GET | /api/cases/:id/file | ดาวน์โหลดต้นฉบับเฉพาะหน่วยงาน |
| PUT | /api/cases/:id/overrides | บันทึกเพิ่มเติมและวิเคราะห์อัตโนมัติ |
| POST | /api/cases/:id/retry | เริ่มวิเคราะห์รอบใหม่ |
| POST | /api/cases/:id/reviews | บันทึกผลพิจารณาเจ้าหน้าที่ |

Upload/review ใช้ Idempotency-Key แบบ UUID; การ retry/แก้ข้อมูลมีการตรวจ revision และ active run

## ตรวจงาน

`npm test` build แล้วทดสอบด้วย MongoDB replica set ชั่วคราวในเครื่องและ AI fixture ไม่ต่อ Atlas หรือ Groq จริง (ครั้งแรกอาจดาวน์โหลด MongoDB binary)

ครอบคลุม DOCX/PDF/ไฟล์อ่านไม่ได้, login/Origin, อัปโหลดซ้ำ, สิทธิ์ต่างหน่วยงาน, worker แข่งกัน, download bytes, review ซ้ำ/ข้อมูลเก่า, เปลี่ยน revision, provider error และ schema/หลักฐานผิด

## ก่อน deploy

Node Web Service บน Render: build `npm ci --include=dev && npm run build`, start `npm start`, health `/healthz`, NODE_ENV=production, APP_ORIGIN เป็นโดเมน frontend ใหม่, TRUST_PROXY_HOPS ตาม proxy ที่ใช้ (Render เริ่มตรวจที่ 1) และค่าฐาน TED/Groq/JWT ใหม่จากเครื่อง

Frontend ใช้ proxy /api ผ่าน Vercel เพื่อให้ session เป็น same-origin ดู README frontend อย่าใส่ URL backend ของ Scouting เดิม

Production ควรแยกชื่อฐาน TED เพิ่มจาก dev, สร้างบัญชีเจ้าหน้าที่ในฐานนั้นเอง, มี backup/การกำหนดอายุข้อมูล และติดตามขนาด GridFS ซึ่งใช้พื้นที่ Atlas ร่วมกับข้อมูลอื่น เก็บต้นฉบับในฐานจึงยังอยู่หลัง Render restart ไม่อาศัยดิสก์ชั่วคราว

Worker อยู่ process เดียวกับ Web Service หากโฮสต์หยุด/หลับ งานจะรอจนบริการทำงานอีกครั้ง คิวเก็บใน MongoDB และงานที่หยุดกลางทางต้องให้เจ้าหน้าที่ลองใหม่ ไม่รับรองการทำงานเบื้องหลังตลอดเวลาในแผน free ที่มี sleep

รุ่นนี้เหมาะกับการทดลองในทีมขนาดเล็ก ก่อนใช้จริงวงกว้างต้องเพิ่ม pagination/การจัดการผู้ใช้/backup-retention/ประเมินคุณภาพด้วยเอกสารที่ผู้เชี่ยวชาญตรวจแล้ว และพิจารณาแยก worker/storage ตามปริมาณงาน

## Detailed analysis follow-ups (ted-document-3)

New analyses include a Thai topic, a specific question, and the scope-specific effect on assessment. Historical results remain readable without inventing missing explanations; analyze again to obtain the new details. No score, eligibility gate, or grant approval is added.

Reading/selection coverage is distinct from missing project evidence. A topic not selected for AI or not extracted does not prove absence from the original document. Contribution verification remains separate from IDEA/POC classification.

`npm test` uses one Vitest thread worker to avoid native fork-worker crashes observed on Windows. Tests use an isolated in-memory MongoDB and mocked AI.
