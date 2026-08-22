# Repository federation

Federation answers one bounded question: which declarations in separately versioned repositories participated
in the same observed runtime crossing?

Start the complete multi-process system under `trace` from the repository that will own the stored run. Then
name every repository root to `federate`:

```sh
orchescope --cwd services/client trace -- node src/main.js
orchescope --cwd services/client federate \
  --repository . \
  --repository ../tool-server \
  --runs 10
```

Each root is scanned into its own closed graph. The root list locates work and supplies no observed identity.
A graph is eligible only when Git supplies a canonical repository URL, a full clean revision and, for a package
subroot, the path from the Git top level.

A runtime component joins only when its span independently carries that same repository URL and revision plus a
source file that selects exactly one declaration. A cross-repository relation needs two such endpoint joins and
independent causal evidence, such as a server span retaining the client request span as its W3C parent. Shared
names, compatible package versions, one trace identifier, process ancestry and the repository list do not fill a
missing input.

The terminal result shows eligible repositories, source-qualified component joins, accepted crossings and grouped
refusals. JSON includes the same bounded projection:

```sh
orchescope --cwd services/client federate \
  --repository . \
  --repository ../tool-server \
  --runs 10 \
  --json
```

Use `--export-json <relative-path>` for the complete version 1 `FederationReport`. It embeds each independently
scanned graph once, including declaration evidence and file hashes, then adds repository-qualified runtime joins,
cross-repository observations and per-field source provenance. The export path must remain inside the runtime
workspace. Federation reports are not written to the database.

The command accepts two to eight distinct roots and zero to fifty recent runs. `--runs 0` is a useful static check:
it proves the roots are eligible and produces no runtime join. Missing or stale identity is reported as a refusal;
it never falls back to a component name.

Coding agents can call `federate_agent_system` over MCP with the same roots and run bound. Its output is smaller than
the complete export and retains the accepted references, coverage and refusal reasons needed to decide whether a
crossing is established.

Repository source, generated source maps and trace attributes are untrusted inputs. Federation validates and bounds
them and applies the normal redaction boundary, but it does not make executing an agent system or tracing it safe.
