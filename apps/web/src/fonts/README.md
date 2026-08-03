# Vendored fonts

Two faces, both SIL Open Font License 1.1, both vendored as binary rather than fetched. The served
report runs under `font-src 'self'` and the standalone export runs under `default-src 'none'`, so a
remote font is not merely discouraged here, it is impossible.

| file | family | axis | subset | bytes | sha256 |
| --- | --- | --- | --- | --- | --- |
| `manrope-latin.woff2` | Manrope, v20 | `wght` 200 to 800 | latin | 24576 | `e310b55a7fd9677f5e3555e6c6c4d064fa1f1d24393f0ddbe217cea12a8c432f` |
| `jetbrains-mono-latin.woff2` | JetBrains Mono, v24 | `wght` 100 to 800 | latin | 40480 | `1e06740a02a443fb7f3eeda8fcaa685a0f6c620e3f01e6666e847295469ce3ad` |

Both were taken from the Google Fonts CDN, which is where the pre-built woff2 subsets are published:

```
https://fonts.gstatic.com/s/manrope/v20/xn7gYHE41ni1AdIRggexSvfedN4.woff2
https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbV2o-flEEny0FZhsfKu5WU4xD7OwGtT0rU.woff2
```

The licence text beside each one is the copy Google Fonts distributes with the family, from
`google/fonts/ofl/manrope/OFL.txt` and `google/fonts/ofl/jetbrainsmono/OFL.txt`. The OFL permits
redistribution of the software, modified or not, as part of a larger work, and requires the licence
to travel with it. That is what these two text files are for, and it is why the release bundle
carries them.

## Why the latin subset only

The report renders identifiers, file paths, commands and English prose, all of which the latin
subset covers, including the whole of Latin-1 Supplement. A repository is free to name a component
in a script this subset does not cover, and when it does the browser falls back to the next family
in the stack for those glyphs, which renders correctly rather than as missing-glyph boxes. Carrying
every subset would cost every reader roughly 400 KiB to serve a case that does not appear in any of
the fourteen corpus repositories.

## Why one variable file per family instead of one file per weight

The design uses Manrope at 200, 300, 400 and 500 and JetBrains Mono at 300 and 400. Six static
files come to more bytes than two variable ones, and a variable axis means a weight the design later
needs costs nothing to add.
