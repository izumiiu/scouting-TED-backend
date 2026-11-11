import type { TedAssessment } from "./types.js";
export const topics = [
  "problem",
  "solution",
  "technology",
  "market",
  "revenue",
  "team",
  "plan",
  "funding",
  "ip",
] as const;
export type Topic = (typeof topics)[number];
export const topicLabels: Record<Topic, string> = {
  problem: "ปัญหาและผู้ใช้",
  solution: "ผลิตภัณฑ์และคุณค่าที่เสนอ",
  technology: "เทคโนโลยีและต้นแบบ",
  market: "ตลาดและผลทดสอบกับผู้ใช้",
  revenue: "รูปแบบรายได้และลูกค้าที่จ่ายจริง",
  team: "ทีมและบทบาท",
  plan: "แผนพัฒนาและหมุดหมาย",
  funding: "เงินทุนและเงินสมทบ",
  ip: "สิทธิในเทคโนโลยีและทรัพย์สินทางปัญญา",
};
export interface SourceUnit {
  id: string;
  locator: string;
  text: string;
  kind: "document" | "officer";
  section?: string;
  topics?: Topic[];
  context?: string;
  claimType?: "reported" | "forecast" | "selection_unverified";
}
export interface ParsedDocument {
  units: SourceUnit[];
  warnings: string[];
  pageCount: number | null;
  extractorVersion: string;
  assessment?: DocumentAssessment;
}
export interface ExtractedField {
  key: Topic;
  value: string | null;
  evidenceRefs: string[];
}
export interface TedResult {
  summary: string;
  fields: ExtractedField[];
  tedAssessment: TedAssessment;
  missingInformation: {
    scope: "TED" | "TED_IDEA" | "TED_POC" | "TED_POC_FUNDING" | "DEVELOPMENT";
    question: string;
  }[];
}
export type RunStatus =
  "queued" | "extracting" | "analyzing" | "succeeded" | "failed";

export interface DocumentAssessment {
  templateProgram: "TED_IDEA" | "TED_POC" | "UNKNOWN";
  templateVersion: string | null;
  responseUnits: number;
  ignoredTemplateUnits: number;
  uncertainSelections: number;
  quality: "HAS_RESPONSES" | "NO_PROJECT_DATA";
  sectionCoverage: { topic: Topic; label: string; responseUnits: number }[];
}
export interface SourceCoverage {
  selected: number;
  total: number;
  selectedChars: number;
  totalChars: number;
  eligibleUnits?: number;
  topics?: {
    topic: Topic;
    label: string;
    available: number;
    selected: number;
  }[];
}
