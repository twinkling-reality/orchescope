# Security

## Reporting a vulnerability

Report a suspected vulnerability by opening a private security advisory at
https://github.com/athledev-labs/orchescope/security/advisories/new, which is the `Security` tab followed by
`Report a vulnerability`. If that is not available to you, open a public issue that says only that you have found a security
problem and asks for a private channel; do not include the details in the issue.

Please include what you can: the version (`orchescope --version`), the platform, the command you ran, what you expected,
what happened, and a repository or scenario that reproduces it. A proof of concept is welcome; it is not required.

What to expect: an acknowledgement within seven days, an assessment with a severity and a plan within fourteen days, and a
fix released with the reporter credited unless they prefer otherwise. If a report turns out to be a known limitation
rather than a defect, the answer will say so and point at where that limitation is documented.

## What is in scope

- Reading or writing files outside the audited repository.
- Executing a command the configured policy does not allow.
- Reaching the network when no setting granted it.
- A secret appearing in a report, an export, a log line, an error message or the store.
- A page other than the served report reading the report server, or a request from another origin being accepted.
- Content from an audited repository, a trace, or a model response causing code execution, script execution in the
  report, or a path traversal.
- A finding, metric or verdict that misrepresents what was measured, in a way a reader would act on.

## What is not in scope

These are documented properties of what Orchescope is, not defects:

- **Orchescope executes the system you point it at.** `trace`, `test`, `benchmark` and `chaos` start your processes with
  your environment, and those processes can do whatever they were written to do, including calling paid providers and
  performing real external effects. The bound is the configured policy, not a sandbox.
- **Chaos injects faults on purpose**, including faults that cause duplicated external effects. That is the measurement.
- **Prompt injection scenarios feed hostile text to your agents on purpose.** If your agent acts on it, that is the
  finding.
- **Redaction is a pattern set, not a proof.** It removes credentials that match documented shapes. A secret in a shape
  nothing recognises can survive it, which is why an export is something you review before you share it.
- **A local user with access to your account can read `.orchescope/state/`.** Files are created with owner only
  permissions; they are not encrypted.
- **Findings are analysis, not certification.** Orchescope reports what it found and names what it could not inspect.

## What Orchescope will not do, ever

- It will not send your code, prompts, traces, findings or reports anywhere. There is no account, no telemetry, no
  upload, and no phone home. The only network listeners it creates bind to loopback and exist for the duration of a
  command.
- It will not retry an operation whose idempotency it could not establish, and it will not describe such a retry as safe.
- It will not interpret your repository with a model. Analysis is deterministic and there is no setting that changes
  that, so no part of your code reaches a provider.
- It will not publish itself. Releasing is a deliberate human action.

## Hardening notes

If you audit a repository you do not trust:

- Run with `policy.allowProcessSpawn` set to `false`, which keeps the audit static. Discovery never executes the
  repository's code; it parses it.
- Keep `policy.allowOutboundNetwork` and `policy.allowPaidModels` at their defaults, which are `false`.
- Review `.orchescope/manifest.yaml` and `scenarios/*.yaml` before running anything, since both come from the repository
  and both can name commands.
- Run in a container or a throwaway user account if the repository's side effects are unknown to you.

See [docs/security/threat-model.md](docs/security/threat-model.md) for the assets, the boundaries and the controls, and
[docs/security/permission-model.md](docs/security/permission-model.md) for what each setting grants.
