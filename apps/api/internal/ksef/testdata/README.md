# KSeF FA(3) schema and API specification

Official files, downloaded on **2026-11-09** and committed unchanged (their mixed CR/CRLF line endings kept), so the
tests validate our FA(3) XML offline and check each file against `SHA256SUMS`.

| Path                    | Source                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `fa3/xsd/schemat.xsd`   | `https://crd.gov.pl/wzor/2025/06/25/13775/schemat.xsd`, structure "FA (3)", schema version 1-0E (in force 2026-02-01) |
| `fa3/xsd/bazowe/*.xsd`  | `http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/01/05/eD/DefinicjeTypy/…`, the types `schemat.xsd` imports        |
| `openapi/open-api.json` | `https://github.com/CIRFMF/ksef-docs/blob/main/open-api.json`, KSeF API 2.0 (Ministry of Finance, MIT, `LICENSE.txt`) |

`fa3/catalog.xml` maps the `crd.gov.pl` import locations to `fa3/xsd/bazowe/`, so `xmllint --nonet` resolves every
import locally. The KSeF client's fake server (`ksef_test.go`) checks every path it serves against `open-api.json`.

To update: download the new files, replace them, regenerate `SHA256SUMS` with
`find fa3/xsd openapi -type f | sort | xargs shasum -a 256 > SHA256SUMS` and run the tests. The standards watch
(`scripts/standards.sh`) opens an issue when crd.gov.pl publishes a newer FA structure.
