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
import { BASIS_ORDER, describeBasis, SEVERITY_ORDER } from '../presentation/basis.ts';
import { groupFindingsByReadiness } from '../presentation/finding-groups.ts';
import {
  distinctValues,
  EMPTY_FINDING_FILTER,
  type FindingFilter,
  filterFindings,
  sortFindingsForAction,
} from '../presentation/filters.ts';
import { formatInteger, humanise } from '../presentation/format.ts';
import type { PresentationRefusal } from '../presentation/presentation-refusal.ts';
import { buildSectionPresentations } from '../presentation/section-presentation.ts';
import { useApp } from '../store.tsx';
import { SearchField, TokenFilter } from '../ui/filters.tsx';
import { FindingCard } from '../ui/finding-card.tsx';
import { Data, Meta, RefusalPanel, SeverityMark } from '../ui/primitives.tsx';
import { SectionSkeleton } from '../ui/section-skeleton.tsx';

/**
 * A list of findings, split at the line that decides what can be handed off.
 *
 * The split is drawn only where it means something. Strengths carry goal readiness too, but nobody
 * hands off a strength, so they stay one list and the grouping is asked for rather than assumed.
 */
function FindingList(props: {
  readonly findings: readonly Finding[];
  readonly title: string;
  readonly emptyMessage: string;
  readonly openId: string | null;
  readonly filtered: boolean;
  readonly grouped: boolean;
  readonly onClear: () => void;
  readonly refusal: PresentationRefusal | null;
}) {
  const app = useApp();
  if (props.findings.length === 0) {
    return (
      <section class="tile">
        <h3 class="section-title">{props.title}</h3>
        <RefusalPanel
          title={props.refusal?.title ?? props.emptyMessage}
          commands={props.refusal?.commands ?? []}
        >
          {props.refusal === null ? null : <p>{props.refusal.reason}</p>}
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
  const cards = (findings: readonly Finding[]) => (
    <div class="finding-list">
      {findings.map((finding) => (
        <FindingCard
          key={finding.id}
          finding={finding}
          index={app.index}
          open={finding.id === props.openId}
        />
      ))}
    </div>
  );
  return (
    <section class="tile">
      <h3 class="section-title">
        {props.title}
        <Data>{` ${formatInteger(props.findings.length)}`}</Data>
      </h3>
      {props.grouped
        ? groupFindingsByReadiness(props.findings).map((group) => (
            <section class={`finding-group is-${group.id}`} key={group.id}>
              <div class="finding-group-head">
                <h4>
                  {group.label}
                  <Data>{` ${formatInteger(group.findings.length)}`}</Data>
                </h4>
                <p>{group.reason}</p>
              </div>
              {cards(group.findings)}
            </section>
          ))
        : cards(props.findings)}
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
    () => sortFindingsForAction(filterFindings(bundle.findings, filter)),
    [bundle.findings, filter],
  );
  const risks = matched.filter((finding) => finding.polarity === 'risk');
  const strengths = matched.filter((finding) => finding.polarity === 'strength');
  const filtered =
    filter.query.length > 0 ||
    filter.severities.length > 0 ||
    filter.categories.length > 0 ||
    filter.polarities.length > 0 ||
    filter.bases.length > 0 ||
    filter.goalReadiness.length > 0;
  const clear = () => {
    setFilter(EMPTY_FINDING_FILTER);
    app.announce('Every finding filter cleared.');
  };

  const eligible = risks.filter((finding) => finding.goalReadiness.eligible).length;
  const presentation = buildSectionPresentations(bundle).findings;

  return (
    <SectionSkeleton
      section="findings"
      summary={
        <section class="tile is-band section-lead">
          {/* The answer is what can be handed off, not how many rows the filter left. `21 of 21
              findings shown` was the largest thing on this screen and it is a tautology until a
              filter is set, so the count of shown findings appears only once one is. */}
          <h3 class="section-lead-question">What to fix, and what is ready to hand off</h3>
          <div class="section-lead-body">
            <p class="section-lead-answer">
              <span class="section-lead-figure">{formatInteger(eligible)}</span>
              <span>
                {` of ${formatInteger(risks.length)} ${risks.length === 1 ? 'problem' : 'problems'} ${eligible === 1 ? 'has' : 'have'} enough behind ${eligible === 1 ? 'it' : 'them'} to hand straight to somebody.`}
              </span>
            </p>
            <div class="section-lead-aside">
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
              <Meta>
                <span>{`${formatInteger(risks.length)} ${risks.length === 1 ? 'problem' : 'problems'}`}</span>
                <span>{`${formatInteger(strengths.length)} done well`}</span>
                {filtered ? (
                  <span>{`${formatInteger(matched.length)} of ${formatInteger(bundle.findings.length)} shown`}</span>
                ) : null}
              </Meta>
            </div>
          </div>
        </section>
      }
      primary={
        <div class="workbench">
          <div class="workbench-controls">
            <section class="tile">
              <h3 class="rail-title">Filters</h3>
              <div class="filter-bar">
                <SearchField
                  label="Search what was found"
                  value={filter.query}
                  placeholder="title, explanation, part, tag"
                  onChange={(query) => {
                    setFilter({ ...filter, query });
                  }}
                  resultCount={matched.length}
                  resultNoun="result"
                  resultPlural="results"
                />
                <TokenFilter
                  legend="Ready to hand off"
                  selected={filter.goalReadiness}
                  onChange={(goalReadiness) => {
                    setFilter({ ...filter, goalReadiness });
                  }}
                  options={[
                    {
                      value: 'eligible',
                      label: 'Ready',
                      count: bundle.findings.filter((finding) => finding.goalReadiness.eligible)
                        .length,
                    },
                    {
                      value: 'not_eligible',
                      label: 'Needs more first',
                      count: bundle.findings.filter((finding) => !finding.goalReadiness.eligible)
                        .length,
                    },
                  ]}
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
                    count: bundle.findings.filter((finding) => finding.severity === severity)
                      .length,
                  }))}
                />
                <TokenFilter
                  legend="What it is about"
                  selected={filter.categories}
                  onChange={(next) => {
                    setFilter({ ...filter, categories: next });
                  }}
                  options={categories.map((category) => ({
                    value: category,
                    label: humanise(category),
                    count: bundle.findings.filter((finding) => finding.category === category)
                      .length,
                  }))}
                />
                <TokenFilter
                  legend="Good or bad news"
                  selected={filter.polarities}
                  onChange={(polarities) => {
                    setFilter({ ...filter, polarities });
                  }}
                  options={[
                    {
                      value: 'risk',
                      label: 'A problem',
                      count: bundle.findings.filter((finding) => finding.polarity === 'risk')
                        .length,
                    },
                    {
                      value: 'strength',
                      label: 'Done well',
                      count: bundle.findings.filter((finding) => finding.polarity === 'strength')
                        .length,
                    },
                  ]}
                />
                <TokenFilter
                  legend="How it was established"
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
                {`${formatInteger(matched.length)} of ${formatInteger(bundle.findings.length)} match: ${formatInteger(risks.length)} ${risks.length === 1 ? 'problem' : 'problems'} and ${formatInteger(strengths.length)} done well.`}
              </p>
            </section>
          </div>
          <div class="workbench-main">
            <FindingList
              findings={risks}
              title="Problems"
              emptyMessage={
                filtered
                  ? 'Nothing matches the current filters.'
                  : 'Nothing was reported as a problem. That says the rules with enough evidence to fire did not fire. It is not a guarantee about your system.'
              }
              openId={openId}
              filtered={filtered}
              grouped={true}
              onClear={clear}
              refusal={filtered ? null : presentation.primaryRefusal}
            />
          </div>
        </div>
      }
      detail={
        <FindingList
          findings={strengths}
          title="Things this system does well"
          emptyMessage={
            filtered
              ? 'Nothing matches the current filters.'
              : 'Nothing was reported as done well. Saying so takes the same evidence a problem does, and no rule found enough of it.'
          }
          openId={openId}
          filtered={filtered}
          grouped={false}
          onClear={clear}
          refusal={filtered ? null : presentation.detailRefusal}
        />
      }
    />
  );
}
