import { templateReference } from "../../domain/template-reference.js";
import {
  topics,
  topicLabels,
  type ParsedDocument,
  type SourceUnit,
  type Topic,
} from "../../domain/intake.js";
import { extractorVersion } from "../../domain/document-version.js";
import {
  normalize,
  fingerprint,
  documentFingerprint,
  cellFingerprint,
  type RawBlock,
} from "./blocks.js";
const known = new Set(templateReference.fingerprints),
  documents = new Set(templateReference.documentFingerprints),
  defaults = new Set(templateReference.defaultCells ?? []);
interface Section {
  id: string;
  label: string;
  topics: Topic[];
  ignore?: boolean;
  forecast?: boolean;
}
const definitions: {
  id: string;
  pattern: RegExp;
  topics: Topic[];
  ignore?: boolean;
}[] = [
  {
    id: "1.1",
    pattern: /ชื่อโครงการ.*projectname|ชื่อโครงการภาษาไทย/,
    topics: [],
  },
  {
    id: "1.2",
    pattern: /วัตถุประสงค์ของโครงการ/,
    topics: ["plan", "solution"],
  },
  {
    id: "1.3",
    pattern: /ภาพรวมโครงการ|projectoverview/,
    topics: ["problem", "solution"],
  },
  {
    id: "1.4",
    pattern: /ประเภทอุตสาหกรรม|typesofindustry/,
    topics: ["market"],
  },
  { id: "1.5", pattern: /ธุรกิจอยู่ในbcg/, topics: ["market"] },
  {
    id: "1.6",
    pattern: /^ประวัติของโครงการ$|^16ประวัติของโครงการ/,
    topics: ["technology"],
  },
  {
    id: "1.7",
    pattern: /การประเมินความพร้อมของเทคโนโลยี/,
    topics: ["technology"],
  },
  { id: "2.1", pattern: /ผู้เสนอโครงการสมาชิกทีม/, topics: ["team"] },
  {
    id: "2.2",
    pattern: /ที่ปรึกษาโครงการถ้ามี|^22ที่ปรึกษาโครงการ/,
    topics: ["team"],
  },
  {
    id: "2.3",
    pattern: /เครือข่ายร่วมพัฒนาผู้ประกอบการtedfellow/,
    topics: [],
    ignore: true,
  },
  { id: "3.1", pattern: /ระดับความเป็นนวัตกรรม/, topics: ["technology"] },
  { id: "3.2", pattern: /ลักษณะความเป็นนวัตกรรม/, topics: ["technology"] },
  {
    id: "3.3",
    pattern: /รายละเอียดความเป็นนวัตกรรม|สรุปความเป็นนวัตกรรม/,
    topics: ["technology", "solution"],
  },
  {
    id: "3.4",
    pattern: /ความแตกต่างระหว่างสิ่งที่มีอยู่แล้ว/,
    topics: ["technology", "ip"],
  },
  {
    id: "3.5",
    pattern: /รายละเอียดของแนวคิดหรือเทคโนโลยีใหม่|^35technologydetails/,
    topics: ["technology"],
  },
  {
    id: "3.6",
    pattern: /ทรัพย์สินทางปัญญาถ้ามี|^36ทรัพย์สินทางปัญญา/,
    topics: ["ip"],
  },
  {
    id: "4.1",
    pattern: /การวิเคราะห์ด้านการตลาด|ข้อมูลด้านการตลาด/,
    topics: ["market"],
  },
  {
    id: "4.2",
    pattern: /leancanvas|businessmodelcanvas/,
    topics: ["problem", "solution", "market", "revenue"],
  },
  {
    id: "5.1",
    pattern:
      /แผนทางการเงินfinancialplan|ประมาณการต้นทุนและรายได้|ประมาณการงบกำไรขาดทุน|incomestatement/,
    topics: ["revenue", "funding"],
  },
  {
    id: "5.2",
    pattern: /แผนการลงทุนเพื่อขยายผลเชิงพาณิชย์/,
    topics: ["funding"],
  },
];
export function detectSection(
  text: string,
  program: string,
  current: Section,
): Section | null {
  const n = normalize(text);
  // Table row labels and quoted instructions are not section changes. A heading
  // must be short and either numbered or an exact known heading phrase.
  if (text.length > 190 || /\.{5}|ให้ข้อคิดเห็น|ตัวอย่างเช่น/.test(text))
    return null;
  if (
    !/^\s*\d(?:\.\d){0,2}\s*\.?\s*/.test(text) &&
    !known.has(fingerprint(text))
  )
    return null;
  for (const d of definitions)
    if (d.pattern.test(n) && !/\btrl\b|\bcrl\b/i.test(text)) {
      if (current.id === "1.7" && !/^[2345]\./.test(text) && d.id === "1.1")
        continue;
      return {
        id: d.id,
        label: text.trim().slice(0, 160),
        topics: d.topics,
        ...(d.ignore ? { ignore: true } : {}),
        ...(d.id === "5.1" || d.id === "5.2" ? { forecast: true } : {}),
      };
    }
  const numbered = text.match(/^\s*([5-9])\s*\.\s*(.+)/);
  if (numbered) {
    const id = numbered[1]!,
      label = numbered[2]!;
    if (/แผนการเงินของโครงการ/.test(label))
      return { id, label: text, topics: ["funding"], forecast: true };
    if (/แผนการดำเนินงาน/.test(label))
      return { id, label: text, topics: ["plan"], forecast: true };
    if (/ตัวชี้วัดความสำเร็จ/.test(label))
      return { id, label: text, topics: ["plan"], forecast: true };
    if (/ประโยชน์และผลกระทบ/.test(label))
      return { id, label: text, topics: ["market"], forecast: true };
  }
  if (/^ข้อตกลง|เอกสารแนบข้อมูลนิติบุคคล/.test(text))
    return {
      id: "appendix",
      label: "เอกสารรับรองและข้อมูลนิติบุคคล",
      topics: [],
      ignore: true,
    };
  return null;
}
function rowTopics(label: string, fallback: Topic[]): Topic[] {
  const n = normalize(label);
  if (
    /customersegments|targetcustomer|targetmarket|ขนาดตลาด|competitor|คู่แข่ง|ช่องทาง|channels|customerrelationships/.test(
      n,
    )
  )
    return ["market"];
  if (/problems|ปัญหาหลัก/.test(n)) return ["problem"];
  if (/solution|valueproposition/.test(n)) return ["solution"];
  if (/unfairadvantage/.test(n)) return ["ip", "technology"];
  if (/revenuestream|รายได้จากการขาย|ปริมาณการขาย|ราคาจำหน่าย|กำไร/.test(n))
    return ["revenue"];
  if (/coststructure|ต้นทุน|ส่วนของเจ้าของ|ผู้เสนอโครงการ|กองทุน/.test(n))
    return ["funding"];
  if (/keymetrics|keyactivities/.test(n)) return ["plan"];
  if (/keyresources|keypartners/.test(n)) return ["team"];
  return fallback;
}
function isScaffold(text: string): boolean {
  const n = normalize(text);
  return (
    !n ||
    n.length < 2 ||
    /^[\d.\s,/%xX…_\-()]+$/.test(text) ||
    /^[□☐\uF0A3\uF0A0\uF0A8]\s*/u.test(text) ||
    /^(?:หมายเหตุ|\(?หมายเหตุ|โปรดระบุ|กรุณา|ระบุชื่อ|ระบุวันที่|อธิบายที่มา|อธิบายข้อมูลทาง|อธิบายสรุป|สรุปว่าโครงการของท่าน|สืบราคา|ตัวอย่างเช่น|เช่น$|ให้ข้อคิดเห็น|เอกสารสำคัญปกปิด|ห\s*น\s*้?\s*า\s*\d)/.test(
      text,
    ) ||
    /^(?:TRL|CRL|MRL|BRL)\s*\d/i.test(text)
  );
}
// Remove an unchanged template prefix only when its exact fingerprint exists.
// This preserves answers appended on the same line as a known prompt/heading.
function splitTemplatePrefix(
  text: string,
): { prefix: string; rest: string } | null {
  if (
    !/^\s*(?:\d+[.)]|อธิบาย|โปรด|กรุณา|ระบุ|สรุป|ภาษาไทย|English|หมายเหตุ)/i.test(
      text,
    )
  )
    return null;
  let end = 0;
  for (let i = 12; i < Math.min(text.length, 1000); i++)
    if (
      known.has(fingerprint(text.slice(0, i))) &&
      normalize(text.slice(0, i)).length >= 12
    )
      end = i;
  const rest = text
    .slice(end)
    .replace(/^[\s:：.\-]+/, "")
    .trim();
  return end && normalize(rest).length >= 8
    ? { prefix: text.slice(0, end), rest }
    : null;
}
function removeScaffold(text: string, allowNumeric = false): string[] {
  return text
    .split(/\n+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .flatMap((original) => {
      const line = splitTemplatePrefix(original)?.rest ?? original;
      if (allowNumeric && /^[\d,.%]+$/.test(line)) return [line];
      if (known.has(fingerprint(line))) return [];
      if (isScaffold(line)) return [];
      return [line];
    });
}
export function structureDocument(
  blocks: RawBlock[],
  pageCount: number | null,
  warnings: string[],
): ParsedDocument {
  const allText = blocks.map((b) => b.text).join("\n");
  const compact = normalize(allText);
  const ted =
    /tedyouthstartup/.test(compact) &&
    (/leancanvas|businessmodelcanvas/.test(compact) ||
      /ideationincentive|proofofcommercialization/.test(compact));
  const program = ted
    ? /leancanvas|ideationincentiveprogram/.test(compact)
      ? "TED_IDEA"
      : "TED_POC"
    : "UNKNOWN";
  const exactBlank = ted && documents.has(documentFingerprint(blocks));
  const units: SourceUnit[] = [];
  let section: Section = { id: "general", label: "ข้อมูลโครงการ", topics: [] },
    ignored = 0,
    uncertain = 0,
    subheading = "";
  const counts = Object.fromEntries(topics.map((t) => [t, 0])) as Record<
    Topic,
    number
  >;
  for (const originalBlock of blocks) {
    let block = originalBlock;
    const mixed = ted ? splitTemplatePrefix(block.text) : null;
    const heading = ted
      ? detectSection(mixed?.prefix ?? block.text, program, section)
      : null;
    if (heading) {
      section = heading;
      subheading = "";
      ignored++;
      if (!mixed) continue;
      block = { ...block, text: mixed.rest };
    }
    if (ted && (section.ignore || section.id === "general")) {
      ignored++;
      continue;
    }
    if (exactBlank) {
      ignored++;
      continue;
    }
    // A filled numeric readiness field or marked choice is reported but never
    // certified. Plain lists of every TRL/CRL level are excluded.
    if (
      ted &&
      section.topics.includes("plan") &&
      block.table &&
      block.row &&
      block.row > 2 &&
      block.column &&
      block.column > 1 &&
      /^(?:[xX✓✔√●]|1)$/.test(block.text.trim())
    ) {
      const month = block.columnLabel?.match(/(?:^|\D)(1[0-2]|[1-9])\s*$/)?.[1];
      if (month && block.rowLabel) {
        counts.plan++;
        units.push({
          id: `S${units.length + 1}`,
          locator: `ข้อ ${section.id} · ${block.locator}`,
          text: `กิจกรรม: ${block.rowLabel} · เดือนที่วางแผน: ${month} · เครื่องหมายที่กรอก: ${block.text}`,
          section: section.label,
          topics: ["plan"],
          kind: "document",
          claimType: "forecast",
        });
        continue;
      }
    }
    const labelCandidate = block.text.split(/\n/)[0] ?? "";
    if (
      ted &&
      ["4.1", "4.2"].includes(section.id) &&
      known.has(fingerprint(labelCandidate)) &&
      /^\d+[)）]\s*|customersegments|valuepropositions|revenuestreams|coststructure|keyactivities/i.test(
        labelCandidate,
      )
    )
      subheading = labelCandidate;
    if (
      ted &&
      ((known.has(fingerprint(block.text)) &&
        !/^[\d,.%]+$/.test(block.text.trim())) ||
        defaults.has(cellFingerprint(block)))
    ) {
      ignored++;
      continue;
    }
    if (ted && section.id === "1.7") {
      if (
        block.table &&
        block.row &&
        block.row > 1 &&
        /^(?:TRL|CRL|MRL|BRL)/i.test(block.columnLabel ?? "") &&
        /^[1-9]$/.test(block.text.trim())
      ) {
        uncertain++;
        counts.technology++;
        units.push({
          id: `S${units.length + 1}`,
          locator: `ข้อ ${section.id} ${block.locator}`,
          section: section.label,
          topics: ["technology"],
          text: `ค่าที่กรอก ${block.columnLabel}: ${block.text}`,
          kind: "document",
          claimType: "selection_unverified",
          context: "ระดับที่ผู้สมัครรายงาน ต้องตรวจหลักฐานการทำงานจริงแยกกัน",
        });
        continue;
      }

      const selected = /[✓✔☑☒√]|\[[xX]\]/.test(block.text);
      if (!selected) {
        ignored++;
        continue;
      }
      uncertain++;
      const value = block.text
        .split("\n")
        .filter(
          (line) =>
            /[✓✔☑☒√]|\[[xX]\]/.test(line) &&
            !known.has(fingerprint(line)) &&
            !/^หมายเหตุ|กรุณา/.test(line),
        )
        .join("\n");
      if (value) {
        counts.technology++;
        units.push({
          id: `S${units.length + 1}`,
          locator: `ข้อ ${section.id} ${block.locator}`,
          section: section.label,
          topics: ["technology"],
          text: value,
          kind: "document",
          claimType: "selection_unverified",
          context:
            "ช่องเลือกที่รายงาน ต้องตรวจเครื่องหมายกับต้นฉบับ ไม่ใช่หลักฐานยืนยันว่าเทคโนโลยีทำงานแล้ว",
        });
      }
      continue;
    }
    const paragraphs = ted
      ? removeScaffold(
          block.text,
          !!block.table && !!block.column && block.column > 1,
        )
      : block.text.split(/\n\s*\n/).filter((t) => !isScaffold(t));
    if (!paragraphs.length) {
      ignored++;
      continue;
    }
    const context = [
      block.rowLabel && block.column !== 1 ? `รายการ: ${block.rowLabel}` : "",
      block.columnLabel ? `หัวคอลัมน์: ${block.columnLabel}` : "",
      subheading,
      block.context,
    ]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 550);
    const unitTopics = rowTopics(
      [block.rowLabel, subheading].filter(Boolean).join(" "),
      section.topics,
    );
    for (const paragraph of paragraphs) {
      if (
        ted &&
        known.has(fingerprint(paragraph)) &&
        !/^[\d,.%]+$/.test(paragraph)
      ) {
        ignored++;
        continue;
      }
      // Exact template numbers are never accepted as evidence. Numeric values in a
      // filled row are retained with row/column context for officer verification.
      if (
        ted &&
        block.column === 1 &&
        paragraph === block.rowLabel &&
        known.has(fingerprint(paragraph))
      ) {
        ignored++;
        continue;
      }
      const clean = paragraph.trim();
      for (let offset = 0; offset < clean.length; offset += 600) {
        const text = clean.slice(offset, offset + 600);
        if (!text.trim()) continue;
        units.push({
          id: `S${units.length + 1}`,
          locator: `${ted ? `ข้อ ${section.id} · ` : ""}${block.locator}${clean.length > 600 ? ` ส่วน ${Math.floor(offset / 600) + 1}` : ""}`,
          text,
          kind: "document",
          ...(ted ? { section: section.label, topics: unitTopics } : {}),
          ...(context ? { context } : {}),
          claimType:
            section.forecast || /ประมาณการ|คาดการณ์/.test(context)
              ? "forecast"
              : "reported",
        });
        for (const t of unitTopics) counts[t]++;
      }
    }
  }
  if (ted)
    warnings.push(
      "ตรวจแยกคำแนะนำและข้อความเดิมของแบบฟอร์ม TED แล้ว แต่ข้อความที่แก้จากต้นแบบอาจแยกได้ไม่ครบ ต้องตรวจคำตอบกับต้นฉบับ",
    );
  if (ted && units.length === 0)
    warnings.push(
      "ยังไม่พบคำตอบโครงการที่แยกออกจากแบบฟอร์มต้นแบบได้ จึงยังไม่ส่งให้ AI จำแนก",
    );
  return {
    units,
    warnings,
    pageCount,
    extractorVersion,
    assessment: {
      templateProgram: program,
      templateVersion: ted ? templateReference.version : null,
      responseUnits: units.length,
      ignoredTemplateUnits: ignored,
      uncertainSelections: uncertain,
      quality: units.length ? "HAS_RESPONSES" : "NO_PROJECT_DATA",
      sectionCoverage: topics.map((topic) => ({
        topic,
        label: topicLabels[topic],
        responseUnits: counts[topic],
      })),
    },
  };
}
