import { basisDescriptors } from '../../presentation/basis.ts';
import { orderedCapabilities } from '../../presentation/capabilities.ts';
import { groupByReason } from '../../presentation/filters.ts';
import { formatBytes, formatDuration, formatInteger, humanise } from '../../presentation/format.ts';
import type { OverviewContextPresentation } from '../../presentation/overview-presentation.ts';
import { useApp } from '../../store.tsx';
import {
  BasisChip,
  Data,
  DisclosureRow,
  Figure,
  Meta,
  Share,
  State,
} from '../../ui/primitives.tsx';
import { TileMenu } from '../../ui/tile-menu.tsx';

function CoverageCard(props: { readonly presentation: OverviewContextPresentation }) {
  const app = useApp();
  const coverage = app.bundle.graph.coverage;
  const capabilities = orderedCapabilities(app.capabilities);
  const skipped = groupByReason(
    coverage.skipped.map((entry) => ({ reason: entry.reason, file: entry.file })),
  );
  return (
    <section class="tile overview-coverage has-menu">
      <h3 class="overview-panel-title">What the scan could read</h3>
      {/* A file the scan opened and could not read is the remainder of a known total, so this is a
          share like the other two in this row. It is the number that says how much to trust everything
          else on the screen, and it used to be one stat among three. */}
      <Share
        fraction={props.presentation.readFiles}
        label="of the files it opened"
        doneLabel="read"
        remainingLabel="skipped"
        basis="discovered"
        emptyLabel="no file to read"
      />
      <Figure
        value={formatInteger(props.presentation.componentCount)}
        of={`${formatInteger(props.presentation.edgeCount)} connections between them`}
        nil={props.presentation.componentCount === 0}
      />
      <Meta>
        <BasisChip basis="discovered" />
        <span>things your system is built from</span>
      </Meta>
      <Meta>
        <span>{`${formatInteger(props.presentation.filesSkipped)} skipped`}</span>
        <span>{`scanned in ${formatDuration(props.presentation.scanDurationMs)}`}</span>
      </Meta>
      {props.presentation.truncated ? (
        <p class="note">
          The scan stopped early on a deadline or a resource limit, so this picture is partial. What
          is missing is unknown, which is different from knowing that nothing is missing.
        </p>
      ) : null}
      <TileMenu label="Open skipped files, adapters, what each evidence word means and what this report can do">
        <h4 class="overview-menu-title">What the scan did, in detail</h4>
        <DisclosureRow title="How much source was read">
          <p>{`${formatBytes(props.presentation.bytesParsed)}, read from the repository.`}</p>
        </DisclosureRow>
        {coverage.unsupported.length === 0 ? null : (
          <div class="group">
            <h5>Things this build cannot make sense of</h5>
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
        <DisclosureRow
          title="Which readers ran over this repository"
          count={coverage.adapters.length}
        >
          {coverage.adapters.length === 0 ? (
            <p>No reader run was recorded.</p>
          ) : (
            <div class="scroll-x">
              <table class="table">
                <thead>
                  <tr>
                    <th scope="col">Reader</th>
                    <th scope="col">Ecosystem</th>
                    <th scope="col">Status</th>
                    <th scope="col">Parts</th>
                    <th scope="col">Connections</th>
                    <th scope="col">Files</th>
                    <th scope="col">Time</th>
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
        {/* The six evidence words stay. They are the closed vocabulary the whole product rests on, each
            one names a different way a claim was established, and no plain substitute keeps the six
            apart. What changes is that the gloss is here rather than assumed. */}
        <DisclosureRow title="What each evidence word means">
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
          <DisclosureRow title="What you can do from this report">
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
      </TileMenu>
    </section>
  );
}

export function OverviewContext(props: { readonly presentation: OverviewContextPresentation }) {
  return <CoverageCard presentation={props.presentation} />;
}
