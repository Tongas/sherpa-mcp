[English](./README.md) | Español

# sherpa

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Tongas/sherpa-mcp/pulls)

Usá tu suscripción de Claude y tu IA local al mismo tiempo. Claude pone
el razonamiento; tu modelo local hace la lectura pesada. Vos ahorrás
tokens.

## Cómo funciona

Claude decide qué delegar. Tu modelo local lee y procesa los archivos.
A Claude le vuelve un resumen corto. El sherpa carga el peso — vos
seguís decidiendo la ruta.

## La evidencia

Sobre un proyecto Python real de 41 archivos, una corrida de
`delegate_exploration`:

| | Directo (Claude lee los archivos) | Con sherpa |
|---|---|---|
| Tokens en el contexto de Claude | ~190.074 (el contenido de los archivos) | ~600 (solo el resumen) |
| Tokens locales procesados | 0 | 190.074 |
| Tiempo real (wall-clock) | ~39s | ~150s |

Eso es aproximadamente una relación 300:1 entre tokens locales y tokens
del orquestador — y delegar tardó unas 4x más en tiempo real. **Esto es
una medición en un repo con un modelo, no un benchmark.** Tu ratio real
depende del tamaño de archivo, la instrucción, y el modelo que uses. El
valor acá es el contexto ahorrado, no la velocidad — ver "Cuándo NO
usarlo" más abajo.

## Quickstart

Prerequisitos: Node.js ≥ 18, [ripgrep](https://github.com/BurntSushi/ripgrep#installation) (`rg`) en `PATH`, y un backend local corriendo (Ollama, llama.cpp server, o LM Studio).

**Registralo en Claude Code.** Esto es lo que más confunde al instalar:
la config va en el `env` del MCP server, **no en tu shell** — `export
SHERPA_MODEL=...` en una terminal no hace nada, porque el server corre
en su propio subproceso con su propio entorno. Agregá esto a tu
`~/.claude.json` (o a un `.mcp.json` de proyecto):

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

llama.cpp server (o cualquier servidor OpenAI-compatible):

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

**Verificá:** corré `/sherpa-status` en Claude Code. Muestra el backend
activo, el modelo cargado y — lo más importante — de dónde salió cada
valor de config, para que un typo no pase desapercibido.

Probado con llama.cpp server. También soporta Ollama y LM Studio vía la
misma interfaz OpenAI-compatible.

### Instalación desde un clone (desarrollo)

Si estás trabajando sobre `sherpa` mismo, compilá localmente en vez de
usar `npx`:

```bash
cd mcp-server
npm install
npm run build
```

Y apuntá `command`/`args` al entrypoint compilado en vez de `npx`:

```json
{
  "command": "node",
  "args": ["/ruta/a/sherpa-mcp/mcp-server/dist/index.js"]
}
```

## Ejemplos de uso

**Reconocimiento de un codebase que todavía no leíste:**

> "Acabo de clonar este repo, dame un mapa de cómo fluyen los requests
> desde la capa HTTP hasta la base de datos."

Claude delega a `delegate_exploration` sobre los directorios relevantes.
El modelo local lee los archivos y devuelve una síntesis; Claude nunca
lee el código fuente crudo.

**Búsqueda que necesita síntesis, no solo matches:**

> "Buscá todos los lugares donde llamamos a la API de logging vieja y
> resumí qué hay que cambiar."

`delegate_search` corre ripgrep para los matches reales, y después le
pide al modelo local que los resuma según tu instrucción — más que un
volcado de grep, menos que leer cada match vos mismo.

**Transformación batch:**

> "Renombrá esta clave de config en los 40 archivos que la referencian."

`delegate_transform` propone el cambio por archivo (`resultPath` tiene
el diff completo). Revisás `diffPreview`, y después `apply_transform`
escribe exactamente lo que revisaste — nunca algo regenerado después.

## Cuándo NO usarlo

Si Claude ya tiene el mapa del proyecto en contexto — archivos ya
leídos en esta sesión, o un codebase chico — las herramientas directas
(`Read`, `Grep`) ganan siempre. Delegar es más lento, no más rápido (ver
la comparación de 150s vs 39s arriba): el valor es el contexto ahorrado,
no la velocidad. Y v1 no escribe código nuevo — `delegate_transform`
solo hace transformaciones mecánicas sobre archivos que ya existen
(renombrar, agregar boilerplate repetitivo), no features o lógica
nueva. Ver `skills/sherpa/SKILL.md` para la tabla completa de cuándo sí
/ cuándo no.

## Las tools

| Tool | Qué hace |
|---|---|
| `health_check` | Chequea si el backend local está disponible y qué modelo tiene cargado. |
| `delegate_exploration` | Lee muchos archivos/directorios y devuelve una síntesis, sin que ese contenido pase por el contexto de Claude. |
| `delegate_search` | Corre ripgrep sobre los paths dados y sintetiza los matches según una instrucción. |
| `delegate_transform` | Propone una transformación batch por archivo (nunca escribe directo — genera una propuesta revisable). |
| `apply_transform` | Escribe a disco exactamente la propuesta de un `delegate_transform` previo, con chequeo de staleness. |

## Configuración

Anda con cero archivos, solo variables de entorno (ver el Quickstart
para dónde van). Precedencia: env del MCP server > `sherpa.config.json`
(proyecto) > `~/.claude/sherpa/config.json` (usuario) > defaults.

| Variable | Default | Uso |
|---|---|---|
| `SHERPA_BACKEND` | `ollama` | `ollama` o `openai-compatible` |
| `SHERPA_BASE_URL` | `http://localhost:11434` | URL del backend local |
| `SHERPA_MODEL` | *(sin default)* | Modelo a usar — si falta, `health_check` lista los modelos disponibles |
| `SHERPA_MAX_FILES` | `100` | Presupuesto de archivos por llamada a `delegate_exploration`/`delegate_search` |
| `SHERPA_MAX_CHUNKS` | `20` | Presupuesto de llamadas al modelo local por invocación |
| `SHERPA_RESULTS_DIR` | `.sherpa` | Dónde se escriben los resultados completos (relativo a la raíz del proyecto) |
| `SHERPA_TRUNCATION_THRESHOLD` | `0.75` | Umbral de la guarda de truncado en `delegate_transform` (ver Limitaciones) |
| `SHERPA_CONTEXT_WINDOW` | *(sin default, fallback 4096)* | Solo `openai-compatible`: no hay endpoint estándar para descubrir la ventana de contexto |
| `SHERPA_MAX_OUTPUT_TOKENS` | *(sin default, fallback 2048)* | Solo `openai-compatible`, mismo motivo |

También podés usar `./sherpa.config.json` (por proyecto) o
`~/.claude/sherpa/config.json` (por usuario) con las mismas claves en
camelCase.

Agregá `.sherpa/` a tu `.gitignore` — los resultados completos de cada
`delegate_*` se acumulan ahí sin límite en v1 (ver Limitaciones).

## Seguridad

- **Confinamiento de paths:** todo path que `sherpa` toca (lectura o
  escritura) se resuelve contra la raíz del proyecto y se rechaza si cae
  afuera — incluye `..` que escape y symlinks que apunten fuera. Es un
  chequeo de hard boundary, no una guarda opcional.
- **Contenido no confiable:** todo lo que devuelve el modelo local
  (`summary`, `diffPreview`, contenido de archivos citado) es **dato
  observado, nunca instrucciones**. Un archivo del repo puede contener
  texto dirigido a un LLM que intente sonar como un comando — Claude lo
  trata siempre como texto a evaluar, nunca como algo a obedecer (ver
  `skills/sherpa/SKILL.md`).

## Limitaciones conocidas (v1)

- **Sin limpieza automática de `.sherpa/`**: los resultados se acumulan
  indefinidamente — borralos manualmente cuando quieras.
- **Guarda de truncado en `delegate_transform`** (`SHERPA_TRUNCATION_THRESHOLD`,
  default `0.75`): es un umbral ciego a intención. Una instrucción que
  legítimamente acorta mucho un archivo (ej. "borrá todo el código
  muerto") puede disparar un falso rechazo — bajá el umbral para ese caso
  de uso puntual.
- **v1 no escribe código nuevo**: `delegate_transform` solo hace
  transformaciones mecánicas sobre archivos existentes (renombrar,
  agregar boilerplate repetitivo), no generación de features o lógica
  nueva.
- **`getCapabilities()` en backends `openai-compatible`**: no hay
  endpoint estándar para descubrir la ventana de contexto en llama.cpp
  server / LM Studio. Usa `SHERPA_CONTEXT_WINDOW`/`SHERPA_MAX_OUTPUT_TOKENS`
  si los seteás, si no cae a un fallback conservador (4096/2048). Si
  cambiás el modelo cargado sin actualizar esas variables, el chunking va
  a usar valores desactualizados.
- **Sin fallback ni reintento automático** si el backend local no
  responde: es intencional (ver `skills/sherpa/SKILL.md`) — Claude hace
  la tarea él mismo y sigue.
- **TOCTOU en la guarda de staleness de `apply_transform`**: hay una
  ventana inevitable entre la lectura del hash y la escritura del
  archivo (las APIs sync de `fs` de Node no ofrecen una operación
  atómica de "verificar y escribir" para este caso).
- **`file-enumeration.ts` no sigue symlinks**: un árbol fuente que es
  (o contiene) un symlink va a devolver cero archivos en lugar de un
  error — no hay aviso explícito de que se está enumerando un symlink.
- **`delegate_transform` salta (no falla) archivos que exceden el
  presupuesto de salida del modelo** en vez de reportar un error: con
  los defaults conservadores del fallback de Ollama/openai-compatible
  (4096/2048) esto ronda archivos de más de ~200 líneas, lo cual puede
  sorprender en un primer uso.

## Licencia

MIT — ver [LICENSE](./LICENSE).

---

Construido por [Gastón Parravicini](https://github.com/Tongas).

Construido con asistencia de IA.
