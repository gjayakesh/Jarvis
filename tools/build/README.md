# Release tooling (spec G6)

| Script | What it does |
|---|---|
| `..\..\install-jarvis.ps1` | One-step per-user install: prerequisites check, UI deps and voice models, agent environment, optional Ollama + model, build, Startup shortcut. |
| `make-sbom.py` | Writes `SBOM\sbom.cdx.json` (CycloneDX 1.5) and `SBOM\LICENSES.md`, flagging copyleft and unknown licences. Run with `apps\agent\.venv\Scripts\python.exe`. |
| `sign.ps1` | Authenticode-signs every JARVIS PowerShell script with a time stamp, using a code-signing certificate from your user store. |

## Code signing

Smart App Control and SmartScreen only trust signatures that chain to a public
certificate authority, so a self-signed certificate does not help. Options:

- **Azure Trusted Signing** (Microsoft): a monthly subscription; identity validation of a person or company.
- **Certum Open Source Code Signing**: low-cost certificate for open-source developers, on a smart card or in the cloud.
- **An OV/EV code-signing certificate** from any public CA (DigiCert, Sectigo, SSL.com…).

Buying one needs your identity documents and payment, so it has to be done by you.
Once the certificate is installed in `Cert:\CurrentUser\My`, run:

```powershell
powershell -ExecutionPolicy Bypass -File tools\build\sign.ps1
```
