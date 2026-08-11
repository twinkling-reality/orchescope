import type { Distribution } from '@orchescope/schema';
import { benchmarkCommand } from '../../presentation/commands.ts';
import {
  formatDuration,
  formatInteger,
  formatNumber,
  formatTimestamp,
  humanise,
} from '../../presentation/format.ts';
import { useApp } from '../../store.tsx';
import {
  Data,
  DefinitionList,
  Eyebrow,
  OptionalNumber,
  RefusalPanel,
} from '../../ui/primitives.tsx';

function QuantileCell(props: {
  readonly value: number | undefined;
  readonly withheld: string | null;
}) {
  if (props.withheld !== null) {
    return (
      <span class="muted" title={props.withheld}>
        withheld
      </span>
    );
  }
  return <OptionalNumber value={props.value ?? null} render={formatDuration} />;
}

function DistributionRow(props: { readonly label: string; readonly distribution: Distribution }) {
  const { distribution } = props;
  const withheldFor = (quantile: string): string | null => {
    const entry = distribution.withheld.find((candidate) => candidate.quantile === quantile);
    return entry === undefined
      ? null
      : `${quantile} was not computed: it needs at least ${entry.requiredSamples} samples and this set has ${distribution.sampleSize}.`;
  };
  return (
    <tr>
      <th scope="row">{props.label}</th>
      <td class="num">{formatInteger(distribution.sampleSize)}</td>
      <td class="num">
        <OptionalNumber value={distribution.min ?? null} render={formatDuration} />
      </td>
      <td class="num">
        <QuantileCell value={distribution.p50} withheld={withheldFor('p50')} />
      </td>
      <td class="num">
        <QuantileCell value={distribution.p90} withheld={withheldFor('p90')} />
      </td>
      <td class="num">
        <QuantileCell value={distribution.p95} withheld={withheldFor('p95')} />
      </td>
      <td class="num">
        <QuantileCell value={distribution.p99} withheld={withheldFor('p99')} />
      </td>
      <td class="num">
        <OptionalNumber value={distribution.max ?? null} render={formatDuration} />
      </td>
    </tr>
  );
}

export function BenchmarkEvidence() {
  const app = useApp();
  const firstScenario = app.bundle.scenarios[0]?.id ?? null;
  if (app.bundle.benchmarks.length === 0) {
    return (
      <section class="tile">
        <Eyebrow level={3} count={0}>
          The spread behind each measurement
        </Eyebrow>
        <RefusalPanel
          title="Nothing has been run enough times to have a spread."
          commands={[benchmarkCommand(firstScenario)]}
        >
          <p>This runs the same scenario over and over, changing exactly one thing.</p>
        </RefusalPanel>
      </section>
    );
  }
  return (
    <>
      {app.bundle.benchmarks.map((benchmark) => (
        <section class="tile" key={benchmark.id}>
          <Eyebrow level={3}>Benchmark</Eyebrow>
          <h3 class="mono">{benchmark.id}</h3>
          <p class="lede">
            {`Scenario ${benchmark.scenarioId} version ${benchmark.scenarioVersion}, changing only ${humanise(benchmark.dimension).toLowerCase()}.`}
          </p>
          <DefinitionList
            rows={[
              { label: 'Started', value: formatTimestamp(benchmark.startedAt) },
              { label: 'Finished', value: formatTimestamp(benchmark.finishedAt) },
              {
                label: 'Runs thrown away first',
                value: <Data>{formatInteger(benchmark.warmupRuns)}</Data>,
              },
              {
                label: 'Machine it ran on',
                value: `${benchmark.environment.runtimeName} ${benchmark.environment.runtimeVersion} on ${benchmark.environment.platform} ${benchmark.environment.arch}, ${formatInteger(benchmark.environment.cpuCount)} CPUs${benchmark.environment.loadAverage1m === undefined ? '' : `, load ${formatNumber(benchmark.environment.loadAverage1m)}`}`,
              },
            ]}
          />
          {benchmark.limitations.length === 0 ? null : (
            <RefusalPanel title="What these numbers do not prove">
              <ul class="plain">
                {benchmark.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </RefusalPanel>
          )}
          {benchmark.variants.map((variant) => (
            <div class="group" key={variant.variantId}>
              <Eyebrow level={4}>{`Variant ${variant.variantId}`}</Eyebrow>
              <p class="note">
                {`${formatInteger(variant.repetitions)} repetitions, ${formatInteger(variant.completedRuns)} completed, ${formatInteger(variant.failedRuns)} failed${variant.successRate === undefined ? '' : `, success rate ${formatNumber(variant.successRate * 100, 1)}%`}.`}
              </p>
              <div class="scroll-x">
                <table class="table">
                  <thead>
                    <tr>
                      <th scope="col">What was measured</th>
                      <th scope="col">How many runs</th>
                      <th scope="col">Min</th>
                      <th scope="col">p50</th>
                      <th scope="col">p90</th>
                      <th scope="col">p95</th>
                      <th scope="col">p99</th>
                      <th scope="col">Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    <DistributionRow label="Duration" distribution={variant.durationMs} />
                    {variant.timeToFirstOutputMs === undefined ? null : (
                      <DistributionRow
                        label="Time to first output"
                        distribution={variant.timeToFirstOutputMs}
                      />
                    )}
                    <DistributionRow label="Total tokens" distribution={variant.totalTokens} />
                    {variant.costUsd === undefined ? null : (
                      <DistributionRow label="Cost" distribution={variant.costUsd} />
                    )}
                    <DistributionRow label="Model calls" distribution={variant.modelCalls} />
                    <DistributionRow label="Tool calls" distribution={variant.toolCalls} />
                    <DistributionRow label="Retries" distribution={variant.retries} />
                  </tbody>
                </table>
              </div>
              {[
                variant.durationMs,
                variant.totalTokens,
                variant.modelCalls,
                variant.toolCalls,
                variant.retries,
              ].some((distribution) => distribution.withheld.length > 0) ? (
                <div class="withheld">
                  <p class="note">Held back because too few runs to say anything:</p>
                  <ul class="plain small">
                    {variant.durationMs.withheld.map((entry) => (
                      <li key={`duration-${entry.quantile}`}>
                        {`Duration ${entry.quantile}: needs ${formatInteger(entry.requiredSamples)} samples, has ${formatInteger(variant.durationMs.sampleSize)}.`}
                      </li>
                    ))}
                    {variant.totalTokens.withheld.map((entry) => (
                      <li key={`tokens-${entry.quantile}`}>
                        {`Total tokens ${entry.quantile}: needs ${formatInteger(entry.requiredSamples)} samples, has ${formatInteger(variant.totalTokens.sampleSize)}.`}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
