/**
 * Forge backend entry point.
 *
 * - `runRovoAction` is the Rovo action handler (`index.runRovoAction`).
 * - `resolverHandler` serves the UI Kit issue panel via `@forge/bridge/invoke`.
 */
import { api, route } from '@forge/api';
import Resolver from '@forge/resolver';
import { analyzeDiff, MOCK_DIFF } from './actions/diffAnalyzer';
import { fetchIssueContext } from './actions/contextFetcher';
import type {
  DevPulseReport,
  JiraContext,
  RovoActionPayload,
  RovoContext,
} from './types';

const resolver = new Resolver();

/** Prefer the LLM-provided input, then fall back to deterministic context. */
function resolveIssueKey(
  payload: RovoActionPayload,
  context?: RovoContext,
): string | undefined {
  return (
    payload.issueKey ??
    payload.context?.jira?.issueKey ??
    context?.jira?.issueKey ??
    undefined
  );
}

function summarize(report: DevPulseReport): string {
  const failing = report.analysis.checklist
    .filter((item) => !item.passed)
    .map((item) => item.label);

  const prefix = `Risk ${report.analysis.riskScore}/100 (${report.analysis.riskLevel}).`;
  return failing.length > 0
    ? `${prefix} Needs attention: ${failing.join(', ')}.`
    : `${prefix} All checklist items passed.`;
}

async function buildReport(input: {
  issueKey?: string;
  diff?: string;
}): Promise<DevPulseReport> {
  const analysis = analyzeDiff(
    typeof input.diff === 'string' && input.diff.length > 0 ? input.diff : MOCK_DIFF,
  );
  const jira: JiraContext = await fetchIssueContext(input.issueKey ?? null);

  const report: DevPulseReport = {
    generatedAt: new Date().toISOString(),
    issueKey: jira.issueKey,
    analysis,
    jira,
    summary: '',
  };

  return { ...report, summary: summarize(report) };
}

/**
 * Rovo action handler. Returns a JSON object that Rovo converts into a
 * natural-language response.
 */
export async function runRovoAction(
  payload: RovoActionPayload = {},
  context?: RovoContext,
): Promise<DevPulseReport> {
  return buildReport({
    issueKey: resolveIssueKey(payload, context),
    diff: payload.diff,
  });
}

/** Fetch the latest report for the issue panel. */
resolver.define('getDevPulseReport', async ({ payload }) => {
  const input = (payload ?? {}) as { issueKey?: string; diff?: string };
  return buildReport(input);
});

/** Post a short ADF summary back to the Jira issue (uses write:jira-work). */
resolver.define('postReportToIssue', async ({ payload }) => {
  const { issueKey, report } = payload as {
    issueKey: string;
    report: DevPulseReport;
  };

  const adfBody = {
    version: 1,
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: 'DevPulse security scan' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: report.summary }],
      },
      {
        type: 'bulletList',
        content: report.analysis.findings.map((finding) => ({
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: `${finding.severity.toUpperCase()} - ${finding.file}${
                    finding.line ? `:${finding.line}` : ''
                  }: ${finding.message}`,
                },
              ],
            },
          ],
        })),
      },
    ],
  };

  const response = await api.asUser().requestJira(
    route`/rest/api/3/issue/${issueKey}/comment`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: adfBody }),
    },
  );

  if (!response.ok) {
    throw new Error(`Could not post DevPulse comment: ${response.status}`);
  }

  return { posted: true };
});

export const resolverHandler = resolver.getDefinitions();
