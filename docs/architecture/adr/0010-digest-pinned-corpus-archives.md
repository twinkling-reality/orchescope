# ADR 0010: Required corpus source arrives as bounded commit archives

- Status: accepted
- Date: 2026-08-22
- Deciders: repository maintainers

## Context

The required corpus job measures two local entries. Eighteen static third-party entries run only in the
optional live job because their pinned Git repositories need network access and their source cannot be
committed under Orchescope's Apache-2.0 licence. That protects distribution boundaries, but it leaves the
required gate unable to catch most adapter drift against source the adapter author did not write.

Two acquisition forms can keep third-party source outside the repository:

1. a shallow Git fetch of one full commit into the ignored corpus cache; or
2. a source archive requested for one full commit, verified and expanded into that same ignored cache.

Both need network access on a fresh runner. A clone supplies Git's object identity and an efficient warm
checkout. It also carries a `.git` database that discovery does not read. An archive is smaller and contains
only the source that discovery measures, but the compressed file is not a stable security pin. GitHub states
that a full commit archive retains the same extracted file contents while its compression settings and byte
layout may change. Pinning the gzip digest would therefore make a required gate fail after a permitted hosting
change even though every measured source byte stayed the same.

GitHub recommends the archive REST API with a commit ID when reproducible extracted contents matter. It also
recommends release assets rather than generated source downloads when consumers rely on the archive container
itself as a security boundary. Corpus entries pin arbitrary commits, and upstream projects do not publish an
immutable release asset for every one. A required archive reader must consequently treat the container as
untrusted input rather than handing it to a general extractor.

Source: <https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives>

## Falsifier stated before implementation

This decision is rejected unless all of these conditions hold:

1. A required entry names an HTTPS archive URL containing its exact 40 character commit, a normalized source
   tree SHA-256, a licence path and the exact SHA-256 of that licence file.
2. The reader bounds compressed bytes, expanded bytes, entry count and individual file bytes before writing a
   checkout. It rejects invalid headers, path traversal, absolute paths, links, devices, duplicate paths,
   multiple roots, unsupported metadata and any digest mismatch.
3. The source tree digest is independent of the generated archive root name, timestamps, owner metadata and
   compression bytes. It includes every regular file path, executable bit and raw content in sorted order.
4. A changed compressed representation with identical bounded source entries produces the same tree digest.
   A changed path, executable bit or file byte produces a different digest.
5. A fresh required run downloads only the explicitly marked archive entries. A full corpus run keeps using
   the pinned Git commits, and the offline mode remains genuinely network free.
6. Neither archive bytes nor expanded third-party source becomes a tracked file, package input or CI artifact.
7. Every required third-party entry reproduces its existing expectation, claim polarity and generated negative
   invariants from the archive checkout.
8. The required job remains bounded enough to run on every pull request without credentials.

## Decision

Add a distinct `--required` corpus mode. It measures both local entries plus a small, explicit set of Git
entries carrying a `requiredArchive` block. Full and exercised corpus modes retain shallow Git acquisition.
`--offline` retains local-only acquisition, so its name keeps its literal meaning.

The archive block contains:

- the GitHub archive REST URL for the entry's exact commit;
- a normalized source tree SHA-256;
- the repository-relative licence path; and
- the licence file SHA-256.

The reader downloads at most 8 MiB, expands at most 16 MiB, accepts at most 2,048 archive entries and permits
no file over 1 MiB. It reads the generated tar container itself, verifies its checksums and one-root structure,
and accepts only directories, regular files and the bounded global commit comment GitHub emits. Links and every
other entry kind are refusals. No external extractor processes unverified input.

The normalized digest covers sorted root-relative file paths, executable bits, lengths and exact file bytes.
Archive root names, timestamps, owners, the global comment and gzip bytes are excluded. The global comment must
still equal the pinned commit, and the normalized digest must equal the corpus pin before any source is made
available to discovery. The exact licence file must then be present under its pinned digest.

Adopt three existing static entries:

- `open-agent-platform`, the client-only negative whose 11 generated injections keep framework and protocol
  imports from becoming declarations;
- `openai-cs-agents-demo`, a compact application that contributes OpenAI Agents, effects and prompt facts; and
- `vercel-ai-chatbot`, a compact application that contributes Vercel AI SDK, implementation-reach, effects and
  prompt facts.

The first two pinned revisions carry MIT licence files and the third carries Apache-2.0. Their source remains
transient and ignored, just as it does in the clone-backed live corpus.

## Measurement before implementation

The pristine cached clones for `open-agent-platform`, `openai-cs-agents-demo` and `vercel-ai-chatbot` occupy
1,754,871, 2,177,544 and 1,672,848 bytes. That is 5,605,263 bytes of tracked source and Git storage before audit
state.

The corresponding full-commit archives measured 339,273, 704,883 and 401,580 compressed bytes, expanding to
1,288,357 bytes across 229 files, 1,409,011 bytes across 43 files and 1,179,283 bytes across 181 files. Two
downloads of every archive produced the same normalized tree digest, and every normalized archive tree matched
the corresponding pinned Git tree. The outer archive digests also repeated in this sample, but the decision does
not depend on that observation.

Together the proposed archive inputs are 1,445,736 compressed bytes and 3,876,651 expanded source bytes across
453 files, 74.2% less compressed input than the pristine clone footprint. Cold archive materialization measured
about 1.34 seconds of fetch time and 0.08 seconds of extraction. The base and 11 injected audits of
`open-agent-platform` measured 6.55 seconds; the other audits measured 0.48 and 0.55 seconds. The set brings 119
components, 91 relations, five contributing adapters and the strongest real client-only precision case into the
required job for about 7.6 seconds of audit work.

`open-deep-research` was the first alternate. Its 2,404,558 byte archive uniquely protects the search-index
adapter and adds LangGraph coverage, but costs more compressed input than the selected set. The implemented
measurement adds the end-to-end required job cost and confirms the exact tree pins through the production
reader below.

## Measurement after implementation

The production reader pins these normalized source trees:

- `open-agent-platform`: `c4d4fa6fd3e06036ca0d1418dcd8ba0bdc580bf088c8e39b2cc1ec5347f95caf`;
- `openai-cs-agents-demo`: `2142a5a7c05192da3ce70e88c6b8aae560d4533a448d53f6fe441670f20bc4b7`;
- `vercel-ai-chatbot`: `b890c5a849e7807d364ec1ff8252791377742bfbe917d04eeb28ccf3ce5dc80d`.

Their licence file pins are `61e5e8faf0b76db76793ecd8aa0edca36a82bd8dba279d2a31972f026c132423`,
`fdd680f28af4ae4e155cc35b3d37da81d57ffa94359fceb53fcb4c11d5ce2c0d` and
`5809eb2eab284b24fc53b21484398fd264c6f929d3b32ecdc7108a89f037e943`. Every pin was read from the
downloaded archive by the production parser, not copied from Git metadata.

The hosting warning was observable even during this decision. Later fetches measured 339,275, 704,849 and
401,509 compressed bytes, where the comparison samples measured 339,273, 704,883 and 401,580. The normalized
source and licence digests stayed exact. Pinning the outer files would have made the same source fail.

The focused suite changes gzip compression and generated roots without moving the tree digest, moves each of
path, executable bit and content independently, and fires every container and definition refusal. The actual
required command then downloaded and parsed all three archives, reproduced all five selected expectations and
held 22 of 22 injected shapes across the two negative repositories. It reported 5 matched, 0 differing, 0 not
measured and 0 skipped. Two final runs took 17.09 and 16.05 seconds on the measured machine, a mean of 16.57
seconds. The three third-party entries account for 119 components and 91 relations under their existing
expectation contracts. No expectation file moved.

## Subsequent required regression adoption

The blind-evaluation regression adds `langchain-ai/local-deep-researcher` at
`a53b13c7022bb1352dc1ca994d07ade3cd3bd62e` as the fourth required archive. The exact checkout carries an MIT
licence whose SHA-256 is `ed165e58751856b6d12fdb6372402f7c04e3bd8ceea5f928e3da343ab27d1021`.

A fresh shallow checkout occupies 1,016 KiB including 380 KiB of Git data. The bounded archive is 188,306
compressed bytes and 634,880 expanded archive bytes. Its 18 regular files contain 606,447 source bytes, the
largest file is 542,192 bytes, and the normalized tree SHA-256 is
`c5b3e4993be4f26d27335ce5c2087b6cd9682c2eec4eed7ea35195b143fe514f`. Fetch and parse measured 0.553 and
0.004 seconds on the review machine. These values remain below the existing archive limits, so the acquisition
mechanism and its refusal policy do not change.

The entry is static. Its local-model and live-search exercise remains an external release acceptance measurement
because it takes about seven minutes and depends on a separately running local model and changing network results.
Required and optional corpus execution do not run it.

## Consequences

**The required gate depends on bounded public network reads.** A GitHub outage can fail it. The gate already
depends on public package registries during installation, so this is not a new hermeticity claim. The offline
command remains available for a contributor without network access.

**A hosting compression change does not move the pin.** Only the extracted source tree and licence digests decide
the input. A source change at the same requested commit, an unsafe archive or a missing licence fails before
discovery.

**Required coverage remains selected rather than synonymous with the full corpus.** Exercise entries install
third-party environments or need provider credentials. Larger static repositories add minutes or hundreds of
megabytes for less distinct required coverage. The optional live job continues to measure all pinned entries and
the federated runtime crossing.

**Licence boundaries stay visible.** Orchescope distributes expectation numbers and acquisition coordinates, not
third-party source. The required job obtains source from its upstream repository, verifies that its pinned licence
notice is present, measures it and leaves the ignored checkout outside package and artifact paths.
