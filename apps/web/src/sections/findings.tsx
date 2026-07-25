/**
 * Findings, with risks and strengths kept apart. A report that only lists problems is not a review, so
 * strengths get their own list rather than being folded into the same ranking.
 */

import type { Finding } from '@orchescope/schema';
import { useMemo, useState } from 'preact/hooks';
import { BASIS_ORDER, describeBasis, SEVERITY_ORDER } from '../basis.ts';
import {
  distinctValues,
  EMPTY_FINDING_FILTER,
  type FindingFilter,
  filterFindings,
  sortFindings,
} from '../filters.ts';
import { formatInteger, humanise } from '../format.ts';
import { useApp } from '../store.tsx';
import { Callout, SectionHeading } from '../ui/atoms.tsx';
import { SearchField, TokenFilter } from '../ui/filters.tsx';
import { FindingCard } from '../ui/finding-card.tsx';
import { VirtualList } from '../ui/virtual-list.tsx';

const CARD_HEIGHT = 220;

function FindingList(props: {
  readonly findings: readonly Finding[];
  readonly title: string;
  readonly emptyMessage: string;
  readonly openId: string | null;
}) {
  const app = useApp();
  if (props.findings.length === 0) {
    return (
      <section class="panel">
        <SectionHeading title={props.title} count={0} />
        <p class="muted">{props.emptyMessage}</p>
      </section>
    );
  }
  return (
    <section class="panel">
      <SectionHeading title={props.title} count={props.findings.length} />
      <VirtualList
        items={props.findings}
        label={props.title}
        rowHeight={CARD_HEIGHT}
        keyOf={(finding) => finding.id}
        renderRow={(finding) => (
          <FindingCard finding={finding} index={app.index} open={finding.id === props.openId} />
        )}
      />
    </section>
  );
}

export function FindingsSection() {
  const app = useApp();
  const { bundle } = app;
  const routeSeverity = app.state.route.params.severity ?? null;
  const openId = app.state.route.params.finding ?? null;

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

  if (bundle.findings.length === 0) {
    return (
      <div class="section">
        <Callout tone="info" title="This report contains no findings.">
          <p>
            No rule produced a claim it could evidence. That is a statement about the rules that ran
            and the evidence available to them, not a guarantee about the system.
          </p>
        </Callout>
      </div>
    );
  }

  return (
    <div class="section">
      <section class="panel">
        <SectionHeading title="Filters" />
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
            onChange={(categories2) => {
              setFilter({ ...filter, categories: categories2 });
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
                count: bundle.findings.filter((finding) => finding.polarity === 'strength').length,
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
        <p class="muted" aria-live="polite">
          {`${formatInteger(matched.length)} of ${formatInteger(bundle.findings.length)} findings match: ${formatInteger(risks.length)} risks and ${formatInteger(strengths.length)} strengths.`}
        </p>
      </section>

      <FindingList
        findings={risks}
        title="Risks"
        emptyMessage="No risk matches the current filters."
        openId={openId}
      />
      <FindingList
        findings={strengths}
        title="Strengths"
        emptyMessage="No strength matches the current filters."
        openId={openId}
      />
    </div>
  );
}
