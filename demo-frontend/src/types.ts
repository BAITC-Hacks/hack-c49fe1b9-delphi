// Frontend data contract used by every screen. The offline demo (public/demo/*.json) is stored in this
// shape; live results are built from the backend's granular API (bottom of this file) by lib/adapter.ts.
// If the backend differs, adapt here and in lib/adapter.ts — never the other way round.

// Change type of a function (product.md §3.5): kept, reworded, transferred, split, merged, new, no match.
// duplicate/conflict are kept for backends that flag overlaps directly on the mapping.
export type FunctionStatus =
  | "kept"
  | "reworded"
  | "transferred"
  | "split"
  | "merged"
  | "missing"
  | "duplicate"
  | "conflict"
  | "new";

export type UnitStatus = "kept" | "new" | "changed" | "missing";

/** Separate "question" layer (product.md §3.5): overlap, potential conflict, stale reference, modality/scope change, unclear. */
export type RiskKind = "duplicate" | "conflict" | "reference" | "modality" | "scope" | "unclear";

/** Human review (product.md §3.5). Optional until the review endpoint exists. */
export type ReviewStatus = "unreviewed" | "confirmed" | "needs_clarification" | "rejected";
export interface Review {
  status: ReviewStatus;
  note?: string;
  updated_at?: string;
}

/** `synthetic`: a labelled control example prepared by hand, never a model run. */
export type Mode = "live" | "cached" | "partial" | "rule_based" | "synthetic";

export interface ClauseRef {
  /** Document identifier, e.g. "ed8", "ed9" or a backend UUID. */
  document_id: string;
  /** Human label of the edition, e.g. "ред. 8". */
  edition: string;
  /** Stable clause identifier used for lookups, e.g. "5.4.4". */
  clause_id: string;
  /** Display number, usually equal to clause_id. */
  clause_number: string;
  /** Optional substring of the clause text to highlight in the evidence panel. */
  highlight?: string;
  /** Python Unicode code-point offsets; end is exclusive. Do not use directly with JS slice. */
  start_offset?: number | null;
  end_offset?: number | null;
  /** Set cards: which side the document belongs to. Live results can have several documents per side. */
  side?: "before" | "after";
}

export interface Clause {
  document_id: string;
  edition: string;
  clause_id: string;
  clause_number: string;
  /** Verbatim text from the source document. */
  text: string;
  /** Parent heading, e.g. "5.4. Директор департамента …". */
  parent?: string;
}

export interface Unit {
  unit_id: string;
  name: string;
  status: UnitStatus;
  parent?: string;
  before: ClauseRef[];
  after: ClauseRef[];
  note?: string;
}

export interface FunctionSide {
  unit: string;
  owners: string[];
  refs: ClauseRef[];
  function_id?: string;
  summary: string;
}

export interface SearchCoverage {
  complete: boolean;
  reviewed: number;
  candidates: number;
  errors: string[];
  text: string;
}

export interface FunctionMapping {
  id: string;
  title: string;
  status: FunctionStatus;
  /** 0–1. The live backend does not score matches, so it is absent there. */
  confidence?: number;
  before: FunctionSide[];
  after: FunctionSide[];
  evidence?: EvidenceSet;
  /** What changed, in words. */
  note?: string;
  /** Short recommendation for the analyst (architecture.md Finding.recommendation). */
  recommendation?: string;
  review?: Review;
  /** Structured search coverage; never parse its display text to infer completeness. */
  search?: SearchCoverage;
}

export interface RiskSide {
  unit: string;
  owners: string[];
  refs: ClauseRef[];
  function_id?: string;
  summary?: string;
}

export interface Risk {
  id: string;
  kind: RiskKind;
  title: string;
  sides: RiskSide[];
  evidence?: EvidenceSet;
  why: string;
  check: string;
  review?: Review;
}

export interface ConclusionItem {
  finding_id?: string;
  text: string;
  refs: ClauseRef[];
}

export interface ConclusionSection {
  title: string;
  items: ConclusionItem[];
}

export interface Conclusion {
  sections: ConclusionSection[];
  limitations: string[];
}

export interface TraceItem {
  tool: string;
  input: unknown;
  output: unknown;
  ms: number;
}

export interface EditionInfo {
  label: string;
  date?: string;
}

export interface AnalysisResult {
  id: string;
  mode: Mode;
  editions: { before: EditionInfo; after: EditionInfo };
  units: Unit[];
  functions: FunctionMapping[];
  risks: Risk[];
  conclusion: Conclusion;
  trace: TraceItem[];
  coverage?: { complete: boolean; processed: number; total: number };
  structureFindings?: EvidenceRequest[];
  output_language?: "ru" | "kk" | "en";
  partial?: { failed_stage: number; message: string };
  /** Present for results loaded from the backend: server exports and review need the run. */
  live?: { analysis_id: string; run_id: string; review_revision: number };
}

/** `interrupted` = backend restarted mid-run (architecture.md §1); UI treats it like `failed` with its own text. */
export type StageState = "running" | "done" | "failed" | "interrupted";

export interface JobStatus {
  id: string;
  analysis_id?: string;
  stage: 1 | 2 | 3 | 4 | 5;
  stage_state: StageState;
  counters: Record<string, number>;
  /** Set when the run is finished; the UI navigates to /analyses/:result_id. */
  result_id?: string;
  error?: string;
  /** Live runs: whether the run was started with partial input allowed (repeat keeps the same option). */
  allow_partial?: boolean;
}

/** What the evidence drawer needs to render. */
export interface EvidenceSet {
  before: ClauseRef[];
  after: ClauseRef[];
  context: ClauseRef[];
  error?: string;
}

export interface EvidenceRequest {
  title: string;
  kind: "function" | "unit" | "risk" | "source";
  status?: FunctionStatus | UnitStatus | RiskKind;
  before?: ClauseRef[];
  after?: ClauseRef[];
  /** Extra context under the title, e.g. how completely the After set was searched. */
  note?: string;
  /** Live results: the finding behind this row/card, so the drawer can record a human review. */
  finding_id?: string;
  review?: Review;
  context?: ClauseRef[];
  error?: string;
  recommendation?: string;
  searchComplete?: boolean;
  participants?: RiskSide[];
}

// ---------------------------------------------------------------------------------------------
// Backend contract — raw shapes from backend/openapi.json. Only lib/api.ts and lib/adapter.ts use them.

export type ApiSide = "before" | "after";
export type ApiRunState = "queued" | "running" | "completed" | "partial" | "failed" | "interrupted";
export type ApiRunStage =
  | "queued"
  | "extracting"
  | "comparing"
  | "checking_risks"
  | "validating"
  | "completed"
  | "partial"
  | "failed"
  | "interrupted";
export type ApiParseStatus = "pending" | "parsed" | "partial" | "failed";
export type ApiChangeType =
  | "retained"
  | "reworded"
  | "transferred"
  | "split"
  | "merged"
  | "new"
  | "potentially_missing"
  | "changed"
  | "structure_changed";
export type ApiIssueType = "overlap" | "potential_conflict" | "modality_changed" | "scope_changed" | "insufficient_evidence";

export interface ApiErrorBody {
  code: string;
  message: string;
  details: { location: (string | number)[]; message: string; type: string }[];
}

export interface ApiHealth {
  status: "ok";
  ai_configured: boolean;
}

export interface ApiAnalysis {
  id: string;
  title: string;
  created_at: string;
}

export interface ApiAnalysisListItem extends ApiAnalysis {
  run_id: string | null;
  state: ApiRunState | "draft";
}

export interface ApiDocument {
  id: string;
  analysis_id: string;
  side: ApiSide;
  filename: string;
  hash: string;
  revision_label: string | null;
  format: "md" | "docx" | "pdf" | "xlsx";
  detected_language: string | null;
  parse_status: ApiParseStatus;
  warnings: string[];
  created_at: string;
  block_count: number;
}

export interface ApiCoverage {
  allow_partial: boolean;
  input_partial: boolean;
  input_warnings: Record<string, string[]>;
  total_documents: number;
  total_sources: number;
  processed_sources: number;
  before_functions: number;
  compared_before_functions: number;
  after_functions: number;
  reviewed_after_functions: number;
  structure_units: number;
  reviewed_structure_units: number;
  unprocessed_source_ids: string[];
  unreviewed_function_ids: string[];
}

export interface ApiStructureChange {
  id: string;
  before_unit_ids: string[];
  after_unit_ids: string[];
  status: "retained" | "newly_listed" | "transformed" | "unmatched";
  source_ids: string[];
  explanation: string;
}

export interface ApiUnit {
  id: string;
  side: ApiSide;
  kind: "department" | "role" | "group";
  name_original: string;
  parent_unit_id: string | null;
  source_ids: string[];
}

export interface ApiRun {
  id: string;
  analysis_id: string;
  state: ApiRunState;
  stage: ApiRunStage;
  output_language: "ru" | "kk" | "en";
  model: string;
  pipeline_version: string;
  review_revision: number;
  coverage: ApiCoverage;
  structure: ApiStructureChange[];
  errors: string[];
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface ApiRunDetail extends ApiRun {
  units: ApiUnit[];
  finding_count: number;
}

export interface ApiAnalysisDetail extends ApiAnalysis {
  documents: ApiDocument[];
  run: ApiRun | null;
}

export interface ApiRunAccepted {
  run_id: string;
  state: ApiRunState;
}

export interface ApiSearchCoverage {
  method: string;
  complete: boolean;
  reviewed_source_ids: string[];
  candidate_source_ids: string[];
  errors: string[];
  input_partial?: boolean | null;
}

export interface ApiReview {
  finding_id: string;
  status: ReviewStatus;
  note: string;
  updated_at: string;
}

export interface ApiReviewUpdated extends ApiReview {
  review_revision: number;
}

export interface ApiFinding {
  id: string;
  run_id: string;
  title: string;
  change_type: ApiChangeType;
  issue_type: ApiIssueType | null;
  before_function_ids: string[];
  after_function_ids: string[];
  explanation: string;
  recommendation: string;
  source_ids: string[];
  search: ApiSearchCoverage | null;
  review: ApiReview;
}

export interface ApiFunction {
  id: string;
  run_id: string;
  side: ApiSide;
  owner_unit_ids: string[];
  actor_original: string;
  action: string;
  object: string;
  scope: string;
  condition: string;
  modality: string;
  source_ids: string[];
}

export interface ApiEvidence {
  source_id: string;
  document_id: string;
  filename: string;
  side: ApiSide;
  clause_no: string | null;
  original_text: string;
  excerpt: string;
  locator: Record<string, unknown>;
  evidence_role: "before" | "after" | "context";
  start_offset: number | null;
  end_offset: number | null;
}

export interface ApiSource {
  id: string;
  document_id: string;
  clause_no: string | null;
  parent_id: string | null;
  original_text: string;
  locator: Record<string, unknown>;
}

/** Everything the adapter needs to build one AnalysisResult from the granular API. */
export interface LiveBundle {
  analysis: ApiAnalysisDetail;
  run: ApiRunDetail;
  findings: ApiFinding[];
  functions: ApiFunction[];
  /** source_id → verbatim block, for every document of the analysis. */
  sources: Record<string, ApiSource>;
  /** finding_id → saved evidence (excerpts are sliced from the original text by the backend). */
  evidence: Record<string, ApiEvidence[]>;
  evidenceErrors?: Record<string, string>;
}
