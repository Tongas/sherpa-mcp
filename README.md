English | [Español](./README.es.md)

# sherpa

**A Claude Code plugin that offloads the heavy lifting — reading, searching, and batch-editing code — to your local LLM.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Tongas/sherpa-mcp/pulls)

Use your Claude subscription and your local AI at the same time, inside
Claude Code. Claude does the thinking; your local model does the heavy
reading. You save tokens.

## How it works

When you delegate a task, your local model reads, searches, or rewrites
files on your own hardware. Only a short summary comes back into Claude
Code's context — the file contents never enter it. The sherpa carries the
weight; you still decide the route.

sherpa ships as a Claude Code plugin: an MCP server with five tools, a
skill that teaches Claude when delegating is worth it, and a
`/sherpa-status` command for diagnosing your setup.

## The evidence

Exploring the same 3-layer Python codebase, same prompt, two ways:

| | Direct (Claude reads the files) | With sherpa |
|---|---|---|
| Tokens entering Claude's context | ~190,000 (the file content itself) | ~600 (just the summary) |
| Tokens processed locally | 0 | ~149,000 |
| Wall-clock time | ~39s | ~100s |
| Files covered | 41 | 24 |

Two things matter more than the ratio:

**The delegated summary held up.** Claude had already mapped the same
codebase manually in an earlier turn. When the sherpa summary came back,
it matched: same check count, same internal patterns, same data-model
chain. The local model didn't produce a vaguer answer — it produced the
same answer without spending orchestrator context.

**Delegating is slower, not faster.** Roughly 2–4x in wall-clock time.
The value here is context saved, not speed. See
[When NOT to use it](#when-not-to-use-it).

**This is one measurement, on one repo, with one model — not a
benchmark.** Your ratio depends on file sizes, the instruction, and the
model you run.

## Quickstart

Prerequisites: Node.js ≥ 18, [ripgrep](https://github.com/BurntSushi/ripgrep#installation)
(`rg`) on `PATH`, and a local backend running (Ollama, llama.cpp server,
or LM Studio).

### Main path: install the plugin

This gets you the MCP server, the skill, and `/sherpa-status` together,
in one shot:

```
/plugin marketplace add Tongas/sherpa-mcp
/plugin install sherpa@sherpa-mcp
```

**Configure the backend.** A plugin-provided MCP server inherits Claude
Code's own process environment — there's no documented way to attach a
per-plugin `env` block after a marketplace install. That makes shell
exports fragile: if you launch Claude Code from a GUI launcher instead
of a terminal, it doesn't inherit anything from `~/.bashrc`/`~/.zshrc`.

**Recommended: a config file**, which sherpa reads regardless of how
Claude Code was launched. Create `~/.claude/sherpa/config.json` (applies
everywhere) or `./sherpa.config.json` in a specific project (same keys,
camelCase):

```json
{
  "backend": "openai-compatible",
  "baseUrl": "http://localhost:8080",
  "model": "qwen2.5-coder-14b",
  "contextWindowOverride": 32768,
  "maxOutputTokensOverride": 8192
}
```

(For Ollama, drop `backend`/`contextWindowOverride`/`maxOutputTokensOverride`
— just `baseUrl` and `model` are enough; see
[Configuration](#configuration) below for the full key list.)

**Quick alternative:** if you're always launching Claude Code from a
shell, exporting env vars works too:

```bash
export SHERPA_BASE_URL="http://localhost:11434"   # Ollama default
export SHERPA_MODEL="qwen2.5-coder:14b"            # whatever you have pulled
```

For an `openai-compatible` backend (llama.cpp server, LM Studio), also
export `SHERPA_BACKEND=openai-compatible` plus `SHERPA_CONTEXT_WINDOW`
and `SHERPA_MAX_OUTPUT_TOKENS` set to your server's real values. There's
no standard endpoint to discover the context window, so without one of
these two config methods sherpa falls back to a conservative 4096/2048,
which makes `delegate_transform` skip files over roughly 200 lines.

**Verify:** open a new session and run `/sherpa-status`. It shows the
active backend, the loaded model, and where each config value actually
came from, so a typo doesn't go unnoticed.

### Alternative: MCP server only, via npx

Use this if you just want the tools — for example, wiring sherpa into
something other than Claude Code. **You won't get the skill or
`/sherpa-status`**, which means no automatic guidance on when delegating
is worth it and no built-in way to check what's configured; you'll need
to invoke the tools explicitly and know your own setup.

Add this to `~/.claude.json` (or a project-level `.mcp.json`) — here the
`env` block is explicit and does work, since you're registering the MCP
server directly rather than through a plugin:

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

For an `openai-compatible` backend, add `SHERPA_BACKEND`,
`SHERPA_CONTEXT_WINDOW`, and `SHERPA_MAX_OUTPUT_TOKENS` to that same
`env` block, same as above.

Tested with llama.cpp server. Also supports Ollama and LM Studio through
the same OpenAI-compatible interface.

#### Installing from a clone (development)

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

## Example prompts

These are prompts we actually ran, not hypothetical ones. Name sherpa in
the prompt — see [Automatic vs. explicit invocation](#automatic-vs-explicit-invocation)
for why.

**1. Codebase reconnaissance — the main case:**

> Use sherpa to explore this project and tell me how the audit logic is
> structured

Measured: 24 files, ~149k tokens processed locally, ~100s, and only the
summary entered Claude's context.

**2. Search with synthesis:**

> Use sherpa to find every usage of the old logging API and summarize
> what needs to change

ripgrep does the searching; the local model only synthesizes the matches.

**3. Batch transformation:**

> Use sherpa to rename the config key `oldName` to `newName` across the
> project

`dry_run` is the default: you get a reviewable proposal with per-file
diffs, nothing is written. Then `apply_transform` writes exactly what you
reviewed — no regeneration, and it refuses any file that changed on disk
in the meantime.

## Automatic vs. explicit invocation

The plugin ships a skill that teaches Claude when delegating is worth it,
and it does fire on its own sometimes. But in practice, automatic
activation is not reliable for exploration: Claude often reaches for its
native tools (`Read`, `Grep`, the Explore agent) even with the skill
loaded and the tools visible.

**For a guarantee, name sherpa in the prompt.** Explicit invocation works
consistently.

Measured on Claude Code v2.x. This may change in future versions.

## When NOT to use it

If Claude already has the project map in context — files already read
this session, or a small codebase — direct tools win every time.
Delegating costs a round trip; reading two known files does not.

Delegating is slower, not faster. The value is context saved, not speed.

And v1 doesn't write new code: `delegate_transform` performs mechanical
transformations on files that already exist (renaming, repetitive
boilerplate), not new features or logic. See `skills/sherpa/SKILL.md` for
the full when-to/when-not-to table.

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
`delegate_*` call accumulate there with no limit in v1.

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

- **No automatic `.sherpa/` cleanup**: results accumulate indefinitely —
  delete them manually whenever you want.
- **`delegate_transform` skips (doesn't fail) files that exceed the
  model's output budget**: with the conservative fallback defaults
  (4096/2048) this affects files over roughly 200 lines. Set
  `SHERPA_CONTEXT_WINDOW`/`SHERPA_MAX_OUTPUT_TOKENS` to your server's
  real values to avoid it.
- **Truncation guard in `delegate_transform`**
  (`SHERPA_TRUNCATION_THRESHOLD`, default `0.75`): a threshold that's
  blind to intent. An instruction that legitimately shortens a file a lot
  (e.g. "delete all dead code") can trigger a false rejection — lower the
  threshold for that specific use case.
- **v1 doesn't write new code**: mechanical transformations on existing
  files only, not new features or logic.
- **`getCapabilities()` on `openai-compatible` backends**: no standard
  endpoint to discover the context window on llama.cpp server / LM
  Studio. If you change the loaded model without updating the env vars,
  chunking will use stale values.
- **No automatic fallback or retry** if the local backend doesn't
  respond: this is intentional — Claude does the task itself and moves
  on, without interrupting your session.
- **TOCTOU in `apply_transform`'s staleness guard**: there's an
  unavoidable window between reading the hash and writing the file
  (Node's sync `fs` APIs don't offer an atomic "check and write"
  operation for this case).
- **`file-enumeration.ts` doesn't follow symlinks**: a source tree that
  is (or contains) a symlink returns zero files instead of an error —
  there's no explicit warning that a symlink is being enumerated.

## License

MIT — see [LICENSE](./LICENSE).

---

Built by [Gastón Parravicini](https://github.com/Tongas).

Built with AI assistance.
