/**
 * Findings, with risks and strengths kept apart. A report that only lists problems is not a review, so
 * strengths get their own list rather than being folded into the same ranking.
 *
 * Every finding is one line that expands. The list is rendered whole rather than windowed, because
 * findings are grouped before they reach here: the rule that produced 211 instances of one pattern in
 * `openai-agents-python` now produces two findings carrying the occurrence count, and a windowed list
 * of expandable rows would have to guess a height that changes the moment one opens.
 */

import type { Finding } from '@orchescope/schema';
import { useMemo, useState } from 'preact/hooks';
import { BASIS_ORDER, describeBasis, SEVERITY_ORDER } from '../basis.ts';
import { auditCommand } from '../commands.ts';
import {
  distinctValues,
  EMPTY_FINDING_FILTER,
  type FindingFilter,
  filterFindings,
  sortFindings,
} from '../filters.ts';
import { formatInteger, humanise } from '../format.ts';
import { useApp } from '../store.tsx';
import { SearchField, TokenFilter } from '../ui/filters.tsx';
import { FindingCard } from '../ui/finding-card.tsx';
import { Data, Eyebrow, Figure, RefusalPanel, SeverityMark } from '../ui/primitives.tsx';

function FindingList(props: {
  readonly findings: readonly Finding[];
  readonly title: string;
  readonly emptyMessage: string;
  readonly openId: string | null;
  readonly filtered: boolean;
  readonly onClear: () => void;
}) {
  const app = useApp();
  if (props.findings.length === 0) {
    return (
      <section class="tile">
        <Eyebrow level={3} count={0}>
          {props.title}
        </Eyebrow>
        <RefusalPanel title={props.emptyMessage}>
          {props.filtered ? (
            <p class="more">
              <button type="button" class="link-button" onClick={props.onClear}>
                Clear every filter
              </button>
            </p>
          ) : null}
        </RefusalPanel>
      </section>
    );
  }
  return (
    <section class="tile">
      <Eyebrow level={3} count={props.findings.length}>
        {props.title}
      </Eyebrow>
      <div class="finding-list">
        {props.findings.map((finding) => (
          <FindingCard
            key={finding.id}
            finding={finding}
            index={app.index}
            open={finding.id === props.openId}
          />
        ))}
      </div>
    </section>
  );
}

export function FindingsSection() {
  const app = useApp();
  const { bundle } = app;
  const routeSeverity = app.state.route.params['severity'] ?? null;
  const openId = app.state.route.params['finding'] ?? null;

  const [filter, setFilter] = useState<FindingFilter>(() =>
    routeSeverity === null
      ? EMPTY_FINDING_FILTER
      : { ...EMPTY_FINDING_FILTER, severities: [routeSeverity] },
  );

  const categories = useMemo(
    () => distinctValues(bundle.findings, (finding) => finding.category),
    [bundle.findings],
  );
  const presentSeverities = useMemo(
    () =>
      SEVERITY_ORDER.filter((severity) =>
        bundle.findings.some((finding) => finding.severity === severity),
      ),
    [bundle.findings],
  );
  const presentBases = useMemo(
    () => BASIS_ORDER.filter((basis) => bundle.findings.some((finding) => finding.basis === basis)),
    [bundle.findings],
  );

  const matched = useMemo(
    () => sortFindings(filterFindings(bundle.findings, filter)),
    [bundle.findings, filter],
  );
  const risks = matched.filter((finding) => finding.polarity === 'risk');
  const strengths = matched.filter((finding) => finding.polarity === 'strength');
  const filtered =
    filter.query.length > 0 ||
    filter.severities.length > 0 ||
    filter.categories.length > 0 ||
    filter.polarities.length > 0 ||
    filter.bases.length > 0;
  const clear = () => {
    setFilter(EMPTY_FINDING_FILTER);
    app.announce('Every finding filter cleared.');
  };

  if (bundle.findings.length === 0) {
    return (
      <section class="tile is-band">
        <Eyebrow level={3}>Findings</Eyebrow>
        <RefusalPanel title="This report contains no findings." commands={[auditCommand()]}>
          <p>
            No rule produced a claim it could evidence. That is a statement about the rules that ran
            and about the evidence available to them, and not a guarantee about the system. A report
            with a run folded into it has more evidence for the same rules to work from.
          </p>
        </RefusalPanel>
      </section>
    );
  }

  return (
    // Filters beside the findings rather than above them. Six filter groups across the top of a wide
    // window pushed the first finding below the fold on every report in the corpus.
    <div class="workbench">
      <div class="workbench-controls">
        <section class="tile">
          <Eyebrow level={3}>Filters</Eyebrow>
          <div class="filter-bar">
            <SearchField
              label="Search findings"
              value={filter.query}
              placeholder="title, explanation, component, tag"
              onChange={(query) => {
                setFilter({ ...filter, query });
              }}
              resultCount={matched.length}
              resultNoun="finding"
              resultPlural="findings"
            />
            <TokenFilter
              legend="Severity"
              selected={filter.severities}
              onChange={(severities) => {
                setFilter({ ...filter, severities });
              }}
              options={presentSeverities.map((severity) => ({
                value: severity,
                label: humanise(severity),
                count: bundle.findings.filter((finding) => finding.severity === severity).length,
              }))}
            />
            <TokenFilter
              legend="Category"
              selected={filter.categories}
              onChange={(next) => {
                setFilter({ ...filter, categories: next });
              }}
              options={categories.map((category) => ({
                value: category,
                label: humanise(category),
                count: bundle.findings.filter((finding) => finding.category === category).length,
              }))}
            />
            <TokenFilter
              legend="Polarity"
              selected={filter.polarities}
              onChange={(polarities) => {
                setFilter({ ...filter, polarities });
              }}
              options={[
                {
                  value: 'risk',
                  label: 'Risk',
                  count: bundle.findings.filter((finding) => finding.polarity === 'risk').length,
                },
                {
                  value: 'strength',
                  label: 'Strength',
                  count: bundle.findings.filter((finding) => finding.polarity === 'strength')
                    .length,
                },
              ]}
            />
            <TokenFilter
              legend="Evidence class"
              selected={filter.bases}
              onChange={(bases) => {
                setFilter({ ...filter, bases });
              }}
              options={presentBases.map((basis) => ({
                value: basis,
                label: describeBasis(basis).label,
                count: bundle.findings.filter((finding) => finding.basis === basis).length,
              }))}
            />
          </div>
          <p class="match-count" aria-live="polite">
            {`${formatInteger(matched.length)} of ${formatInteger(bundle.findings.length)} findings match: ${formatInteger(risks.length)} risks and ${formatInteger(strengths.length)} strengths.`}
          </p>
        </section>
      </div>

      <div class="workbench-main">
        {/* The headline of the screen, and it is bounded on purpose. What the feature surface is for
            is the one thing a reader looks at first, and a list of nineteen expandable rows is not
            that: wrapped in it, the surface stopped being a feature and became the page. */}
        <section class="tile is-band">
          <Eyebrow level={3}>Findings</Eyebrow>
          <div class="lead-head">
            <p class="display">
              <span class="data">{formatInteger(risks.length)}</span>
              <span>{risks.length === 1 ? ' risk, ' : ' risks, '}</span>
              <span class="data">{formatInteger(strengths.length)}</span>
              <span>{strengths.length === 1 ? ' strength.' : ' strengths.'}</span>
            </p>
            <div class="lead-measure">
              <Figure
                value={formatInteger(matched.length)}
                of={`of ${formatInteger(bundle.findings.length)} findings shown${filtered ? ', filtered' : ''}`}
              />
              {presentSeverities.length === 0 ? null : (
                <ul class="key">
                  {presentSeverities.map((severity) => (
                    <li key={severity}>
                      <button
                        type="button"
                        class="link-button"
                        onClick={() => {
                          setFilter({ ...filter, severities: [severity] });
                          app.announce(`Filtered to ${severity} findings.`);
                        }}
                      >
                        <SeverityMark severity={severity} />
                        <Data>
                          {` ${formatInteger(
                            matched.filter((finding) => finding.severity === severity).length,
                          )}`}
                        </Data>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <FindingList
          findings={risks}
          title="Risks"
          emptyMessage={
            filtered
              ? 'No risk matches the current filters.'
              : 'No risk was reported. That is a statement about the rules that had enough evidence to fire, not a guarantee about the system.'
          }
          openId={openId}
          filtered={filtered}
          onClear={clear}
        />
        <FindingList
          findings={strengths}
          title="Strengths"
          emptyMessage={
            filtered
              ? 'No strength matches the current filters.'
              : 'No strength was reported. A strength needs the same evidence a risk does, and no rule found enough of it.'
          }
          openId={openId}
          filtered={filtered}
          onClear={clear}
        />
      </div>
    </div>
  );
}
