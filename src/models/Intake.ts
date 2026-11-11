import { Schema, model, Types } from "mongoose";
import type {
  ParsedDocument,
  SourceUnit,
  TedResult,
  RunStatus,
  Topic,
  SourceCoverage,
  DocumentAssessment,
} from "../domain/intake.js";
import type { TedCriteria } from "../domain/ted-criteria.js";
export interface CaseData {
  organizationId: string;
  title: string;
  fileId: Types.ObjectId;
  fileName: string;
  mime: string;
  bytes: number;
  sha256: string;
  permissionReference: string;
  allowAi: boolean;
  createdBy: Types.ObjectId;
  createKey: string;
  createHash: string;
  revision: number;
  decisionVersion: number;
  overrides: Partial<Record<Topic, string>>;
  document: ParsedDocument | null;
  activeAnalysisId: Types.ObjectId | null;
  latestAnalysisId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}
const cs = new Schema<CaseData>(
  {
    organizationId: { type: String, required: true, index: true },
    title: String,
    fileId: { type: Schema.Types.ObjectId, required: true },
    fileName: String,
    mime: String,
    bytes: Number,
    sha256: { type: String, required: true },
    permissionReference: String,
    allowAi: { type: Boolean, default: true },
    createdBy: Schema.Types.ObjectId,
    createKey: String,
    createHash: String,
    revision: { type: Number, default: 1 },
    decisionVersion: { type: Number, default: 0 },
    overrides: { type: Schema.Types.Mixed, default: {} },
    document: { type: Schema.Types.Mixed, default: null },
    activeAnalysisId: { type: Schema.Types.ObjectId, default: null },
    latestAnalysisId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, minimize: false },
);
cs.index({ organizationId: 1, sha256: 1 }, { unique: true });
cs.index({ organizationId: 1, createdBy: 1, createKey: 1 }, { unique: true });
cs.index({ organizationId: 1, _id: -1 });
export const IntakeCase = model<CaseData>("IntakeCase", cs);
export interface RunData {
  caseId: Types.ObjectId;
  organizationId: string;
  revision: number;
  status: RunStatus;
  availableAt: Date;
  leaseUntil: Date | null;
  leaseId: string | null;
  provider: string;
  model: string;
  promptVersion: string;
  criteria: TedCriteria;
  overrides: Partial<Record<Topic, string>>;
  sources: SourceUnit[];
  coverage: SourceCoverage | null;
  documentAssessment: DocumentAssessment | null;
  processingMode: "AI" | "DOCUMENT_CHECK";
  extractorVersion: string | null;
  result: TedResult | null;
  error: string | null;
  providerRequestId: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}
const rs = new Schema<RunData>(
  {
    caseId: { type: Schema.Types.ObjectId, required: true },
    organizationId: { type: String, required: true },
    revision: Number,
    status: {
      type: String,
      enum: ["queued", "extracting", "analyzing", "succeeded", "failed"],
      default: "queued",
    },
    availableAt: { type: Date, default: Date.now },
    leaseUntil: { type: Date, default: null },
    leaseId: { type: String, default: null },
    provider: String,
    model: String,
    promptVersion: String,
    criteria: Schema.Types.Mixed,
    overrides: Schema.Types.Mixed,
    sources: { type: Schema.Types.Mixed, default: [] },
    coverage: { type: Schema.Types.Mixed, default: null },
    documentAssessment: { type: Schema.Types.Mixed, default: null },
    processingMode: {
      type: String,
      enum: ["AI", "DOCUMENT_CHECK"],
      default: "AI",
    },
    extractorVersion: { type: String, default: null },
    result: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    providerRequestId: { type: String, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);
rs.index({ status: 1, availableAt: 1, createdAt: 1 });
rs.index({ organizationId: 1, caseId: 1, _id: -1 });
export const IntakeRun = model<RunData>("IntakeRun", rs);
const reviewSchema = new Schema(
  {
    caseId: { type: Schema.Types.ObjectId, required: true },
    organizationId: { type: String, required: true },
    analysisId: Schema.Types.ObjectId,
    revision: Number,
    decisionVersion: Number,
    destination: {
      type: String,
      enum: ["TED_IDEA", "TED_POC", null],
      default: null,
    },
    notes: String,
    reviewer: Schema.Types.ObjectId,
    reviewerName: String,
    key: String,
    payloadHash: String,
  },
  { timestamps: true },
);
reviewSchema.index({ organizationId: 1, caseId: 1, key: 1 }, { unique: true });
export const IntakeReview = model("IntakeReview", reviewSchema);
export const IntakeEvent = model(
  "IntakeEvent",
  new Schema(
    {
      caseId: Schema.Types.ObjectId,
      organizationId: String,
      actorName: String,
      action: String,
      details: Schema.Types.Mixed,
    },
    { timestamps: true },
  ),
);
export const ProviderGate = model(
  "ProviderGate",
  new Schema({
    _id: { type: String, required: true },
    nextAt: { type: Date, required: true },
  }),
);
