import type {
  ParsedDocument,
  SourceUnit,
  Topic,
  SourceCoverage,
} from "../domain/intake.js";
import { topics, topicLabels } from "../domain/intake.js";
const terms: Record<Topic, string[]> = {
  problem: ["ปัญหา", "pain", "problem", "ผู้ใช้"],
  solution: ["ผลิตภัณฑ์", "solution", "คุณค่า", "บริการ"],
  technology: ["ต้นแบบ", "เทคโนโลยี", "นวัตกรรม", "prototype", "ทดสอบ"],
  market: ["ตลาด", "ลูกค้า", "market", "loi", "นำร่อง", "traction"],
  revenue: ["รายได้", "ยอดขาย", "revenue", "ราคา", "จ่าย"],
  team: ["ทีม", "ประสบการณ์", "หน้าที่", "team", "ผู้รับผิดชอบ"],
  plan: ["แผน", "เดือน", "หมุดหมาย", "milestone", "กำหนด"],
  funding: ["งบ", "สมทบ", "เงินทุน", "budget", "contribution"],
  ip: ["สิทธิ", "สิทธิบัตร", "เจ้าของ", "license", "ทรัพย์สิน"],
};
export function sourceTopics(unit: SourceUnit): Topic[] {
  return unit.topics?.length
    ? unit.topics
    : topics.filter((t) =>
        terms[t].some((word) => unit.text.toLowerCase().includes(word)),
      );
}
export function selectSources(
  document: ParsedDocument,
  overrides: Partial<Record<Topic, string>>,
) {
  const notes: SourceUnit[] = topics.flatMap((key) =>
    overrides[key]?.trim()
      ? [
          {
            id: `O_${key}`,
            locator: `ข้อมูลเจ้าหน้าที่: ${topicLabels[key]}`,
            text: overrides[key]!.trim(),
            kind: "officer",
            topics: [key],
            claimType: "reported",
          },
        ]
      : [],
  );
  const selected: SourceUnit[] = [];
  const seen = new Set<string>();
  let remaining = 5000 - notes.reduce((sum, u) => sum + u.text.length, 0),
    wire = 7000 - JSON.stringify(notes).length;
  const eligible = document.units;
  const byTopic = new Map(
    topics.map((t) => [
      t,
      eligible
        .filter((u) => sourceTopics(u).includes(t))
        .sort((a, b) => {
          // Prefer substantive answers over tiny labels. No project eligibility decision
          // is made by this retrieval ranking.
          const score = (u: SourceUnit) =>
            Math.min(u.text.length, 400) +
            (u.section ? 80 : 0) +
            (u.claimType === "selection_unverified" ? -200 : 0);
          return score(b) - score(a);
        }),
    ]),
  );
  const take = (u: SourceUnit) => {
    const cost = JSON.stringify(u).length;
    if (
      selected.length >= 40 ||
      seen.has(u.id) ||
      u.text.length > remaining ||
      cost > wire
    )
      return false;
    selected.push(u);
    seen.add(u.id);
    remaining -= u.text.length;
    wire -= cost;
    return true;
  };
  // Round-robin reserves a first opportunity for every topic, instead of filling
  // the budget with repeated definitions or stopping after 14 short Word cells.
  for (let round = 0; round < 5; round++) {
    for (const topic of topics) {
      const candidate = byTopic
        .get(topic)!
        .find(
          (u) =>
            !seen.has(u.id) &&
            u.text.length <= remaining &&
            JSON.stringify(u).length <= wire,
        );
      if (candidate) take(candidate);
    }
  }
  for (const u of eligible) {
    if (selected.length >= 40) break;
    take(u);
  }
  const coverage: SourceCoverage = {
    selected: selected.length,
    total: document.units.length,
    selectedChars: selected.reduce((n, u) => n + u.text.length, 0),
    totalChars: document.units.reduce((n, u) => n + u.text.length, 0),
    eligibleUnits: eligible.length,
    topics: topics.map((topic) => ({
      topic,
      label: topicLabels[topic],
      available: eligible.filter((u) => sourceTopics(u).includes(topic)).length,
      selected: [...selected, ...notes].filter((u) =>
        sourceTopics(u).includes(topic),
      ).length,
    })),
  };
  return { sources: [...selected, ...notes], coverage };
}
