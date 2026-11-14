# eCH-0217 V2.0.0 schema and examples

Official files of [eCH-0217 Spezifikation E-MWST V2.0.0](https://www.ech.ch/de/ech/ech-0217/2.0.0), the only
format the ESTV ePortal (MWST-Abrechnung pro) imports. Downloaded on **2026-11-09** and committed unchanged
(CRLF line endings kept), so `ech0217_test.go` validates our XML offline and checks each file against
`SHA256SUMS`.

| Path                                    | Source                                                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `xmlns/eCH-0217/2/eCH-0217-2-0-0.xsd`   | `https://www.ech.ch/sites/default/files/imce/eCH-Dossier/0211-0240/eCH-0217/2.0.0/Beilagen/eCH-0217-2-0-0.xsd` |
| `xmlns/eCH-<n>/<v>/eCH-<n>-<v>-<r>.xsd` | `http://www.ech.ch/xmlns/eCH-<n>/<v>/…`, the schemas eCH-0217 imports, directly or through eCH-0108/eCH-0129   |
| `examples/*.xml`                        | the four examples in the same `Beilagen/` folder (effective, net tax rate, flat tax rate, simple tax rate)     |

`catalog.xml` maps the `http://www.ech.ch/xmlns/` import locations to `xmlns/`, so `xmllint --nonet` resolves
every import locally. The official examples are validated in the same test, as a check of this setup.

The specification itself (`STAN_d_DEF_2025_06_30_eCH-0217_V2.0.0_E-MWST.pdf`, SHA-256
`11a914dae4676a1e51ed8bdd98913acb64f76713ee3350e57c0b7d612283366b`) is not committed.

To update: download the new version, replace the files, regenerate `SHA256SUMS` with
`find xmlns examples -type f | sort | xargs shasum -a 256 > SHA256SUMS` and run the tests.
