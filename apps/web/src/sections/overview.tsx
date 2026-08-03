/**
 * The overview leads with the delta, because the delta is the only thing here that neither a static
 * scanner nor an observability tool can compute on its own.
 *
 * Order is the argument. An input this repository wrote and Orchescope could not read comes first,
 * because it changes what everything below it means. Then the delta. Then the three things worth
 * acting on. Then the next step. What was inspected and what the vocabulary means are looked up rather
 * than read, so they fold away, but their counts stay visible: a report that does not say what it
 * failed to inspect is not evidence.
 */

import { basisDescriptors, SEVERITY_ORDER } from '../basis.ts';
import { orderedCapabilities } from '../capabilities.ts';
import { auditCommand, importTraceCommand, manifestCommand, traceCommand } from '../commands.ts';
import { buildDeltaBar } from '../delta-bar.ts';
import { groupByReason, sortFindings } from '../filters.ts';
import { formatBytes, formatDuration, formatInteger, formatPercent, humanise } from '../format.ts';
import { deltaHeadline } from '../headline.ts';
import { failedAdapters, nextActions } from '../next-actions.ts';
import { useApp } from '../store.tsx';
import {
  BasisChip,
  CommandBlock,
  Data,
  DeclarationBar,
  DefinitionList,
  DisclosureRow,
  Display,
  EvidenceKey,
  Eyebrow,
  Figure,
  Meta,
  RefusalPanel,
  RuledStat,
  SeverityMark,
  State,
  StatRow,
} from '../ui/primitives.tsx';

const TOP_RISK_COUNT = 3;

/**
 * An input the project wrote on purpose that Orchescope could not use. Never folded away, and always
 * first: whatever that file declared is missing from every number below it.
 */
function InputProblems() {
  const app = useApp();
  const failed = failedAdapters(app.bundle);
  if (failed.length === 0) {
    return null;
  }
  return (
    <section class="tile">
      <Eyebrow level={3}>Incomplete input</Eyebrow>
      <RefusalPanel
        title="An input this repository wrote on purpose could not be read, so what it declared is missing here."
        commands={[auditCommand()]}
      >
        <ul class="plain">
          {failed.map((adapter) => (
            <li key={adapter.id}>
              <span class="mono">{adapter.id}</span>
              <span>{`: ${adapter.detail}`}</span>
            </li>
          ))}
        </ul>
      </RefusalPanel>
    </section>
  );
}

/**
 * How the observed names were joined to the declarations.
 *
 * Every join is made by a rule and the rules are not equally strong. A match on a code location is the
 * observation and the declaration pointing at the same line. A match on kind and name alone is correct
 * whenever a name means one thing in a repository and wrong when two modules use the same word, which
 * has already happened here. The bar above is only as good as its weakest join, so the weakest join is
 * named beside it rather than buried.
 */
function Joins() {
  const app = useApp();
  const delta = app.bundle.reconciliation;
  if (delta === undefined) {
    return null;
  }
  const { joins } = delta;
  const total = joins.byCodeLocation + joins.byRuntimeName + joins.byKindAndName;
  if (total === 0 && joins.ambiguous.length === 0) {
    return null;
  }
  return (
    <>
      {joins.onNameAlone.length === 0 ? null : (
        <p class="note">
          {`${formatInteger(joins.onNameAlone.length)} of these joins rest on a kind and a name alone, which is the weakest rule and can match a different module: `}
          <span class="mono">{joins.onNameAlone.join(', ')}</span>
        </p>
      )}
      {joins.ambiguous.length === 0 ? null : (
        <p class="note">
          {`${formatInteger(joins.ambiguous.length)} observed names matched more than one declaration and were joined to none, so they count as neither exercised nor undeclared: `}
          <span class="mono">{joins.ambiguous.join(', ')}</span>
        </p>
      )}
    </>
  );
}

function DeltaDetail() {
  const app = useApp();
  const delta = app.bundle.reconciliation;
  if (delta === undefined) {
    return null;
  }
  const { coverage, joins } = delta;
  return (
    <DisclosureRow title="How the delta was computed">
      <DefinitionList
        rows={[
          {
            label: 'Component rate',
            value:
              coverage.componentExerciseRate === undefined
                ? 'not computable without runs'
                : `${formatPercent(coverage.componentExerciseRate)}, ${formatInteger(coverage.exercisedComponents)} of ${formatInteger(coverage.declaredComponents)}`,
          },
          {
            label: 'Relation rate',
            value:
              coverage.edgeExerciseRate === undefined
                ? 'not computable without runs'
                : `${formatPercent(coverage.edgeExerciseRate)}, ${formatInteger(coverage.exercisedEdges)} of ${formatInteger(coverage.declaredEdges)}`,
          },
          {
            label: 'Joined by',
            value: `${formatInteger(joins.byCodeLocation)} code location, ${formatInteger(joins.byRuntimeName)} runtime name, ${formatInteger(joins.byKindAndName)} kind and name alone`,
          },
          {
            label: 'Runs considered',
            value:
              delta.declaredNotExercised.runIds.length === 0
                ? 'none recorded'
                : delta.declaredNotExercised.runIds.join(', '),
            code: delta.declaredNotExercised.runIds.length > 0,
          },
          {
            label: 'Static side read at',
            value:
              delta.revision === undefined
                ? 'not recorded'
                : `${delta.revision.ref ?? 'unknown ref'} ${delta.revision.commit ?? ''} ${delta.revision.dirty ? '(working tree dirty)' : '(working tree clean)'}`,
          },
        ]}
      />
    </DisclosureRow>
  );
}

function Contradictions() {
  const app = useApp();
  const delta = app.bundle.reconciliation;
  if (delta === undefined || delta.contradictions.length === 0) {
    return null;
  }
  return (
    <DisclosureRow title="Contradictions" count={delta.contradictions.length}>
      <p>A declaration an observation disagrees with. Neither side is assumed to be right.</p>
      <div class="scroll-x">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Component</th>
              <th scope="col">Kind</th>
              <th scope="col">Declared</th>
              <th scope="col">Observed</th>
            </tr>
          </thead>
          <tbody>
            {delta.contradictions.map((contradiction) => (
              <tr key={`${contradiction.componentId}:${contradiction.kind}`}>
                <th scope="row">
                  <button
                    type="button"
                    class="link-button"
                    onClick={() => {
                      app.selectComponent(contradiction.componentId, { goToMap: true });
                    }}
                  >
                    {contradiction.componentId}
                  </button>
                </th>
                <td>{humanise(contradiction.kind)}</td>
                <td>{contradiction.declared}</td>
                <td>{contradiction.observed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DisclosureRow>
  );
}

function DuplicateSideEffects() {
  const app = useApp();
  const delta = app.bundle.reconciliation;
  if (delta === undefined || delta.duplicateSideEffects.length === 0) {
    return null;
  }
  return (
    <DisclosureRow title="Repeated side effects" count={delta.duplicateSideEffects.length}>
      <p>
        The same logical operation, more than once inside a single run. Occurrences are counted in
        the run that repeated it most, because that is the number that means duplication.
      </p>
      <div class="scroll-x">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Operation</th>
              <th scope="col">Component</th>
              <th scope="col">Occurrences</th>
              <th scope="col">Retry attempts</th>
              <th scope="col">Idempotency key</th>
            </tr>
          </thead>
          <tbody>
            {delta.duplicateSideEffects.map((duplicate) => (
              <tr key={duplicate.key}>
                <th scope="row" class="mono">
                  {duplicate.key}
                </th>
                <td>{duplicate.componentId ?? 'not attributed'}</td>
                <td class="num">{formatInteger(duplicate.occurrences)}</td>
                <td class="num">
                  {duplicate.retryAttempts.length === 0
                    ? 'none recorded'
                    : duplicate.retryAttempts.join(', ')}
                </td>
                <td>
                  <State
                    value={duplicate.idempotencyKeyPresent}
                    trueLabel="present"
                    falseLabel="absent"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DisclosureRow>
  );
}

/** The hero. One bar, one cell per declared component, filled where a run reached it. */
function Delta() {
  const app = useApp();
  const { bundle } = app;
  const delta = bundle.reconciliation;

  if (delta === undefined) {
    return (
      <section class="tile is-band">
        <Eyebrow level={3}>Declared against exercised</Eyebrow>
        <RefusalPanel
          title="No run has been ingested, so there is no delta."
          commands={[traceCommand(), importTraceCommand(), auditCommand()]}
        >
          <p>
            The delta compares what this repository declares with what an execution actually
            reaches. It needs at least one run. Wrap the system once, or import spans you already
            have, then audit again.
          </p>
        </RefusalPanel>
      </section>
    );
  }

  const { coverage } = delta;
  const neverExercised = delta.declaredNotExercised.components.length;
  const neverDeclared = delta.exercisedNotDeclared.components.length;

  if (coverage.declaredComponents === 0) {
    return (
      <section class="tile is-band">
        <Eyebrow level={3}>Declared against exercised</Eyebrow>
        <RefusalPanel
          title="This repository declares nothing, so there is nothing for a run to be measured against."
          commands={[manifestCommand(), auditCommand()]}
        >
          <p>
            {neverDeclared === 0
              ? 'The scan found no declared component. What could not be inspected is listed below.'
              : `${formatInteger(neverDeclared)} components were observed running and none of them is declared anywhere this scan could read. A manifest is how a system this build cannot parse from source gets into the graph.`}
          </p>
        </RefusalPanel>
      </section>
    );
  }

  const bar = buildDeltaBar({
    declared: coverage.declaredComponents,
    exercised: coverage.exercisedComponents,
    exercisedNotDeclared: neverDeclared,
  });

  return (
    <section class="tile is-band">
      <Eyebrow level={3}>Declared against exercised</Eyebrow>
      {/* The sentence the data makes on the left, and everything that measures it on the right. The
          sentence sets 24 characters to a line whatever the window does and the bar wants every pixel
          it can get, so beside each other they spend the width on the two things that can use it. */}
      <div class="lead-head">
        <Display
          segments={deltaHeadline({
            declared: coverage.declaredComponents,
            neverExercised,
            exercisedNotDeclared: neverDeclared,
          })}
        />
        <div class="lead-measure">
          <Figure
            value={
              coverage.componentExerciseRate === undefined
                ? 'no rate'
                : formatPercent(coverage.componentExerciseRate)
            }
            of={`${formatInteger(coverage.exercisedComponents)} of ${formatInteger(coverage.declaredComponents)} exercised · ${formatInteger(bundle.summary.runCount)} ${bundle.summary.runCount === 1 ? 'run' : 'runs'}`}
            nil={coverage.componentExerciseRate === undefined}
          />
          <DeclarationBar bar={bar} />
          <EvidenceKey
            exercised={coverage.exercisedComponents}
            neverExercised={neverExercised}
            neverDeclared={neverDeclared}
          />
          <Joins />
        </div>
      </div>

      <StatRow>
        <RuledStat
          value={formatInteger(delta.declaredNotExercised.edges.length)}
          label="Relations never exercised"
          basis="inferred"
          nil={delta.declaredNotExercised.edges.length === 0}
        />
        <RuledStat
          value={formatInteger(delta.exercisedNotDeclared.edges.length)}
          label="Relations never declared"
          basis="observed"
          nil={delta.exercisedNotDeclared.edges.length === 0}
        />
        <RuledStat
          value={formatInteger(delta.contradictions.length)}
          label="Contradictions"
          basis="observed"
          nil={delta.contradictions.length === 0}
        />
        <RuledStat
          value={formatInteger(delta.duplicateSideEffects.length)}
          label="Repeated side effects"
          basis="observed"
          nil={delta.duplicateSideEffects.length === 0}
        />
      </StatRow>

      <div class="group">
        <Contradictions />
        <DuplicateSideEffects />
        <DeltaDetail />
      </div>
    </section>
  );
}

/**
 * The row under the band: what to act on, what was read, what to do next and how to read this, each a
 * tile with its detail behind a `···`.
 *
 * The overview used to be five blocks stacked, which is three screenfuls before a reader reaches what
 * the scan could not read. A summary that has to be scrolled is not a summary, so the summary is the
 * tile and the evidence is one disclosure away.
 *
 * The row is unequal on purpose. What to act on is the anchor at four of twelve and it is the dark
 * ground; what was read is the stage at five, because four ruled numbers and their bases want the
 * width; what to do next and how to read this are a stack of three, because each is a short list.
 */

/** The worst findings, one line each. The card opens to why they matter and what to do. */
function TopRisksCard() {
  const app = useApp();
  const { bundle } = app;
  const risks = sortFindings(bundle.findings.filter((finding) => finding.polarity === 'risk'));

  if (risks.length === 0) {
    return (
      <section class="tile is-anchor">
        <div class="tile-head">
          <Eyebrow level={3}>What to act on</Eyebrow>
        </div>
        <div class="tile-body">
          <p class="lede">
            No risk was reported. That is a statement about the rules that had enough evidence to
            fire, not a guarantee about the system.
          </p>
          {bundle.summary.strengthCount === 0 ? null : (
            <p class="more">
              <button
                type="button"
                class="link-button"
                onClick={() => {
                  app.navigate('findings');
                }}
              >
                {`${formatInteger(bundle.summary.strengthCount)} strengths were recorded`}
              </button>
            </p>
          )}
        </div>
      </section>
    );
  }

  const shown = risks.slice(0, TOP_RISK_COUNT);
  return (
    <section class="tile is-anchor">
      <div class="tile-head">
        <Eyebrow level={3}>What to act on</Eyebrow>
        <Data title="Risks in this report.">{formatInteger(risks.length)}</Data>
      </div>
      <div class="tile-body">
        <p class="lede">
          {`${formatInteger(shown.length)} of ${formatInteger(risks.length)}, by severity then confidence.`}
        </p>
        <ul class="stack">
          {shown.map((finding) => (
            <li key={finding.id}>
              <button
                type="button"
                class="stack-row"
                onClick={() => {
                  app.navigate('findings', { finding: finding.id });
                }}
              >
                <SeverityMark severity={finding.severity} />
                <span class="stack-title">{finding.title}</span>
                <span class="stack-meta">
                  <Data>{formatInteger(finding.evidence.length)}</Data>
                  {' evidence'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <details class="tile-more">
        <summary>
          <span class="visually-hidden">What each of these risks says, and what to do</span>
          <span aria-hidden="true">···</span>
        </summary>
        <div class="tile-more-body">
          {shown.map((finding) => (
            <DisclosureRow
              key={finding.id}
              title={finding.title}
              meta={
                <>
                  <BasisChip basis={finding.basis} />
                  {' · '}
                  <Data title="Confidence in this claim, from 0 to 1.">
                    {finding.confidence.toFixed(2)}
                  </Data>
                </>
              }
              lead={<SeverityMark severity={finding.severity} />}
            >
              <p>{finding.impact}</p>
              <DefinitionList
                rows={[
                  {
                    label: 'Evidence',
                    value:
                      finding.sourceLocations.length === 0
                        ? `${formatInteger(finding.evidence.length)} records, in the findings section`
                        : finding.sourceLocations
                            .slice(0, 3)
                            .map((location) => (
                              <span
                                class="mono"
                                key={`${location.file}:${location.startLine}`}
                              >{`${location.file}:${location.startLine} `}</span>
                            )),
                  },
                  ...(finding.recommendation === undefined
                    ? []
                    : [
                        { label: 'Fix', value: finding.recommendation.summary },
                        {
                          label: 'Effort',
                          value: `${finding.recommendation.effort}, change risk ${finding.recommendation.risk}. Both are design judgements rather than measurements.`,
                        },
                      ]),
                ]}
              />
            </DisclosureRow>
          ))}
          <p class="more">
            <button
              type="button"
              class="link-button"
              onClick={() => {
                app.navigate('findings');
              }}
            >
              {`All ${formatInteger(bundle.findings.length)} findings and ${formatInteger(bundle.summary.strengthCount)} strengths`}
            </button>
          </p>
        </div>
      </details>
    </section>
  );
}

/** Derived from this report. Each step produces evidence the next one needs. */
function NextStepsCard() {
  const app = useApp();
  const actions = nextActions(app.bundle);
  if (actions.length === 0) {
    return null;
  }
  return (
    <section class="tile">
      <div class="tile-head">
        <Eyebrow level={3}>What to do next</Eyebrow>
        <Data>{formatInteger(actions.length)}</Data>
      </div>
      <div class="tile-body">
        <p class="lede">Each step produces evidence the next one needs.</p>
        <ul class="stack">
          {actions.map((action) => (
            <li key={action.title}>
              <span class="stack-row is-static">
                <span class="stack-title">{action.title}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <details class="tile-more">
        <summary>
          <span class="visually-hidden">Why each step, and the command that performs it</span>
          <span aria-hidden="true">···</span>
        </summary>
        <div class="tile-more-body">
          {actions.map((action) => (
            <DisclosureRow key={action.title} title={action.title} open={true}>
              <p>{action.reason}</p>
              {action.commands.map((argv) => (
                <CommandBlock key={argv.join(' ')} argv={argv} />
              ))}
            </DisclosureRow>
          ))}
        </div>
      </details>
    </section>
  );
}

/** What the scan read, and everything it could not. The counts stay; their tables fold. */
function CoverageCard() {
  const app = useApp();
  const coverage = app.bundle.graph.coverage;
  const summary = app.bundle.summary;
  const skipped = groupByReason(
    coverage.skipped.map((entry) => ({ reason: entry.reason, file: entry.file })),
  );
  return (
    <section class="tile is-stage">
      <div class="tile-head">
        <Eyebrow level={3}>What was read</Eyebrow>
      </div>
      <div class="tile-body">
        <StatRow>
          <RuledStat
            value={formatInteger(summary.componentCount)}
            label={`Components, across ${formatInteger(summary.edgeCount)} relations`}
            basis="discovered"
          />
          <RuledStat
            value={formatInteger(coverage.filesParsed)}
            label={`Files parsed, ${formatBytes(coverage.bytesParsed)}`}
            basis="discovered"
          />
          <RuledStat
            value={formatInteger(coverage.skipped.length)}
            label="Files skipped"
            basis="discovered"
            nil={coverage.skipped.length === 0}
          />
          <RuledStat
            value={formatDuration(coverage.durationMs)}
            label="Scan duration"
            basis="observed"
          />
        </StatRow>
        {coverage.truncated ? (
          <p class="note">
            The scan was cut short by a deadline or a resource limit, so this graph is partial. What
            is missing is unknown, which is different from knowing that nothing is missing.
          </p>
        ) : null}
      </div>
      <details class="tile-more">
        <summary>
          <span class="visually-hidden">
            What was skipped, which adapters ran, and what was seen
          </span>
          <span aria-hidden="true">···</span>
        </summary>
        <div class="tile-more-body">
          {coverage.unsupported.length === 0 ? null : (
            <div class="group">
              <Eyebrow level={4} count={coverage.unsupported.length}>
                Areas this build cannot model
              </Eyebrow>
              <ul class="plain small">
                {coverage.unsupported.map((area) => (
                  <li key={area.area}>
                    <span class="mono">{area.area}</span>
                    <p class="muted">{area.reason}</p>
                    {area.remediation === undefined ? null : <p>{area.remediation}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <DisclosureRow title="Skipped files by reason" count={coverage.skipped.length}>
            {skipped.length === 0 ? (
              <p>No file was skipped.</p>
            ) : (
              <ul class="plain small">
                {skipped.map((group) => (
                  <li key={group.reason}>
                    <span>{humanise(group.reason)}</span>
                    <Data>{` ${formatInteger(group.count)} `}</Data>
                    <span class="muted mono">{group.examples.join(', ')}</span>
                    {group.count > group.examples.length ? (
                      <span class="muted">{` and ${formatInteger(group.count - group.examples.length)} more, not listed`}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </DisclosureRow>

          <DisclosureRow title="Adapters that ran" count={coverage.adapters.length}>
            {coverage.adapters.length === 0 ? (
              <p>No adapter run was recorded.</p>
            ) : (
              <div class="scroll-x">
                <table class="table">
                  <thead>
                    <tr>
                      <th scope="col">Adapter</th>
                      <th scope="col">Ecosystem</th>
                      <th scope="col">Status</th>
                      <th scope="col">Components</th>
                      <th scope="col">Relations</th>
                      <th scope="col">Files</th>
                      <th scope="col">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverage.adapters.map((adapter) => (
                      <tr key={`${adapter.adapterId}@${adapter.adapterVersion}`}>
                        <th scope="row" class="mono">
                          {`${adapter.adapterId} ${adapter.adapterVersion}`}
                        </th>
                        <td>{humanise(adapter.ecosystem)}</td>
                        <td title={adapter.detail ?? humanise(adapter.status)}>
                          {humanise(adapter.status)}
                        </td>
                        <td class="num">{formatInteger(adapter.componentsFound)}</td>
                        <td class="num">{formatInteger(adapter.edgesFound)}</td>
                        <td class="num">{formatInteger(adapter.filesInspected)}</td>
                        <td class="num">{formatDuration(adapter.durationMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DisclosureRow>

          {coverage.languages.length === 0 ? null : (
            <DisclosureRow title="Languages seen" count={coverage.languages.length}>
              <Meta>
                {coverage.languages.map((language) => (
                  <span key={language.language}>
                    {`${language.language} ${formatInteger(language.fileCount)}`}
                  </span>
                ))}
              </Meta>
            </DisclosureRow>
          )}
        </div>
      </details>
    </section>
  );
}

/** The conventions this page uses, and what it can do from here. Looked up, never read. */
function ReferenceCard() {
  const app = useApp();
  const capabilities = orderedCapabilities(app.capabilities);
  const severities = SEVERITY_ORDER.filter(
    (severity) => (app.bundle.summary.findingCountBySeverity[severity] ?? 0) > 0,
  );
  // A severity this build does not rank belongs beside the key that explains the ranks, rather than
  // as a loose sentence under the row: in a bento there is no ground for a paragraph to sit on.
  const unranked = Object.keys(app.bundle.summary.findingCountBySeverity).filter(
    (severity) => !SEVERITY_ORDER.includes(severity as (typeof SEVERITY_ORDER)[number]),
  );
  return (
    <section class="tile">
      <div class="tile-head">
        <Eyebrow level={3}>How to read this</Eyebrow>
      </div>
      <div class="tile-body">
        <ul class="key">
          <li>
            <i class="cell met" />
            Filled: measured in a run
          </li>
          <li>
            <i class="cell unmet" />
            Outlined: only declared
          </li>
        </ul>
        {severities.length === 0 ? null : (
          <ul class="key">
            {severities.map((severity) => (
              <li key={severity}>
                <button
                  type="button"
                  class="link-button"
                  onClick={() => {
                    app.navigate('findings', { severity });
                  }}
                >
                  <SeverityMark severity={severity} />
                  <Data>
                    {` ${formatInteger(app.bundle.summary.findingCountBySeverity[severity] ?? 0)}`}
                  </Data>
                </button>
              </li>
            ))}
          </ul>
        )}
        {unranked.length === 0 ? null : (
          <p class="note">
            {`This report also counts findings at ${unranked.join(', ')}, which this page does not rank.`}
          </p>
        )}
      </div>
      <details class="tile-more">
        <summary>
          <span class="visually-hidden">
            What each evidence class means, and what this report can do
          </span>
          <span aria-hidden="true">···</span>
        </summary>
        <div class="tile-more-body">
          <p class="note">
            The distinction is carried by form and never by hue, so it survives greyscale, a colour
            vision deficiency and a printed page. The two alert hues on this page mark severity, and
            the one accent marks the interface. Neither ever marks a measurement.
          </p>
          <DisclosureRow title="What each evidence class means">
            <dl class="definitions">
              {basisDescriptors().map((descriptor) => (
                <div class="definition" key={descriptor.value}>
                  <dt>{descriptor.label}</dt>
                  <dd>{descriptor.meaning}</dd>
                </div>
              ))}
            </dl>
          </DisclosureRow>
          {capabilities.length === 0 ? null : (
            <DisclosureRow title="What this report can do from here" count={capabilities.length}>
              <p>Actions this page offers, and the reason for each one that is unavailable.</p>
              <div class="scroll-x">
                <table class="table">
                  <thead>
                    <tr>
                      <th scope="col">Action</th>
                      <th scope="col">Available</th>
                      <th scope="col">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {capabilities.map((capability) => (
                      <tr key={capability.name}>
                        <th scope="row">{humanise(capability.name)}</th>
                        <td>
                          <State value={capability.available} />
                        </td>
                        <td>{capability.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DisclosureRow>
          )}
        </div>
      </details>
    </section>
  );
}

export function OverviewSection() {
  return (
    <div class="bento">
      <InputProblems />
      <Delta />
      <TopRisksCard />
      <CoverageCard />
      <div class="tile-stack">
        <NextStepsCard />
        <ReferenceCard />
      </div>
    </div>
  );
}
