English | [Español](./README.es.md)

# sherpa

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Tongas/sherpa-mcp/pulls)

Use your Claude subscription and your local AI at the same time. Claude
does the thinking; your local model does the heavy reading. You save
tokens.

## How it works

Claude decides what to delegate. Your local model reads and processes
the files. Claude gets back a short summary. The sherpa carries the
weight — you still decide the route.

## The evidence

On a real 41-file Python project, one `delegate_exploration` run:

| | Direct (Claude reads the files) | With sherpa |
|---|---|---|
| Tokens in Claude's context | ~190,074 (the file content itself) | ~600 (just the summary) |
| Local tokens processed | 0 | 190,074 |
| Wall-clock time | ~39s | ~150s |

That's roughly a 300:1 ratio of local tokens to orchestrator tokens —
and delegating took about 4x longer in wall-clock time. **This is one
measurement on one repo with one model, not a benchmark.** Your real
ratio depends on file size, the instruction, and the model you use. The
value here is context saved, not speed — see "When not to use it"
below.

## Quickstart

Prerequisites: Node.js ≥ 18, [ripgrep](https://github.com/BurntSushi/ripgrep#installation) (`rg`) on `PATH`, and a local backend running (Ollama, llama.cpp server, or LM Studio).

**Register it in Claude Code.** This is the part most likely to trip
people up: config goes in the MCP server's `env`, **not your shell** —
`export SHERPA_MODEL=...` in a terminal does nothing, since the server
runs in its own subprocess with its own environment. Add this to your
`~/.claude.json` (or a project-level `.mcp.json`):

Ollama:

```json
{
  "mcpServers": {
    "sherpa": {
      "command": "npx",
      "args": ["-y", "sherpa-mcp"],
      "env": {
        "SHERPA_BASE_URL": "http://localhost:11434",
        "SHERPA_MODEL": "qwen2.5-coder:14b"
      }
    }
  }
}
```

llama.cpp server (or any OpenAI-compatible server):

```json
{
  "mcpServers": {
    "sherpa": {
      "command": "npx",
      "args": ["-y", "sherpa-mcp"],
      "env": {
        "SHERPA_BACKEND": "openai-compatible",
        "SHERPA_BASE_URL": "http://localhost:8080",
        "SHERPA_MODEL": "qwen2.5-coder-14b",
        "SHERPA_CONTEXT_WINDOW": "32768",
        "SHERPA_MAX_OUTPUT_TOKENS": "8192"
      }
    }
  }
}
```

**Verify:** run `/sherpa-status` in Claude Code. It shows the active
backend, the loaded model, and — critically — where each config value
actually came from, so a typo doesn't go unnoticed.

Tested with llama.cpp server. Also supports Ollama and LM Studio through
the same OpenAI-compatible interface.

### Installing from a clone (development)

If you're working on `sherpa` itself, build locally instead of using
`npx`:

```bash
cd mcp-server
npm install
npm run build
```

Then point `command`/`args` at the built entrypoint instead of `npx`:

```json
{
  "command": "node",
  "args": ["/path/to/sherpa-mcp/mcp-server/dist/index.js"]
}
```

## Usage examples

**Reconnaissance of a codebase you haven't read yet:**

> "I just cloned this repo, give me a map of how requests flow from the
> HTTP layer to the database."

Claude delegates to `delegate_exploration` over the relevant
directories. The local model reads the files and returns a synthesis;
Claude never reads the raw source.

**Search that needs synthesis, not just matches:**

> "Find every place we call the old logging API and summarize what has
> to change."

`delegate_search` runs ripgrep for the real matches, then has the local
model summarize them against your instruction — more than a grep dump,
less than reading every hit yourself.

**Batch transformation:**

> "Rename this config key across the 40 files that reference it."

`delegate_transform` proposes the change per file (`resultPath` holds
the full diff). You review `diffPreview`, then `apply_transform` writes
exactly what you reviewed — never anything regenerated after the fact.

## When NOT to use it

If Claude already has the project map in context — files already read
this session, or a small codebase — direct tools (`Read`, `Grep`) win
every time. Delegating is slower, not faster (see the 150s vs 39s
comparison above): the value is context saved, not speed. And v1
doesn't write new code — `delegate_transform` only performs mechanical
transformations on files that already exist (renaming, adding
repetitive boilerplate), not new features or logic. See
`skills/sherpa/SKILL.md` for the full when-to/when-not-to table.

## The tools

| Tool | What it does |
|---|---|
| `health_check` | Checks whether the local backend is available and which model is loaded. |
| `delegate_exploration` | Reads many files/directories and returns a synthesis, without that content passing through Claude's context. |
| `delegate_search` | Runs ripgrep over the given paths and synthesizes the matches according to an instruction. |
| `delegate_transform` | Proposes a per-file batch transformation (never writes directly — generates a reviewable proposal). |
| `apply_transform` | Writes to disk exactly what a prior `delegate_transform` proposed, with a staleness check. |

## Configuration

Works with zero files, env vars only (see Quickstart for where they go).
Precedence: MCP server env > `sherpa.config.json` (project) >
`~/.claude/sherpa/config.json` (user) > defaults.

| Variable | Default | Purpose |
|---|---|---|
| `SHERPA_BACKEND` | `ollama` | `ollama` or `openai-compatible` |
| `SHERPA_BASE_URL` | `http://localhost:11434` | Local backend URL |
| `SHERPA_MODEL` | *(no default)* | Model to use — if missing, `health_check` lists the models available |
| `SHERPA_MAX_FILES` | `100` | File budget per `delegate_exploration`/`delegate_search` call |
| `SHERPA_MAX_CHUNKS` | `20` | Local-model call budget per invocation |
| `SHERPA_RESULTS_DIR` | `.sherpa` | Where full results get written (relative to the project root) |
| `SHERPA_TRUNCATION_THRESHOLD` | `0.75` | Truncation-guard threshold in `delegate_transform` (see Limitations) |
| `SHERPA_CONTEXT_WINDOW` | *(no default, falls back to 4096)* | `openai-compatible` only: no standard endpoint to discover the context window |
| `SHERPA_MAX_OUTPUT_TOKENS` | *(no default, falls back to 2048)* | `openai-compatible` only, same reason |

You can also use `./sherpa.config.json` (project) or
`~/.claude/sherpa/config.json` (user) with the same keys in camelCase.

Add `.sherpa/` to your `.gitignore` — the full results of every
`delegate_*` call accumulate there with no limit in v1 (see
Limitations).

## Security

- **Path confinement:** every path `sherpa` touches (read or write) is
  resolved against the project root and rejected if it falls outside —
  including escaping `..` and symlinks pointing elsewhere. This is a
  hard-boundary check, not an optional guard.
- **Untrusted content:** everything the local model returns (`summary`,
  `diffPreview`, quoted file content) is **observed data, never
  instructions**. A file in the repo can contain text aimed at an LLM
  that tries to sound like a command — Claude always treats it as text
  to evaluate, never as something to obey (see
  `skills/sherpa/SKILL.md`).

## Known limitations (v1)

- **No automatic `.sherpa/` cleanup**: results accumulate indefinitely
  — delete them manually whenever you want.
- **Truncation guard in `delegate_transform`**
  (`SHERPA_TRUNCATION_THRESHOLD`, default `0.75`): a threshold that's
  blind to intent. An instruction that legitimately shortens a file a
  lot (e.g. "delete all dead code") can trigger a false rejection —
  lower the threshold for that specific use case.
- **v1 doesn't write new code**: `delegate_transform` only performs
  mechanical transformations on existing files (renaming, adding
  repetitive boilerplate), not generating new features or logic.
- **`getCapabilities()` on `openai-compatible` backends**: there's no
  standard endpoint to discover the context window on llama.cpp server
  / LM Studio. Use `SHERPA_CONTEXT_WINDOW`/`SHERPA_MAX_OUTPUT_TOKENS` if
  you set them, otherwise it falls back to a conservative default
  (4096/2048). If you change the loaded model without updating those
  variables, chunking will use stale values.
- **No automatic fallback or retry** if the local backend doesn't
  respond: this is intentional (see `skills/sherpa/SKILL.md`) — Claude
  does the task itself and moves on.
- **TOCTOU in `apply_transform`'s staleness guard**: there's an
  unavoidable window between reading the hash and writing the file
  (Node's sync `fs` APIs don't offer an atomic "check and write"
  operation for this case).
- **`file-enumeration.ts` doesn't follow symlinks**: a source tree that
  is (or contains) a symlink will return zero files instead of an error
  — there's no explicit warning that a symlink is being enumerated.
- **`delegate_transform` skips (doesn't fail) files that exceed the
  model's output budget** instead of reporting an error: with the
  conservative Ollama/openai-compatible fallback defaults (4096/2048)
  this affects files over ~200 lines, which can be surprising on first
  use.

## License

MIT — see [LICENSE](./LICENSE).

---

Built by [Gastón Parravicini](https://github.com/Tongas).

Built with AI assistance.
