# Auditoría de Vice City Diario (VCR): recogida de noticias y fuentes

Fecha: 2026-11-26 · Repositorio auditado: `~/vice-city-diario` · Solo lectura.

**Alcance.** He leído `app/radar.py`, `app/fuentes.py`, `app/db.py`, `app/config.py`, `app/main.py` (rutas del
radar), `app/factory/script.py`, `app/factory/pipeline.py`, `app/factory/no_repetir.py`, `herramientas/` y el README.
La base de datos `data/vice_city_diario.db` la abrí con `mode=ro&immutable=1` (SQLite no escribe ni bloquea nada) y
solo saqué el esquema y recuentos. **No** abrí `app/factory/largo/` ni `data/largo/`. Lo que digo de esas carpetas
viene de comentarios en `db.py`, `main.py` y el README, y lo marco como *(sin leer)*.

Las rutas de este documento son relativas a `~/vice-city-diario`.

## Resumen

- VCR recoge noticias por **RSS** (2 búsquedas de Google News y 20 feeds directos de medios), y después hace
  **scraping** del HTML de cada artículo con `httpx` + `trafilatura` para tener el texto completo.
- El texto completo de los artículos **se guarda en disco** en cuatro sitios: unos 340 ficheros y ~2 MB (ver §4). En
  la tabla `news` también se guardan hasta 1000 caracteres de la descripción del feed, que en 5 medios son los
  primeros párrafos del artículo.
- Todo el sistema de verificación de guiones (§3) **compara contra ese texto guardado**. Si se quita el texto sin
  cambiar el código, se rompen `reverificar`, `elegir_gancho`, `cambiar_cierre_serie` y `no_repetir`.
- No hay ningún filtro de cheats, códigos, mod menus ni filtraciones en la recogida. Solo se exige que el texto
  hable de GTA 6.
- Google News se pide con un User-Agent de Chrome y una cookie `CONSENT=YES+` forzada. Eso contradice la regla del
  propio VCR («User-Agent honesto, nada de saltarse bloqueos») y hay que revisarlo antes de dar esa fuente por
  `permitido: true`.

---

## 1. Cómo recoge noticias hoy

### Quién lo dispara

| Disparador | Dónde | Qué llama |
|---|---|---|
| Botón «Actualizar radar» del panel | `app/main.py:352` `radar_refresh()` → `POST /radar/actualizar` | `radar.refresh_youtube()` + `radar.refresh_news()` |
| Propuesta diaria de las 10:00 (tarea de Windows → WSL) | `herramientas/propuesta_diaria.sh:54` | `radar.refresh_news()` y luego otra vez `radar.refresh_medios()` (se ejecuta dos veces, porque `refresh_news` ya la llama) |
| «Comprobar fuentes y valorar impacto» (vídeo largo) | `app/factory/largo/seleccion.py` *(sin leer)* | según el README, `fuentes.verificar_recientes()` + valoración con qwen3 en la GPU |
| CLI | `python -m app.fuentes verificar [--dias 7]` · `python -m app.fuentes url ID URL` | `fuentes.verificar_recientes()` / `fuentes.verificar()` |

No hay nada programado: `apscheduler` está en `requirements.txt`, pero el HANDOFF lo deja como pendiente.

### Fuentes y método

| # | Fuente | Método | Archivo · función | Detalles |
|---|---|---|---|---|
| a | Google News, búsqueda `"GTA 6"` en `es/ES` y en `en-US/US` | RSS | `app/radar.py:27` `DEFAULT_FEEDS` · `app/radar.py:185` `refresh_news()` | Se puede cambiar con `RSS_FEEDS` en el `.env`. Máximo 30 entradas por feed. **User-Agent de Chrome + cookie `CONSENT=YES+`** (`app/radar.py:33-40`). El enlace es una redirección de `news.google.com`, no la URL del medio. El medio se saca partiendo el titular por «` - `» (`_split_gnews_title`). |
| b | 20 medios con RSS propio: Vandal, Eurogamer.es/.net, 3DJuegos, VidaExtra, Hobbyconsolas, IGN/IGN España, Infobae, Xataka, PlayStation Blog (es/en), Xbox Wire, Kotaku, Polygon, GamesIndustry.biz, Game Informer, The Verge, Variety, BBC | RSS | `app/radar.py:45` `MEDIOS_RSS` · `app/radar.py:224` `_feed_medio()` · `app/radar.py:238` `refresh_medios()` | User-Agent honesto `ViceCityDiarioBot/1.0` (`app/fuentes.py:35`). Solo entran las entradas cuyo titular o descripción cumple `GTA6_RE` (`app/radar.py:67`). `url_real` = enlace pasado por `limpiar_url()`. |
| c | Enlace de Google News → artículo real | Emparejamiento aproximado de titulares | `app/fuentes.py:275` `enlazar_google_news()` | `rapidfuzz.ratio` ≥ 95 (+10 si coincide el medio) contra las entradas de (b) de los últimos 14 días. |
| d | Texto completo del artículo | **Scraping** (GET del HTML + `trafilatura.extract`) | `app/fuentes.py:114` `descargar()` · `:125` `extraer()` · `:137` `bajar()` · `:165` `_guardar()` · `:214` `verificar()` · `:245` `verificar_recientes()` | User-Agent honesto. 401/403/451 se respetan: se apunta el error y no se intenta saltar. **No se mira `robots.txt` ni los términos de uso.** Los medios van en paralelo (6 hilos) y las peticiones a un mismo medio, en serie. |
| e | Fuentes de la propuesta diaria | Scraping (lo mismo que d) | `herramientas/bajar_articulo.py:24` `bajar()` | Lo lanza `claude -p`, que también tiene `WebSearch` y `WebFetch` (`propuesta_diaria.sh:57-63`). Escribe en `data/fuentes/propuestas/FECHA/`. |
| f | Manual | URL pegada o texto en un fichero | Panel: `app/main.py:421` `largo_noticia_url()` → `fuentes.verificar()`. CLI: `pipeline nuevo --texto F --url U` (`app/factory/pipeline.py:81`) | Así se han hecho en la práctica los Shorts: ninguno de los 26 `videos` tiene `news_id`. |
| g | Vídeos de YouTube en tendencia | API de YouTube Data v3 (`search.list` + `videos.list`) | `app/radar.py:96` `refresh_youtube()` | Búsquedas `GTA 6`, `GTA VI` y `GTA 6 español` de las últimas 72 h. Va a `radar_videos` y `radar_snapshots`, no a `news`. |

**Lo que se guarda de cada entrada del feed** (`app/radar.py:213` y `:257`): `source[:60]`, `title[:300]`, `url`
(UNIQUE), `summary[:1000]` (la descripción del feed: HTML crudo en Google News y sin etiquetas en los medios
directos) y `published_at` (la cadena del feed tal cual: mezcla RFC 822 e ISO).

**Estado de la base de datos (2026-11-26, de 2026-11-19 a 2026-11-26):** 727 noticias. 324 vienen de Google News y
403 de RSS directo. 432 tienen `url_real`. De esas, a 272 ya se les ha bajado el texto (270 `ok` y 2 `corta`); el
resto, 455, siguen sin comprobar. Hay 60 filas con `source = '""GTA 6"" - Google News'`, porque no se pudo separar el
medio del titular.

**Filtros de la recogida:** solo `GTA6_RE` en los feeds directos y la búsqueda `"GTA 6"` en Google News. **No hay
exclusión de cheats, códigos, mod menus ni filtraciones.** Los rumores y filtraciones solo se detectan después: en el
guion con `script._RUMOR_RE` (`app/factory/script.py:565`) y en el vídeo largo con `news.impacto_rumor` (qwen3, *sin
leer*).

---

## 2. Esquema de la SQLite

Fichero: `data/vice_city_diario.db` (`journal_mode = delete`, 1,2 MB). Esquema en `app/db.py:10` `SCHEMA`, más las
migraciones de `app/db.py:136` `NEWS_COLUMNAS` y de `init_db()` (`:170`). Solo hay índices automáticos (PK y UNIQUE).

### `news` (727 filas): la tabla que sustituiría el contrato

| Columna | Tipo | Por defecto | Qué es |
|---|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | | |
| `source` | TEXT NOT NULL | | Nombre del medio. El comentario dice «rss \| youtube \| manual», pero en la práctica guarda el medio. |
| `title` | TEXT NOT NULL | | Titular (máx. 300) |
| `url` | TEXT NOT NULL UNIQUE | | Enlace del feed (en Google News, la redirección) |
| `summary` | TEXT | `''` | Descripción del feed (máx. 1000). **Contenido del medio** (ver §4) |
| `published_at` | TEXT | | Fecha del feed sin normalizar |
| `picked` | INTEGER | 0 | Marca para «hacer vídeo». No se usa: 0 filas con 1 |
| `created_at` | TEXT | `datetime('now')` | Entrada al radar (UTC, `AAAA-MM-DD HH:MM:SS`) |
| `url_real` | TEXT | `''` | URL del artículo en el medio |
| `fuente_estado` | TEXT | `''` | `''` sin comprobar · `ok` (≥150 palabras) · `corta` · `error: …` |
| `fuente_palabras` | INTEGER | 0 | Palabras del texto bajado (media 729, máximo 10 279) |
| `fuente_titulo` | TEXT | `''` | Título según trafilatura |
| `fuente_fecha` | TEXT | `''` | Fecha según trafilatura (AAAA-MM-DD) |
| `fuente_at` | TEXT | `''` | Cuándo se bajó |
| `impacto` | INTEGER | NULL | 1-10 según qwen3 (271 valoradas) *(lo escribe `largo/`)* |
| `impacto_tema` | TEXT | `''` | Qué ha pasado, en pocas palabras (qwen3) |
| `impacto_rumor` | INTEGER | 0 | 1 = rumor |
| `impacto_grupo` | TEXT | `''` | Misma clave = mismo hecho contado por varios medios |
| `impacto_junto` | INTEGER | 0 | 1 = da otra cifra del mismo hecho |
| `impacto_at` | TEXT | `''` | |

### Resto de tablas

| Tabla | Filas | Columnas |
|---|---|---|
| `videos` | 26 | `id` PK, `news_id` → news (todas NULL), `hook`, `title`, `script`, `description`, `hashtags`, `kind` (Noticia\|Dato\|Curiosidad\|Guía), `voice`, `source_url`, `duration_s`, `transformation_score`, `risks` (separados por `\|`), `file_path`, `status` (borrador\|pending\|approved\|rejected\|later\|published), `slug`, `published_at`, `url_youtube`, `url_tiktok`, `url_instagram`, `created_at`, `updated_at` |
| `schedule` | 3 | `id` PK, `video_id` → videos, `network`, `text`, `run_at`, `status`, `category` |
| `radar_videos` | 112 | `video_id` PK, `title`, `channel`, `published_at`, `url` |
| `radar_snapshots` | 605 | `id` PK, `video_id` → radar_videos, `views`, `taken_at` |
| `api_usage` | 6 | (`day`, `api`) PK, `calls` |
| `metrics` | 0 | `id` PK, `video_id`, `network`, `views`, `likes`, `retention_pct`, `taken_at` |
| `resumenes` | 2 | `id` PK, `slug` UNIQUE, `titulo`, `estado`, `opciones` (JSON), `pid`, `trabajo`, `fase`, `error`, `video_id`, `created_at`, `updated_at` |
| `resumen_capitulos` | 10 | `id` PK, `resumen_id` → resumenes, `clave`, `orden`, **`news_id` → news**, **`news_extra` (JSON con más ids de news)**, `impacto`, `titulo`, `short_slug`, `gancho_confirmado` |
| `resumen_pasos` | 46 | (`resumen_id`, `capitulo_id`, `paso`) PK, `estado`, `hecho`, `total`, `detalle`, `error`, `updated_at` |

Hay además una copia antigua de la base en `backups/vice_city_diario.2026-11-24.antes-del-video-largo.db` (380 KB),
con la misma tabla `news`.

---

## 3. Cómo verifica los guiones contra las fuentes

La regla general es que un guion solo puede usar datos que estén en el texto de la fuente. La comprobación es
**programática** y **depende de tener el texto completo del artículo a mano** (`src = _norm(source_text)`).

### Flujo de un Short

1. `pipeline.nuevo(texto, url)` (`app/factory/pipeline.py:81`) comprueba `no_repetir.coincidencias()` y llama a
   `script.generate_script()`.
2. `generate_script()` (`app/factory/script.py:783`) mete `source_text[:6000]` en el prompt como `FUENTE` y lo manda
   al LLM (`LLM_PROVIDER`: Ollama local por defecto, o Anthropic). El modelo devuelve un JSON con `facts_used` (datos
   copiados literalmente de la fuente) y `puntos[].cita` (frase literal que respalda cada punto).
3. `_issues()` (`:500`) enumera lo que incumple. Si hay algo, se hace **un reintento** con `RETRY_FIX` y se queda la
   respuesta con menos problemas.
4. `quitar_relaciones_sin_fuente()` (`:861`) borra las frases con relaciones de tiempo o superlativos sin fuente,
   salvo las frases propias del vídeo (gancho, suscripción, puente y cierre).
5. `_verificar()` (`:902`) pasa todas las comprobaciones y deja `data["risks"]`.
6. El resultado se guarda en `videos/<slug>/01_guion/guion.json`, en `videos.risks` y en `proyecto.json`. **Los
   riesgos no bloquean nada:** salen en el panel y decide la persona que aprueba.
7. Si alguien retoca el guion a mano, `pipeline guion SLUG --verificar` llama a `reverificar()` (`:892`), que repite
   las comprobaciones sin modelo **leyendo otra vez `00_fuente/fuente.txt`**. `elegir_gancho()` (`pipeline.py:364`) y
   `cambiar_cierre_serie()` (`:379`) también releen ese fichero.

### Comprobaciones (todas contra el texto de la fuente)

| Comprobación | Función | Criterio | Riesgo que deja |
|---|---|---|---|
| Datos citados | `fact_score()` `:206` | `rapidfuzz.partial_ratio` ≥ `FACT_MIN_SCORE` = 80 en todos los `facts_used` | «Dato sin fuente verificada» (también si no hay ninguno) |
| Puntos de lista | `verify_points()` `:394` | cita ≥ 80, palabras del punto (≥4 letras, prefijo de 5) presentes en la fuente, y el guion lo dice (≥85) | «Punto de la lista sin fuente…», «Solo N puntos verificados» |
| Atribuciones y nombres propios | `unsourced_mentions()` `:223` · `_check_mentions()` `:492` | «según», «ha confirmado»… y nombres propios que no aparecen en la fuente. Citar al propio medio y sus alias está permitido | «Atribución sin fuente» |
| Cifras | `unsourced_numbers()` `:253` | Cada número del texto publicado está en la fuente («3.79 billion» = «3.790 millones»). No cuentan las cifras propias: recuento de la lista, parte de la serie y conversiones de `divisas` | «Cifra sin fuente: …» |
| Relaciones de tiempo u orden | `relaciones_sin_fuente()` `:304` | «un día después», «antes de su estreno», «el primer…», o su equivalente en inglés en la fuente | «Relación de tiempo u orden sin fuente», «⏱ …» |
| Superlativos | `superlativos_sin_fuente()` `:367` | «récord», «histórico», «el mayor», «el más …» | «Superlativo sin fuente», «🏆 …» |
| Cifras de rumor | `cifras_de_rumor()` `:576` | La cifra solo aparece en frases de la fuente que cumplen `_RUMOR_RE` (filtración, rumor, insider, leak, estimación…) | «Cifra de rumor o filtración» |
| Medio válido para cifras | `fuente_valida_para_cifras()` `:588` | El host de la URL está en `FUENTES_CIFRAS` (`:555`, oficiales + grandes medios) | «Cifras (…) de una fuente que no es oficial ni un gran medio» |
| Dinero en dólares | `divisas.problemas()` | Importes en € o £ sin convertir | «Dinero: …» |
| Español neutro | `neutro.problemas()` | Palabras que solo se usan en España (coche, móvil, gafas, vosotros…) | «Español de España: …» |

### «Fuente verificada» a nivel de noticia

`fuentes.describir()` (`app/fuentes.py:190`) define:

- **verificada**: tiene `url_real`, `fuente_estado == 'ok'` (≥150 palabras) y el medio está en `FUENTES_CIFRAS`.
- **usable**: tiene `url_real`, el estado es `ok` o `corta`, y hay ≥80 palabras.

Esto lo usa el vídeo largo para proponer capítulos.

### Casos que no pasan por el verificador

- **Propuesta diaria:** el LLM recibe la orden de bajar cada fuente con `bajar_articulo.py`, leer el `.txt` y citar
  literalmente (`herramientas/propuesta_diaria_prompt.md`, paso 4). Ningún código lo comprueba: depende del prompt.
  La persona revisa y da el OK.
- **`pipeline nuevo --noticia ID`** (`pipeline.py:519`, hay un TODO) usa como «fuente» `title + summary` del feed, no
  el artículo. Es decir, verifica contra la descripción del feed.

---

## 4. Texto de artículos guardado (todo esto habría que eliminarlo)

| Dónde | Qué contiene | Quién lo escribe | Volumen hoy |
|---|---|---|---|
| `data/fuentes/news-<id>.txt` | Cabecera (`FUENTE · Medio (fecha) · título`, URL) + **texto completo** extraído con trafilatura | `app/fuentes.py:165` `_guardar()` | 272 ficheros, 1,7 MB |
| `data/fuentes/propuestas/AAAA-MM-DD/*.txt` | **Texto completo** con los metadatos de trafilatura | `herramientas/bajar_articulo.py:28` | 19 ficheros, 120 KB (2026-11-27) |
| `videos/<slug>/00_fuente/fuente.txt` | **Texto de la fuente** de cada Short | `app/factory/pipeline.py:98` `nuevo()` | 33 ficheros |
| `videos/*_resumen-semanal/00_fuentes/<clave>.txt` y `…/shorts/*/00_fuente/` | **Texto por capítulo** del vídeo largo | `largo/` *(sin leer)* | 10 + 10 ficheros (con los 33 anteriores: 288 KB) |
| `news.summary` (SQLite) | Hasta 1000 caracteres de la descripción del feed. En **3DJuegos (37), VidaExtra (30), Vandal (28), Game Informer (14) y Xataka (4)** llega al tope: son los primeros párrafos del artículo. En Google News es HTML crudo | `app/radar.py:216` y `:259` | 727 filas, 127 con ≥900 caracteres |
| `01_guion/guion.json`: `facts_used`, `puntos[].cita`, `puntos_detalle` | **Fragmentos literales** de la fuente | `app/factory/script.py` | 25 guiones con `facts_used` |
| `docs/propuestas/AAAA-MM-DD.md` y su copia en Descargas de Windows | «Citas literales del texto descargado» (lo pide el prompt) | `propuesta_diaria.sh` | Vacío hoy, pero **`docs/` está versionado y el repo tiene remoto en GitHub**: un push publicaría esas citas |
| `backups/*.db` | Copia de `news` con `summary` | A mano | 1 fichero |

Notas:

- `data/fuentes/` y `videos/*` están en `.gitignore` y `git ls-files` lo confirma: no hay nada versionado ahí.
- Cuando `LLM_PROVIDER=anthropic`, hasta 6000 caracteres del artículo salen hacia la API en cada guion. No es
  almacenamiento, pero el texto sale de la máquina.
- **No encontré descargas de imágenes de los medios** en la recogida de noticias: trafilatura solo extrae texto y las
  imágenes de los vídeos se generan o salen de `biblioteca/`. (El módulo Clips baja vídeos con yt-dlp, «con permiso
  del creador», pero eso queda fuera de las noticias.)
- **Antes de borrar hace falta cambiar código.** Borrar estos ficheros sin más rompe `reverificar`, `elegir_gancho`,
  `cambiar_cierre_serie` (leen `00_fuente/fuente.txt`) y `no_repetir.capitulos_recientes()`
  (`app/factory/no_repetir.py:171`, lee `00_fuentes/<clave>.txt`). Ver §5.
- **Decidido (§6, decisión 1):** las citas literales de `guion.json` cuentan como texto del artículo. Se guarda el
  dato y el enlace, nunca la cita.

---

## 5. Solapamiento con el CONTRATO y qué cambiaría

### Correspondencia campo a campo

**`data/config/fuentes.json`**

| Contrato | En VCR hoy | Comentario |
|---|---|---|
| `id`, `nombre`, `url` | `radar.DEFAULT_FEEDS` (sin nombre) y `radar.MEDIOS_RSS` (nombre, url), **escritos en el código**, más `RSS_FEEDS` en el `.env` | Las 22 URLs de feed sirven de lista de partida, pero cada una necesita sus campos legales (fila siguiente). |
| `tipo: rss` | Lo de arriba | |
| `tipo: youtube` | `refresh_youtube()` hace **búsquedas** por texto, no sigue canales | No coincide: el contrato apunta a una `url` por fuente. |
| `tipo: manual` | URL pegada en el panel o `pipeline nuevo --texto --url` | |
| `aviso_legal_url`, `permitido`, `nota` | **No existen** | VCR no anota los términos de nadie. La única regla es «si responde 401/403/451, no insistir». `FUENTES_CIFRAS` es otra cosa: dice qué medios valen para dar cifras, no si está permitido leerlos. |

**`data/noticias/AAAA-MM.json`**

| Contrato | En VCR (`news`) | Diferencia |
|---|---|---|
| `id` = sha1(enlace canónico) | `id` INTEGER autoincremental. Unicidad por `url` | `fuentes.limpiar_url()` (`app/fuentes.py:51`) canonicaliza a medias: quita `utm_*`, `at_*`, `fbclid`, `gclid`, `ocid`, `cmpid` y el `#fragmento`. Si VCR necesita casar sus noticias antiguas con las nuevas, tiene que aplicar **exactamente** la misma canonicalización que gta-radar. |
| `titular` | `title` | Igual (VCR recorta a 300). |
| `medio` | `source` | En Google News, a veces queda `""GTA 6"" - Google News` (60 filas). |
| `fecha` (ISO) | `published_at` (RFC 822 o ISO, sin normalizar) | `fuentes.fecha_noticia()` lo interpreta. Con el contrato ya viene en ISO. |
| `enlace` | `url_real` o, si no hay, `url` (redirección de Google News) | El contrato resuelve el problema de Google News si gta-radar entrega siempre el enlace del medio. |
| `resumen` (una frase, propia) | **No hay equivalente.** `summary` es texto del medio; `impacto_tema` son «pocas palabras» de qwen3 en la GPU | Ninguno de los dos vale como `resumen`. |
| `estado` (pendiente/aprobada/descartada) | **No hay.** `picked` no se usa; `videos.status` es del vídeo, no de la noticia | El panel muestra las 30 últimas sin filtrar nada. |
| `recogida` (ISO) | `created_at` (UTC `AAAA-MM-DD HH:MM:SS`, sin `T` ni `Z`) | |
| *(no existe)* | `url_real`, `fuente_*` | Necesitan bajar el texto. Desaparecen o pasan a hacerse bajo demanda (ver abajo). |
| *(no existe)* | `impacto*` | qwen3 en la GPU: **ningún agente puede reproducirlo**. Si se mantiene, lo calcula VCR (§5.4). |

### Reglas que se solapan

| Regla del contrato | VCR hoy |
|---|---|
| Nada de scraping que incumpla los términos | Hay scraping del HTML de cada artículo (§1 d y e) y no se miran `robots.txt` ni los términos. Google News se pide con un User-Agent de Chrome y la cookie `CONSENT=YES+` (`app/radar.py:33-40`), al contrario de la regla del propio VCR. Hay que revisarlo con su `aviso_legal_url` antes de marcarla `permitido`. |
| El filtro excluye cheats, códigos, mod menus y filtraciones, pero no «truco» | En la recogida no hay ningún filtro de exclusión. `_RUMOR_RE` (filtración, leak, insider…) solo actúa en el guion. «Truco» no se filtra en ninguna parte, así que no choca. |
| Cifras en dólares | `app/factory/divisas.py` (tipo del BCE con fecha) y `divisas.problemas()` en el guion. Es reutilizable como criterio, no como código (es Python). |
| Español neutro (México > España) | `app/factory/neutro.py` y las reglas del prompt. El mismo criterio aplicado a guiones. |
| La web solo muestra las aprobadas | VCR no tiene web de noticias. Su panel interno enseña todas. |
| Ningún agente usa la GPU | En VCR, la valoración de impacto (qwen3) y los guiones (Ollama) usan la GPU. Son procesos de VCR, no de gta-radar, pero no se pueden trasladar al radar. |

### Qué cambiaría para que el panel lea `data/noticias/*.json`

Son propuestas, no las he aplicado. VCR sigue intacto.

1. **Dejar de recoger noticias en VCR.**
   - Quitar `refresh_news()` de `main.radar_refresh()` (`app/main.py:361`) y la línea 54 de
     `herramientas/propuesta_diaria.sh`.
   - `refresh_medios()`, `enlazar_google_news()`, `DEFAULT_FEEDS` y `MEDIOS_RSS` dejan de usarse.
   - `refresh_youtube()` puede quedarse en VCR: son tendencias de vídeos, no noticias, y usa su propia cuota.

2. **Un lector nuevo** (por ejemplo `app/noticias.py`) que:
   - lea `GTA_RADAR_DIR/data/noticias/AAAA-MM.json`, con la ruta en el `.env`;
   - lea el mes actual y el anterior, para que una ventana de N días no se corte al cambiar de mes;
   - se quede solo con `estado == "aprobada"`;
   - ordene por `fecha`;
   - tolere que falte un fichero o que su JSON esté a medio escribir. Para lo segundo conviene que gta-radar escriba
     a un temporal y lo renombre; es un detalle de implementación y no cambia el contrato.

   Boceto:

   ```python
   def aprobadas(dias: int = 7) -> list[dict]:
       desde = datetime.now(timezone.utc) - timedelta(days=dias)
       meses = {desde.strftime("%Y-%m"), datetime.now(timezone.utc).strftime("%Y-%m")}
       out = []
       for m in sorted(meses):
           f = NOTICIAS_DIR / f"{m}.json"
           try:
               out += json.loads(f.read_text(encoding="utf-8"))
           except (FileNotFoundError, json.JSONDecodeError):
               continue
       return sorted((n for n in out if n["estado"] == "aprobada"
                      and datetime.fromisoformat(n["fecha"]) >= desde),
                     key=lambda n: n["fecha"], reverse=True)
   ```

3. **Identidad de las noticias.** Hoy `news.id` (entero) aparece en `videos.news_id`, en
   `resumen_capitulos.news_id` y `news_extra`, en `00_fuente/fuente.json` (`noticia_id`), en los nombres de
   `data/fuentes/news-<id>.txt` y en `no_repetir`.
   - Cambiarlo cuesta poco: los 26 vídeos tienen `news_id` NULL, así que solo afecta a los 10 capítulos de los 2
     resúmenes.
   - Recomiendo: añadir una columna TEXT con el sha1 del contrato en `videos` y `resumen_capitulos`, y dejar `news`
     como histórico de solo lectura.
   - `news` se puede borrar cuando pase la ventana de `no_repetir` (14 días desde el último resumen, 2026-11-25), es
     decir, a partir del **2026-12-09**.
   - No recomiendo copiar el JSON a SQLite: tendríamos dos fuentes de verdad.

4. **El vídeo largo** (`largo/seleccion.py`, *sin leer*) tiene que sacar sus candidatas del lector y guardar
   `impacto`, `tema`, `rumor`, `grupo` y `junto` en una tabla propia de VCR con el sha1 como clave (por ejemplo
   `valoraciones(noticia TEXT PK, …)`). El contrato no tiene esos campos y gta-radar no puede calcularlos.

5. **La verificación sin texto guardado.** Es el cambio grande.
   - El texto se baja **bajo demanda y solo en memoria**, en el momento del guion y de cada re-verificación, y se
     tira después. Solo de medios con `permitido: true` en `fuentes.json`: VCR tendría que leer ese fichero antes de
     cada descarga.
   - `pipeline.nuevo()` deja de escribir `00_fuente/fuente.txt`. `fuente.json` guarda solo `{url, noticia: sha1}`.
   - `reverificar()`, `elegir_gancho()` y `cambiar_cierre_serie()` vuelven a bajar el artículo. Riesgo: si el medio
     cambia o borra el artículo, la re-verificación ya no da lo mismo. Conviene guardar la fecha de la descarga y
     avisar si el texto cambió (con un hash del texto, que no es el texto).
   - `bajar_articulo.py` deja de escribir ficheros: imprime o devuelve el texto. La propuesta diaria ya tiene
     `WebFetch` para leerlo.
   - `no_repetir` deja de leer `00_fuentes/*.txt` y compara por sha1, titular y `resumen`.
   - `guion.json` deja de guardar las citas literales y guarda solo el dato y el enlace (§6, decisión 1).
   - En `pipeline nuevo --noticia ID`, usar `titular` y `resumen` del JSON sería verificar contra una frase escrita
     por nosotros, no contra el artículo. Esa ruta tiene que bajar el artículo bajo demanda.

6. **El panel.**
   - `radar.html`, sección «Noticias (RSS)»: pasa a leer del lector, enlaza a `enlace` y muestra `medio`, `fecha` y
     `resumen`. El botón «Actualizar radar» solo refresca YouTube.
   - `propuesta_candidatos.py` (`:45-50`) cambia la consulta a `news` por el lector.

7. **Quién escribe `estado`.** Decidido (§6, decisión 2): solo gta-radar escribe `estado`. El panel de VCR solo lee.

8. **Limpieza** (cuando esté hecho lo anterior, no antes): borrar `data/fuentes/`, los `00_fuente/fuente.txt`, los
   `00_fuentes/*.txt` y `backups/*.db`, y vaciar `news.summary`.

---

## 6. Decisiones de Andrés (2026-11-26)

1. **Las citas literales cuentan como texto del artículo.** Se guarda el dato y el enlace, nunca la cita. Esto
   incluye `facts_used`, `puntos[].cita` y `puntos_detalle` de `guion.json`, y las «citas literales» de las
   propuestas diarias.
2. **Solo gta-radar escribe `estado`** en `data/noticias/*.json`. El panel de Vice City Diario solo lee.
