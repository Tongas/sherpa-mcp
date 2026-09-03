---
description: Shows the local backend status of sherpa and where every config variable came from (MCP server env / sherpa.config.json / ~/.claude/sherpa/config.json / default). Read-only.
argument-hint: ""
---

This command only **reads** state — it never changes backend, model, or
any other config at runtime. That's intentional: `sherpa` deliberately
rules out dynamic backend/model selection — changing the default
backend/model requires restarting the MCP server with a different `env`
config, not a command that mutates it live. The only override that
exists is the optional `model` parameter per tool call (`delegate_*`),
and that doesn't apply here.

**Why provenance matters, not just the effective value:** the default
`backend` is `ollama` at `localhost:11434`. If someone has Ollama
running locally with any model and *believes* they configured
llama.cpp, `health_check` will still return `status: 'ok'` — just
pointing at a different model than the one they think, with no error to
give it away. Showing where each value came from (and explicitly
flagging when it's "default, nothing set it") is the only way to catch
that.

## Sources to inspect, in the real precedence order (config.ts)

Highest to lowest precedence: **MCP server env** > project
`sherpa.config.json` > `~/.claude/sherpa/config.json` (user) > hardcoded
defaults.

1. **MCP server env.** This is NOT your current shell — it's the `env`
   Claude Code launches the `node dist/index.js` subprocess with.
   Extract it without dumping the whole file (it may have other servers
   with secrets next to it):
   - Project: `jq '.mcpServers.sherpa.env // {}' .mcp.json 2>/dev/null`
     (if `.mcp.json` exists at the project root).
   - User (global): `jq '.mcpServers.sherpa.env // {}' ~/.claude.json 2>/dev/null`
   - If both define `sherpa`, the project one (`.mcp.json`) is the one
     that applies for this session if the server was registered there;
     if it only exists in one of the two, that's the one. State this
     explicitly in the report — don't silently assume which one won if
     there's genuine ambiguity.
   - Side note, non-blocking: if something doesn't line up with what
     `health_check` reports below, the variable might come from the
     real environment Claude Code started in (e.g. exported in
     `.bashrc`) instead of this `env` block — inspectable, but not
     accessible from here.

2. **Project config:** `<root>/sherpa.config.json` — read it with Read
   if it exists.

3. **User config:** `~/.claude/sherpa/config.json` — read it with Read
   if it exists.

4. **Defaults** (hardcoded in `mcp-server/src/config.ts`, depend on
   nothing):
   `backend=ollama`, `baseUrl=http://localhost:11434`, `model=(no default)`,
   `maxFiles=100`, `maxChunks=20`, `resultsDir=.sherpa`,
   `truncationThreshold=0.75`, `contextWindowOverride=(not set)`,
   `maxOutputTokensOverride=(not set)`.

## How to combine them

For each variable (`backend`, `baseUrl`, `model`, `maxFiles`,
`maxChunks`, `resultsDir`, `truncationThreshold`, `contextWindowOverride`
via `SHERPA_CONTEXT_WINDOW`, `maxOutputTokensOverride` via
`SHERPA_MAX_OUTPUT_TOKENS`): take the value from the highest-precedence
source that defines it, and mark that source as the origin. If none
define it, the value is the default and the origin is literally
**"default — nothing set it"**, called out, not just omitted.

## Then: run health_check and cross-check

5. Call `mcp__sherpa__health_check()`.

6. Report, per variable, `effective value · origin`. Example format:

   - **backend:** `openai-compatible` · MCP server env (`.mcp.json`/`~/.claude.json`)
   - **baseUrl:** `http://localhost:8080` · MCP server env
   - **model:** `qwen2.5-coder-14b` · MCP server env
   - **maxFiles:** `100` · default — nothing set it
   - **resultsDir:** `.sherpa` · default — nothing set it

7. Cross-check the `model`/`backend` you computed against what
   `health_check` returned (`status`, `model`). If `health_check` is
   `ok` but the `model` it reports **doesn't match** the one you
   computed by precedence, flag it as a strong inconsistency (likely a
   real process env different from what you see in the files, or a
   config file read from a different project root than expected) —
   don't hide it or round it off to "looks fine."

8. If `status` is `model_not_loaded`: list `availableModels` as-is and
   say exactly what to export, e.g.:
   `No model configured. Models available on the backend: <list>.
   To use one, export: SHERPA_MODEL=<exact-name>` (in the server's `env`
   block, not your shell — see point 1).

9. If `status` is `unreachable`: show the `detail` returned, without
   inventing startup steps not documented in the README.

## contextWindow / maxOutputTokens: manual override vs. what the backend reports

This is the point most prone to silently failing (see the SKILL.md
operational note) — handle it carefully, the real behavior differs by
backend:

- **If the effective `backend` is `ollama`:** the Ollama adapter
  **completely ignores** `SHERPA_CONTEXT_WINDOW`/`SHERPA_MAX_OUTPUT_TOKENS`
  — there's no override possible here at all, it always queries
  `/api/show` for the real model. If you still see those variables set
  (in any source) with `backend=ollama`, mark it explicitly as **"set
  but has no effect — active backend is ollama"**, don't report it as
  if it were being applied.

- **If the effective `backend` is `openai-compatible`:**
  - If `SHERPA_CONTEXT_WINDOW`/`SHERPA_MAX_OUTPUT_TOKENS` **are set**:
    that's exactly the value `health_check` will return as
    `contextWindow`/`maxOutputTokens` — the adapter has no way to ask
    the backend for its real window, so there's no independent
    "value reported by the backend" to compare against in this code.
    As a best-effort sanity check (not guaranteed — many
    OpenAI-compatible servers don't expose this), try
    `curl -s <baseUrl>/v1/models` and check whether the response carries
    any context field (`n_ctx`, `context_length`, `max_context`, or
    similar, depending on the server). If it appears and **differs**
    from the set override, flag it in a separate line with both
    numbers — this is exactly the scenario that produces a
    `ContextExceededError` mid map-reduce if the override is larger
    than the real window. If nothing like that shows up in the
    response, say so: "couldn't verify against the backend — it doesn't
    expose that info in `/v1/models`," don't present it as validated.
  - If they're **not** set: `health_check` will return the hardcoded
    blind fallback (`contextWindow: 4096`, `maxOutputTokens: 2048`),
    **not** the model's real window — flag this explicitly as a risk
    (unnecessarily conservative chunking, see the SKILL.md operational
    note) and suggest setting `SHERPA_CONTEXT_WINDOW`/
    `SHERPA_MAX_OUTPUT_TOKENS` if the real window is known.

## Rest of the report

Also include (no provenance needed, these are direct observables, not
config):

- **ripgrep:** run `which rg` — on PATH / not found (prerequisite for
  `delegate_search`).
- **Confined root:** the working directory the MCP server started in
  (fixed at startup, not configurable via tool parameter — every path
  the tools touch is resolved against this root and rejected if it
  falls outside) — in practice, this session's `pwd`.

Present everything as a short list, no filler prose.
