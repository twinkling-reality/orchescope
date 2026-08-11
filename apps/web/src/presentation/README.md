# Presentation binders

Pure modules that select, sort, group and bound facts already in a `ReportBundle`.

They decide what each named slot holds. They do not render, and they do not analyse again. The
replaceable skin lives in `../ui/` and `../sections/`. `pnpm deps` fails if a binder imports either.

If you need a new decision about what the page shows, add or extend a binder here with empty and
refusal tests. If you need a new look, change the skin and leave these modules alone.
