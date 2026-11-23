export type Task =
  | "generate"
  | "revise"
  | "repair"
  | "validate"
  | "extract"
  | "render";
export interface Draft {
  task: Task;
  request: string;
  sysml_source: string;
  render: boolean;
}
export interface WorkspaceValue {
  title: string;
  memory_enabled: boolean;
  draft: Draft;
}
export interface Session extends WorkspaceValue {
  id: string;
  revision: number;
  created_at: string;
  updated_at: string;
}
export type SessionSummary = Omit<Session, "draft">;
export interface Diagnostic {
  severity: string;
  message: string;
  line?: number;
  column?: number;
  offset?: number;
  length?: number;
}
export interface Entity {
  id: string;
  name?: string;
  qualified_name?: string;
  kind: string;
  owner_id?: string;
  location?: { line?: number; offset?: number; length?: number };
}
export interface Result {
  valid?: boolean;
  sysml_source?: string;
  diagnostics?: Diagnostic[];
  final_artifact_sha256?: string;
  semantic_model?: { entities: Entity[]; relations: unknown[] };
  diagram?: {
    svg: string;
    coverage?: {
      displayed_entities: number;
      displayed_relations: number;
      omitted_entities: number;
    };
  };
  error_message?: string;
  source_diff?: string;
  model_usage?: {
    provider?: string;
    model?: string;
    usage?: { total_tokens?: number };
  }[];
  memory?: { included: boolean };
  evidence?: { status: string; citations?: unknown[] };
  validation_metadata?: { duration_ms?: number };
  repair_count?: number;
}
export interface Run {
  id: string;
  session_id: string;
  task: Task;
  request_preview: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  phase: string;
  phase_updated_at: string;
  created_at: string;
  updated_at: string;
  started_at?: string;
  attempts: number;
  paid_attempts: number;
  events: { phase: string; at: string; attempt: number }[];
  error_code?: string;
  input?: Draft;
  result?: Result;
}
export interface Page<T> {
  items: T[];
  next_cursor?: string | null;
}
export interface Identity {
  tenant_id: string;
  user_id: string;
  csrf_token: string;
}
export interface Capabilities {
  database: boolean;
  workers: number;
  capabilities: string[];
}
export interface Knowledge {
  id: string;
  title: string;
  source_uri: string;
  sha256: string;
}
