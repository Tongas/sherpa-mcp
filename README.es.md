[English](./README.md) | Español

# sherpa

**Un plugin de Claude Code que delega el trabajo pesado — leer, buscar y editar código en batch — a tu LLM local.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Tongas/sherpa-mcp/pulls)

Usá tu suscripción de Claude y tu IA local al mismo tiempo, dentro de
Claude Code. Claude pone el razonamiento; tu modelo local hace la lectura
pesada. Vos ahorrás tokens.

## Cómo funciona

Cuando delegás una tarea, tu modelo local lee, busca o reescribe archivos
en tu propio hardware. Al contexto de Claude Code vuelve solo un resumen
corto — el contenido de los archivos nunca entra. El sherpa carga el
peso; vos seguís decidiendo la ruta.

sherpa viene como plugin de Claude Code: un MCP server con cinco tools,
un skill que le enseña a Claude cuándo delegar conviene, y un comando
`/sherpa-status` para diagnosticar tu configuración.

## La evidencia

Explorando el mismo codebase Python de 3 capas, mismo prompt, de dos
formas:

| | Directo (Claude lee los archivos) | Con sherpa |
|---|---|---|
| Tokens que entran al contexto de Claude | ~190.000 (el contenido de los archivos) | ~600 (solo el resumen) |
| Tokens procesados localmente | 0 | ~149.000 |
| Tiempo real (wall-clock) | ~39s | ~100s |
| Archivos cubiertos | 41 | 24 |

Dos cosas importan más que el ratio:

**El resumen delegado se sostuvo.** Claude ya había mapeado ese mismo
codebase a mano en un turno anterior. Cuando volvió el resumen de sherpa,
coincidía: mismo conteo de checks, mismos patrones internos, misma cadena
del modelo de datos. El modelo local no produjo una respuesta más vaga —
produjo la misma respuesta sin gastar contexto del orquestador.

**Delegar es más lento, no más rápido.** Del orden de 2 a 4 veces en
tiempo real. El valor acá es el contexto ahorrado, no la velocidad. Ver
[Cuándo NO usarlo](#cuándo-no-usarlo).

**Esto es una medición, en un repo, con un modelo — no un benchmark.** Tu
ratio real depende del tamaño de los archivos, la instrucción, y el
modelo que uses.

## Quickstart

Prerequisitos: Node.js ≥ 18, [ripgrep](https://github.com/BurntSushi/ripgrep#installation)
(`rg`) en `PATH`, y un backend local corriendo (Ollama, llama.cpp server,
o LM Studio).

### Camino principal: instalar el plugin

Esto te da el MCP server, el skill y `/sherpa-status` juntos, de una:

```
/plugin marketplace add Tongas/sherpa-mcp
/plugin install sherpa@sherpa-mcp
```

**Configurá el backend.** Un MCP server instalado vía plugin hereda el
entorno del propio proceso de Claude Code — no hay una forma documentada
de adjuntarle un bloque `env` propio después de instalarlo vía
marketplace. Así que seteá las variables `SHERPA_*` en tu shell profile
(`~/.bashrc`, `~/.zshrc`, etc.) antes de lanzar `claude`:

```bash
export SHERPA_BASE_URL="http://localhost:11434"   # default de Ollama
export SHERPA_MODEL="qwen2.5-coder:14b"            # el modelo que tengas descargado
```

Para un backend `openai-compatible` (llama.cpp server, LM Studio),
exportá también `SHERPA_BACKEND=openai-compatible` más
`SHERPA_CONTEXT_WINDOW` y `SHERPA_MAX_OUTPUT_TOKENS` con los valores
reales de tu server — ver la tabla de [Configuración](#configuración)
más abajo para qué hace cada uno. No hay endpoint estándar para
descubrir la ventana de contexto, así que sin esto sherpa cae a un
conservador 4096/2048, lo que hace que `delegate_transform` saltee
archivos de más de unas 200 líneas.

**Verificá:** abrí una sesión nueva y corré `/sherpa-status`. Muestra el
backend activo, el modelo cargado, y de dónde salió cada valor de
config, para que un typo no pase desapercibido.

### Alternativa: solo el MCP server, vía npx

Usá esto si solo querés las tools — por ejemplo, para conectar sherpa a
algo que no sea Claude Code. **No vas a tener el skill ni
`/sherpa-status`**, o sea que no hay guía automática de cuándo conviene
delegar ni una forma integrada de chequear qué quedó configurado; vas a
tener que invocar las tools explícitamente y conocer tu propio setup.

Agregá esto a `~/.claude.json` (o a un `.mcp.json` de proyecto) — acá el
bloque `env` es explícito y sí funciona, porque estás registrando el MCP
server directo, no a través de un plugin:

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

Para un backend `openai-compatible`, agregá `SHERPA_BACKEND`,
`SHERPA_CONTEXT_WINDOW` y `SHERPA_MAX_OUTPUT_TOKENS` a ese mismo bloque
`env`, igual que arriba.

Probado con llama.cpp server. También soporta Ollama y LM Studio vía la
misma interfaz OpenAI-compatible.

#### Instalación desde un clone (desarrollo)

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

## Prompts de ejemplo

Estos son prompts que efectivamente corrimos, no hipotéticos. Nombrá
sherpa en el prompt — ver [Activación automática vs. explícita](#activación-automática-vs-explícita)
para saber por qué.

**1. Reconocimiento de codebase — el caso principal:**

> Usá sherpa para explorar este proyecto y decime cómo está estructurada
> la lógica de auditoría

Medido: 24 archivos, ~149k tokens procesados localmente, ~100s, y solo el
resumen entró al contexto de Claude.

**2. Búsqueda con síntesis:**

> Usá sherpa para encontrar todos los usos de la API vieja de logging y
> resumime qué hay que cambiar

ripgrep hace la búsqueda; el modelo local solo sintetiza los matches.

**3. Transformación batch:**

> Usá sherpa para renombrar la clave de config `oldName` a `newName` en
> todo el proyecto

`dry_run` es el default: obtenés una propuesta revisable con diffs por
archivo, no se escribe nada. Después `apply_transform` escribe
exactamente lo que revisaste — sin regenerar, y rechaza cualquier archivo
que haya cambiado en disco mientras tanto.

## Activación automática vs. explícita

El plugin trae un skill que le enseña a Claude cuándo delegar conviene, y
a veces se dispara solo. Pero en la práctica, la activación automática no
es confiable para exploración: Claude a menudo prefiere sus herramientas
nativas (`Read`, `Grep`, el agente Explore) aunque el skill esté cargado
y las tools estén visibles.

**Para tener garantía, nombrá sherpa en el prompt.** La invocación
explícita funciona de forma consistente.

Medido en Claude Code v2.x. Puede cambiar en versiones futuras.

## Cuándo NO usarlo

Si Claude ya tiene el mapa del proyecto en contexto — archivos ya leídos
en esta sesión, o un codebase chico — las herramientas directas ganan
siempre. Delegar cuesta un round trip; leer dos archivos conocidos no.

Delegar es más lento, no más rápido. El valor es el contexto ahorrado, no
la velocidad.

Y v1 no escribe código nuevo: `delegate_transform` hace transformaciones
mecánicas sobre archivos que ya existen (renombrar, boilerplate
repetitivo), no features ni lógica nueva. Ver `skills/sherpa/SKILL.md`
para la tabla completa de cuándo sí / cuándo no.

## Las tools

| Tool | Qué hace |
|---|---|
| `health_check` | Chequea si el backend local está disponible y qué modelo tiene cargado. |
| `delegate_exploration` | Lee muchos archivos/directorios y devuelve una síntesis, sin que ese contenido pase por el contexto de Claude. |
| `delegate_search` | Corre ripgrep sobre los paths dados y sintetiza los matches según una instrucción. |
| `delegate_transform` | Propone una transformación batch por archivo (nunca escribe directo — genera una propuesta revisable). |
| `apply_transform` | Escribe a disco exactamente la propuesta de un `delegate_transform` previo, con chequeo de staleness. |

## Configuración

Anda con cero archivos, solo variables de entorno (ver el Quickstart para
dónde van). Precedencia: env del MCP server > `sherpa.config.json`
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
`delegate_*` se acumulan ahí sin límite en v1.

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
- **`delegate_transform` saltea (no falla) archivos que exceden el
  presupuesto de salida del modelo**: con los defaults conservadores del
  fallback (4096/2048) esto afecta archivos de más de unas 200 líneas.
  Poné en `SHERPA_CONTEXT_WINDOW`/`SHERPA_MAX_OUTPUT_TOKENS` los valores
  reales de tu server para evitarlo.
- **Guarda de truncado en `delegate_transform`**
  (`SHERPA_TRUNCATION_THRESHOLD`, default `0.75`): es un umbral ciego a
  intención. Una instrucción que legítimamente acorta mucho un archivo
  (ej. "borrá todo el código muerto") puede disparar un falso rechazo —
  bajá el umbral para ese caso de uso puntual.
- **v1 no escribe código nuevo**: solo transformaciones mecánicas sobre
  archivos existentes, no features ni lógica nueva.
- **`getCapabilities()` en backends `openai-compatible`**: no hay
  endpoint estándar para descubrir la ventana de contexto en llama.cpp
  server / LM Studio. Si cambiás el modelo cargado sin actualizar las
  variables de entorno, el chunking va a usar valores desactualizados.
- **Sin fallback ni reintento automático** si el backend local no
  responde: es intencional — Claude hace la tarea él mismo y sigue, sin
  interrumpir tu sesión.
- **TOCTOU en la guarda de staleness de `apply_transform`**: hay una
  ventana inevitable entre la lectura del hash y la escritura del archivo
  (las APIs sync de `fs` de Node no ofrecen una operación atómica de
  "verificar y escribir" para este caso).
- **`file-enumeration.ts` no sigue symlinks**: un árbol fuente que es (o
  contiene) un symlink devuelve cero archivos en lugar de un error — no
  hay aviso explícito de que se está enumerando un symlink.

## Licencia

MIT — ver [LICENSE](./LICENSE).

---

Construido por [Gastón Parravicini](https://github.com/Tongas).

Construido con asistencia de IA.
