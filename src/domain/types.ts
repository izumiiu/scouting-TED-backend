export type FieldValue = string | number | boolean | string[] | null;
export type Answers = Record<string, FieldValue>;
export type TedProgram = 'TED_IDEA' | 'TED_POC';
export type DevelopmentStageCode =
  | 'CONCEPT'
  | 'MOCKUP'
  | 'EARLY_EVIDENCE'
  | 'WORKING_PROTOTYPE'
  | 'MARKET_PRODUCT'
  | 'UNCLEAR';
export interface TedDevelopmentStage {
  stage: DevelopmentStageCode;
  reason: string;
  evidenceRefs: string[];
}
export interface TedFundingReadiness {
  status: 'NEEDS_VERIFICATION' | 'NOT_ASSESSED';
  reason: string;
  evidenceRefs: string[];
}
export interface TedAssessment {
  // Optional for historical analyses; current provider output requires developmentStage.
  developmentStage?: TedDevelopmentStage;
  // Added by the server, never accepted as an AI certification of funding.
  fundingReadiness?: TedFundingReadiness;
  classification: 'TED_IDEA' | 'TED_POC' | 'INSUFFICIENT_DATA';
  reason: string;
  alternativeReason: string;
  evidenceRefs: string[];
  uncertainties: string[];
}
