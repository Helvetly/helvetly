# Fonts of the generated PDFs

## Liberation Sans 2.1.5 (primary)

Regular and Bold set every PDF (invoices, QR bill, dunning letters, service reports, the VAT return summary,
filled templates, signature fields and certificates). It is metric-compatible with Helvetica/Arial and one of the
fonts permitted by SIX Implementation Guidelines QR-bill 2.3, section 3.4:
https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-v2.3-en.pdf

Upstream: https://github.com/liberationfonts/liberation-fonts. Unmodified font files retrieved from the Debian
`fonts-liberation2` 2.1.5-1 package:
https://deb.debian.org/debian/pool/main/f/fonts-liberation2/fonts-liberation2_2.1.5-1_all.deb

SIL Open Font License 1.1; copyright and license in `LiberationSans-LICENSE.txt`.

## Noto fallbacks

A character Liberation Sans lacks is drawn in the first of these that has it (all Regular, gzip-compressed):

| File                        | Covers                                             | Upstream                                  |
| --------------------------- | -------------------------------------------------- | ----------------------------------------- |
| `NotoSans.ttf.gz`           | the rest of Latin, Greek, Cyrillic; currency signs | notofonts NotoSans 2.015                  |
| `NotoSansArabic.ttf.gz`     | Arabic, Persian, Urdu (presentation forms)         | notofonts NotoSansArabic 2.013            |
| `NotoSansDevanagari.ttf.gz` | Devanagari                                         | notofonts NotoSansDevanagari 2.007        |
| `NotoSansThai.ttf.gz`       | Thai                                               | notofonts NotoSansThai 2.002              |
| `NotoSansMath.ttf.gz`       | mathematical operators, arrows                     | notofonts NotoSansMath 3.000              |
| `NotoSansSymbols.ttf.gz`    | symbols                                            | notofonts NotoSansSymbols 2.003           |
| `NotoSansSymbols2.ttf.gz`   | dingbats, more symbols                             | notofonts NotoSansSymbols2 2.008          |
| `NotoSansSC.ttf.gz`         | CJK ideographs (Chinese, Japanese kanji), kana     | google/fonts `NotoSansSC[wght].ttf` 2.004 |
| `NotoSansKR-Hangul.ttf.gz`  | Hangul                                             | google/fonts `NotoSansKR[wght].ttf` 2.004 |
| `NotoEmoji.ttf.gz`          | emoji, monochrome                                  | google/fonts `NotoEmoji[wght].ttf` 3.002  |

fpdf reads only TrueType outlines and a format-4 (BMP) cmap, so `build-noto.py` (fontTools) pins variable fonts to
weight 400, drops hinting, keeps one format-4 cmap and moves the emoji above U+FFFF into the Private Use Area
(`emoji-pua.txt`: line _i_ is the code point drawn as U+E000+_i_). Rebuild with
`python build-noto.py <dir with the upstream files> <out dir>`; the upstream Noto Sans files are the `unhinted/ttf`
Regulars from https://github.com/notofonts/notofonts.github.io, the others from https://github.com/google/fonts (`ofl/`).

SIL Open Font License 1.1; copyrights and license in `Noto-OFL.txt`. The modified fonts keep their Noto names and do
not use the Reserved Font Name "Source".
