/**
 * Jira context enrichment for DevPulse.
 *
 * Uses `@forge/api` product Fetch APIs with the scopes declared in manifest.yml.
 * All calls degrade gracefully to mock data so the UI and Rovo action keep
 * working in development environments where Jira data is not available.
 */
import { api, route } from '@forge/api';
import type { JiraContext, JiraIssueSummary } from '../types';

interface JiraIssueResponse {
  key?: string;
  fields?: {
    summary?: string;
    status?: { name?: string };
  };
  changelog?: {
    histories?: unknown[];
  };
}

interface JiraSearchResponse {
  issues?: Array<{
    key: string;
    fields?: {
      summary?: string;
      status?: { name?: string };
    };
  }>;
}

/** Issue keys must be simple PROJECT-123 values before entering a URL. */
function normalizeIssueKey(issueKey: string | null | undefined): string | null {
  if (!issueKey) return null;
  const match = /^([A-Za-z][A-Za-z0-9_]*)-(\d+)$/.exec(issueKey.trim());
  return match ? match[0].toUpperCase() : null;
}

function mockContext(issueKey: string | null, error?: string): JiraContext {
  return {
    issueKey,
    summary: 'Mock issue: payments service hardening',
    status: 'In Progress',
    changelogEntries: 3,
    relatedIssues: [
      { key: 'DEV-101', summary: 'Rotate leaked staging key', status: 'To Do' },
      { key: 'DEV-102', summary: 'Add unit tests for charge helper', status: 'In Progress' },
    ],
    source: 'mock',
    error,
  };
}

/** Fetch up to five recently updated issues in the same project. */
async function fetchRelatedIssues(projectKey: string): Promise<JiraIssueSummary[]> {
  if (!/^[A-Za-z0-9_]+$/.test(projectKey)) return [];

  const jql = `project = ${projectKey} ORDER BY updated DESC`;
  const response = await api.asUser().requestJira(
    route`/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=5&fields=summary,status`,
    { headers: { Accept: 'application/json' } },
  );

  if (!response.ok) {
    throw new Error(`Jira related-issues request failed: ${response.status}`);
  }

  const body = (await response.json()) as JiraSearchResponse;
  return (body.issues ?? []).map((issue) => ({
    key: issue.key,
    summary: issue.fields?.summary ?? 'No summary',
    status: issue.fields?.status?.name ?? null,
  }));
}

/**
 * Load issue summary, status, changelog size and related issues.
 * Falls back to deterministic mock data on any failure.
 */
export async function fetchIssueContext(issueKey: string | null | undefined): Promise<JiraContext> {
  const safeKey = normalizeIssueKey(issueKey);
  if (!safeKey) {
    return mockContext(null, 'No valid Jira issue key supplied; using mock context.');
  }

  try {
    const issueResponse = await api.asUser().requestJira(
      route`/rest/api/3/issue/${safeKey}?expand=changelog`,
      { headers: { Accept: 'application/json' } },
    );

    if (!issueResponse.ok) {
      throw new Error(`Jira issue request failed: ${issueResponse.status}`);
    }

    const issue = (await issueResponse.json()) as JiraIssueResponse;
    const projectKey = safeKey.split('-')[0];
    const relatedIssues = await fetchRelatedIssues(projectKey);

    return {
      issueKey: safeKey,
      summary: issue.fields?.summary ?? null,
      status: issue.fields?.status?.name ?? null,
      changelogEntries: issue.changelog?.histories?.length ?? 0,
      relatedIssues,
      source: 'jira',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...mockContext(safeKey), error: message };
  }
}
