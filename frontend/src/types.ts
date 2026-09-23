// Frontend data contract. Mirrors the backend schema agreed with Osman (DESIGN.md §6).
// If the backend differs, adapt here and in lib/api.ts — never the other way round.

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

export type Mode = "live" | "cached" | "partial" | "rule_based";

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
  before?: ClauseRef;
  after?: ClauseRef;
  note?: string;
}

export interface FunctionSide {
  unit: string;
  ref: ClauseRef;
  summary: string;
}

export interface FunctionMapping {
  id: string;
  title: string;
  status: FunctionStatus;
  /** 0–1 */
  confidence: number;
  before?: FunctionSide;
  after?: FunctionSide[];
  /** What changed, in words. */
  note?: string;
  /** Short recommendation for the analyst (architecture.md Finding.recommendation). */
  recommendation?: string;
  review?: Review;
}

export interface RiskSide {
  unit: string;
  ref: ClauseRef;
  summary?: string;
}

export interface Risk {
  id: string;
  kind: RiskKind;
  title: string;
  a: RiskSide;
  b: RiskSide;
  why: string;
  check: string;
  review?: Review;
}

export interface ConclusionItem {
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
  partial?: { failed_stage: number; message: string };
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
}

/** What the evidence drawer needs to render. */
export interface EvidenceRequest {
  title: string;
  kind: "function" | "unit" | "risk";
  status: FunctionStatus | UnitStatus | RiskKind;
  before?: ClauseRef[];
  after?: ClauseRef[];
}
