# Third-party notices

## Adapted source code

### PC-AI (MIT License)

`apps/agent/jarvis/collectors/windows_probe.ps1` adapts the CIM fallback paths of
`Get-DeviceErrors`, `Get-DiskHealth`, `Get-NetworkAdapters` and `Get-SystemEvents`
from PC-AI, `Modules/PC-AI.Hardware/Public/*.ps1`, commit
`ea92d044750b6c4c30f59b55621ae61c0f6175a9` (https://github.com/David-Martel/PC-AI).

```
MIT License

Copyright (c) 2025 David Martel

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Libraries (used as dependencies, not modified)

| Package | License | Used for |
|---|---|---|
| FastAPI | MIT | Agent REST API |
| Uvicorn | BSD-3-Clause | Agent HTTP server |
| psutil | BSD-3-Clause | CPU, memory, disk, network and process telemetry |
| SQLAlchemy | MIT | SQLite storage |
| Pydantic | MIT | Request validation |
| HTTPX | BSD-3-Clause | Ollama client and HTTPS reachability probe |
| Ollama (separate install, optional) | MIT | Local AI runtime |
| @huggingface/transformers, ONNX Runtime Web | Apache-2.0 / MIT | On-device speech models in the UI |

## Studied for reference only (no code copied)

- hck-GPT (https://github.com/HuckleR2003/hck-GPT): no LICENSE file in the repository, so nothing was reused.
- WF Diagnostics (https://github.com/faratech/wfdiag): license not asserted; reference only.
