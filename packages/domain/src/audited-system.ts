import type { Component } from '@orchescope/schema';

/**
 * The difference between the system under audit and the tools of whoever works on it.
 *
 * A repository can hold configuration that belongs to a developer's editor or coding agent rather than
 * to the software it builds. A `.mcp.json` naming a server is the clearest case: it tells one person's
 * tool where to connect, and it says nothing about what the repository is. Reading one as a declaration
 * reported a 220 component Cloudflare Workers application as a detected agent system holding no agent,
 * no tool and no model, and the reachability rule then raised a finding against that repository because
 * nothing in it could reach the server the developer's editor talks to.
 *
 * The vocabulary is here rather than beside either consumer because both the detection flag and the
 * topology rule ask the same question, and a repository that answers it one way for one of them and the
 * other way for the other is exactly how that contradiction got reported as a finding.
 *
 * What this excludes stays in the graph. A developer's tooling is a true fact about a repository, and
 * hiding it would trade one wrong answer for a missing one.
 */
export const partOfAuditedSystem = (component: Component): boolean =>
  !(component.details?.for === 'mcp_server' && component.details.role === 'developer_tooling');
