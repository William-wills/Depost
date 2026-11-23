/**
 * Shared domain types used by both the Forge functions (backend) and the
 * UI Kit panel (frontend). Keeping these in one place makes bridge calls
 * type-safe via `makeInvoke<ResolverDefinitions>()`.
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type FindingRule = 'hardcoded-secret' | 'missing-tests' | 'debug-statement';

/** A single rule violation discovered in a pull request diff. */
export interface DiffFinding {
  id: string;
  rule: FindingRule;
  severity: RiskLevel;
  file: string;
  line?: number;
  message: string;
}

/** A human-readable pass/fail gate shown in the issue panel. */
export interface ChecklistItem {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
}

/** Result of analyzing a unified diff. */
export interface DiffAnalysis {
  filesChanged: string[];
  additions: number;
  deletions: number;
  findings: DiffFinding[];
  checklist: ChecklistItem[];
  riskScore: number;
  riskLevel: RiskLevel;
}

/** Compact representation of a related Jira issue. */
export interface JiraIssueSummary {
  key: string;
  summary: string;
  status: string | null;
}

/** Jira changelog/context attached to a DevPulse report. */
export interface JiraContext {
  issueKey: string | null;
  summary: string | null;
  status: string | null;
  changelogEntries: number;
  relatedIssues: JiraIssueSummary[];
  /** `mock` when Jira was unavailable or no issue key was supplied. */
  source: 'jira' | 'mock';
  error?: string;
}

/** Context object included in Rovo action payloads. */
export interface RovoContext {
  accountId?: string;
  cloudId?: string;
  moduleKey?: string;
  jira?: {
    issueKey?: string;
    issueId?: string;
    projectKey?: string;
  };
}

/** Inputs declared by the `devpulse-scan-action` module. */
export interface RovoActionPayload {
  issueKey?: string;
  diff?: string;
  workspace?: string;
  repoSlug?: string;
  pullRequestId?: number | string;
  context?: RovoContext;
}

/** The object returned to both Rovo and the issue panel. */
export interface DevPulseReport {
  generatedAt: string;
  issueKey: string | null;
  analysis: DiffAnalysis;
  jira: JiraContext;
  summary: string;
}

/**
 * Bridge definitions. The keys match `resolver.define(...)` names in
 * `src/index.ts`, so UI calls are checked against backend return types.
 */
export interface ResolverDefinitions {
  getDevPulseReport: (payload: {
    issueKey?: string;
    diff?: string;
  }) => DevPulseReport;
  postReportToIssue: (payload: {
    issueKey: string;
    report: DevPulseReport;
  }) => { posted: boolean };
}
