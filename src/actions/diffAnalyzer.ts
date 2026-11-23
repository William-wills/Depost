/**
 * Diff analysis for DevPulse.
 *
 * This module is deliberately pure: it takes a unified diff string and returns
 * structured findings. That makes it easy to unit test and lets the Rovo action
 * fall back to `MOCK_DIFF` during early hackathon iterations.
 */
import type {
  ChecklistItem,
  DiffAnalysis,
  DiffFinding,
  FindingRule,
  RiskLevel,
} from '../types';

interface SecretRule {
  label: string;
  severity: RiskLevel;
  regex: RegExp;
}

interface AddedLine {
  file: string;
  line: number;
  content: string;
}

interface ParsedDiff {
  files: string[];
  added: AddedLine[];
  additions: number;
  deletions: number;
}

/** Patterns tuned to be fast and explainable rather than exhaustive. */
const SECRET_RULES: SecretRule[] = [
  {
    label: 'AWS access key ID',
    severity: 'critical',
    regex: /AKIA[0-9A-Z]{16}/,
  },
  {
    label: 'Slack token',
    severity: 'critical',
    regex: /xox[baprs]-[A-Za-z0-9-]{10,}/,
  },
  {
    label: 'Private key header',
    severity: 'critical',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    label: 'Hardcoded credential assignment',
    severity: 'high',
    regex: /(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["'][^"']{8,}["']/i,
  },
  {
    label: 'JWT literal',
    severity: 'high',
    regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
];

const DEBUG_REGEX = /console\.(log|debug)\s*\(/;
const SOURCE_FILE_REGEX = /\.(ts|tsx|js|jsx)$/i;
const TEST_FILE_REGEX = /\.(test|spec)\.[jt]sx?$/i;

const RISK_WEIGHTS: Record<RiskLevel, number> = {
  low: 5,
  medium: 20,
  high: 35,
  critical: 50,
};

/** Sample diff used until real Bitbucket diffs are wired in. */
export const MOCK_DIFF = `diff --git a/src/services/payments.ts b/src/services/payments.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/src/services/payments.ts
@@ -0,0 +1,12 @@
+import { request } from './http';
+
+const apiKey = "sk_live_51H8xExampleDoNotUse123";
+
+export async function charge(amount: number) {
+  console.log("charging", amount);
+  return request('/charges', { apiKey, amount });
+}
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1,2 +1,3 @@
 # Payments service
+Adds a new charge helper.
`;

/** Parse just enough of a unified diff to know files and added lines. */
function parseDiff(diff: string): ParsedDiff {
  const files: string[] = [];
  const added: AddedLine[] = [];
  let additions = 0;
  let deletions = 0;
  let currentFile = '';
  let newLineNumber = 0;

  for (const rawLine of diff.split(/\r?\n/)) {
    const hunk = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLineNumber = Number(hunk[1]);
      continue;
    }

    if (rawLine.startsWith('+++ ')) {
      const path = rawLine.slice(4).trim();
      if (path !== '/dev/null') {
        currentFile = path.startsWith('b/') ? path.slice(2) : path;
        if (!files.includes(currentFile)) {
          files.push(currentFile);
        }
      }
      continue;
    }

    if (rawLine.startsWith('--- ')) {
      continue;
    }

    if (rawLine.startsWith('+')) {
      additions += 1;
      added.push({
        file: currentFile,
        line: newLineNumber,
        content: rawLine.slice(1),
      });
      newLineNumber += 1;
      continue;
    }

    if (rawLine.startsWith('-')) {
      deletions += 1;
      continue;
    }

    // Context lines advance the new-file line counter.
    newLineNumber += 1;
  }

  return { files, added, additions, deletions };
}

function levelFromScore(score: number): RiskLevel {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

/**
 * Analyze a unified diff and produce a risk score, findings and checklist.
 * The score is capped at 100 so multiple findings never overflow the UI.
 */
export function analyzeDiff(diff: string): DiffAnalysis {
  const parsed = parseDiff(diff);
  const findings: DiffFinding[] = [];

  // 1. Secret detection on added lines only (removed secrets are not a risk).
  parsed.added.forEach((addedLine, index) => {
    for (const rule of SECRET_RULES) {
      if (rule.regex.test(addedLine.content)) {
        findings.push({
          id: `secret-${index}-${rule.label.replace(/\W+/g, '-').toLowerCase()}`,
          rule: 'hardcoded-secret' as FindingRule,
          severity: rule.severity,
          file: addedLine.file || 'unknown',
          line: addedLine.line,
          message: `${rule.label} detected in added code`,
        });
      }
    }
  });

  // 2. Debug statements left in production code.
  parsed.added.forEach((addedLine, index) => {
    if (DEBUG_REGEX.test(addedLine.content)) {
      findings.push({
        id: `debug-${index}`,
        rule: 'debug-statement',
        severity: 'low',
        file: addedLine.file || 'unknown',
        line: addedLine.line,
        message: 'console logging added to production code',
      });
    }
  });

  // 3. Missing test coverage for changed source files.
  const changedSourceFiles = parsed.files.filter(
    (file) =>
      SOURCE_FILE_REGEX.test(file) &&
      file.startsWith('src/') &&
      !TEST_FILE_REGEX.test(file),
  );
  const changedTestFiles = parsed.files.filter((file) => TEST_FILE_REGEX.test(file));

  if (changedSourceFiles.length > 0 && changedTestFiles.length === 0) {
    findings.push({
      id: 'missing-tests',
      rule: 'missing-tests',
      severity: 'medium',
      file: changedSourceFiles[0],
      message: `${changedSourceFiles.length} source file(s) changed without a test file`,
    });
  }

  const rawScore = findings.reduce((total, finding) => total + RISK_WEIGHTS[finding.severity], 0);
  const riskScore = Math.min(100, rawScore);

  const checklist: ChecklistItem[] = [
    {
      id: 'no-secrets',
      label: 'No hardcoded secrets',
      passed: !findings.some((finding) => finding.rule === 'hardcoded-secret'),
      detail: 'Scans added lines for API keys, tokens and private keys.',
    },
    {
      id: 'tests-updated',
      label: 'Tests updated with source changes',
      passed: changedSourceFiles.length === 0 || changedTestFiles.length > 0,
      detail: 'At least one *.test.* or *.spec.* file should accompany source edits.',
    },
    {
      id: 'no-debug-logs',
      label: 'No debug logging added',
      passed: !findings.some((finding) => finding.rule === 'debug-statement'),
      detail: 'Checks for newly added console.log/console.debug calls.',
    },
  ];

  return {
    filesChanged: parsed.files,
    additions: parsed.additions,
    deletions: parsed.deletions,
    findings,
    checklist,
    riskScore,
    riskLevel: levelFromScore(riskScore),
  };
}
