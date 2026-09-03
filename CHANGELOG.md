# Changelog

All notable changes to this project are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0] - 2026-09-01

First public release.

### Added

- MCP server (Node/TypeScript) with the `health_check`,
  `delegate_exploration`, `delegate_search`, `delegate_transform`, and
  `apply_transform` tools, under the `mcp__sherpa__*` namespace.
- Backend adapters for Ollama and for OpenAI-compatible servers
  (llama.cpp server, LM Studio).
- Path confinement (read and write) to the project root, with
  symlink-escape protection.
- Two-step transform flow (`delegate_transform` proposes,
  `apply_transform` writes) with a hash-based staleness guard and
  truncation detection.
- `sherpa` skill with rules for when to delegate, silent degradation
  when the local backend isn't available, and treating returned content
  as untrusted data.
- `/sherpa-status` slash command to inspect the active backend, the
  loaded model, and the provenance of every config variable, without
  changing anything at runtime.
