/**
 * UI Kit panel for the `jira:issuePanel` module.
 *
 * Shows the current risk score, checklist status, findings and a small slice of
 * Jira context. Uses typed bridge calls defined in `src/types.ts`.
 */
import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Button,
  Heading,
  Inline,
  Lozenge,
  Spinner,
  Stack,
  Text,
  useProductContext,
} from '@forge/react';
import { makeInvoke } from '@forge/bridge';
import type { DevPulseReport, ResolverDefinitions, RiskLevel } from '../types';

const invoke = makeInvoke<ResolverDefinitions>();

type LozengeAppearance = 'success' | 'information' | 'warning' | 'danger';

function appearanceForRisk(level: RiskLevel): LozengeAppearance {
  switch (level) {
    case 'critical':
      return 'danger';
    case 'high':
      return 'warning';
    case 'medium':
      return 'information';
    default:
      return 'success';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const App = () => {
  const context = useProductContext();
  const issueKey = (context?.extension as { issue?: { key?: string } } | undefined)?.issue?.key;

  const [report, setReport] = useState<DevPulseReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke('getDevPulseReport', { issueKey });
      setReport(result);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [issueKey]);

  useEffect(() => {
    if (context) {
      void loadReport();
    }
  }, [context, loadReport]);

  const postToIssue = async () => {
    if (!issueKey || !report) return;
    setPosting(true);
    try {
      await invoke('postReportToIssue', { issueKey, report });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPosting(false);
    }
  };

  if (!context || loading) {
    return <Spinner label="Loading DevPulse context..." />;
  }

  if (error) {
    return (
      <Stack>
        <Text>DevPulse could not load: {error}</Text>
        <Button onClick={() => void loadReport()}>Retry</Button>
      </Stack>
    );
  }

  if (!report) {
    return <Text>No DevPulse report is available yet.</Text>;
  }

  const { analysis, jira } = report;

  return (
    <Stack>
      <Heading as="h3">DevPulse Security &amp; Context</Heading>

      <Inline>
        <Text>Risk score</Text>
        <Lozenge appearance={appearanceForRisk(analysis.riskLevel)}>
          {analysis.riskScore}/100 {analysis.riskLevel}
        </Lozenge>
      </Inline>

      <Text>{report.summary}</Text>

      <Heading as="h4">Checklist</Heading>
      {analysis.checklist.map((item) => (
        <Inline key={item.id}>
          <Lozenge appearance={item.passed ? 'success' : 'danger'}>
            {item.passed ? 'PASS' : 'FAIL'}
          </Lozenge>
          <Text>{item.label}</Text>
        </Inline>
      ))}

      <Heading as="h4">Findings</Heading>
      {analysis.findings.length === 0 ? (
        <Text>No findings in this diff.</Text>
      ) : (
        analysis.findings.map((finding) => (
          <Text key={finding.id}>
            {finding.severity.toUpperCase()} - {finding.file}
            {finding.line ? `:${finding.line}` : ''}: {finding.message}
          </Text>
        ))
      )}

      <Heading as="h4">Jira context</Heading>
      <Text>Issue: {jira.issueKey ?? 'not linked'}</Text>
      <Text>Changelog entries: {jira.changelogEntries}</Text>
      {jira.relatedIssues.map((related) => (
        <Text key={related.key}>
          {related.key} - {related.summary}
        </Text>
      ))}
      {jira.source === 'mock' && (
        <Text>Jira data unavailable; showing mock context.</Text>
      )}

      <Button
        appearance="primary"
        isDisabled={!issueKey || posting}
        onClick={() => void postToIssue()}
      >
        {posting ? 'Posting...' : 'Post summary to Jira'}
      </Button>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
