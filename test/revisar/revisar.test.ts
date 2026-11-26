import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  avisosResumen,
  crearPreguntador,
  interpretarRespuesta,
  PREGUNTA_CONFIRMAR,
  PREGUNTA_RESUMEN,
  revisarPendientes,
  type Preguntar,
} from "../../src/revisar/revisar.ts";

type Registro = Record<string, unknown>;

function noticia(id: string, campos: Registro): Registro {
  return {
    id,
    titular: `Titular ${id} de GTA 6`,
    medio: "Medio A",
    fecha: "2026-11-01T00:00:00.000Z",
    enlace: `https://medio-a.example/${id}`,
    resumen: null,
    estado: "pendiente",
    recogida: "2026-11-26T12:00:00.000Z",
    ...campos,
  };
}

// Pendientes: p1 (oct), p2 y p3 (nov). Ya revisadas: a1 y d1.
const INICIAL: Record<string, Registro[]> = {
  "2026-10.json": [
    noticia("p1", { titular: "GTA 6: tráiler 3 confirmado", fecha: "2026-10-15T07:00:00.000Z" }),
    noticia("a1", { estado: "aprobada", resumen: "Ya aprobada antes.", fecha: "2026-10-10T00:00:00.000Z" }),
  ],
  "2026-11.json": [
    noticia("p3", {
      titular: "GTA VI tendrá el mapa más grande",
      medio: "Medio B",
      fecha: "2026-11-25T10:00:00.000Z",
      campo_extra: { conservar: [1, 2, 3] },
    }),
    noticia("d1", { estado: "descartada", fecha: "2026-11-21T00:00:00.000Z" }),
    noticia("p2", { titular: "GTA 6 costará 70 dólares", fecha: "2026-11-20T10:00:00.000Z" }),
  ],
};

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gta-radar-revisar-"));
  for (const [archivo, noticias] of Object.entries(INICIAL)) {
    await writeFile(join(dir, archivo), `${JSON.stringify(noticias, null, 2)}\n`);
  }
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function leer(archivo: string): Promise<Registro[]> {
  return JSON.parse(await readFile(join(dir, archivo), "utf8")) as Registro[];
}

async function buscar(id: string): Promise<Registro | undefined> {
  return [...(await leer("2026-10.json")), ...(await leer("2026-11.json"))].find((n) => n.id === id);
}

/** Respuestas guionizadas: una por pregunta; si se acaban, fin de la entrada (null). */
function guion(...respuestas: Array<string | null | (() => Promise<string | null>)>) {
  const preguntas: string[] = [];
  const preguntar: Preguntar = async (pregunta) => {
    preguntas.push(pregunta);
    const r = respuestas.shift();
    if (r === undefined) return null;
    return typeof r === "function" ? r() : r;
  };
  return { preguntar, preguntas };
}

async function revisar(preguntar: Preguntar) {
  let salida = "";
  const resultado = await revisarPendientes({ dirNoticias: dir, preguntar, escribir: (t) => void (salida += t) });
  return { resultado, salida };
}

describe("revisarPendientes", () => {
  it("muestra solo las pendientes, de la más antigua a la más reciente, con titular, medio, fecha y enlace", async () => {
    const { preguntar } = guion("", "", "");
    const { salida, resultado } = await revisar(preguntar);

    const orden = ["GTA 6: tráiler 3 confirmado", "GTA 6 costará 70 dólares", "GTA VI tendrá el mapa más grande"].map((t) =>
      salida.indexOf(t),
    );
    assert.ok(orden.every((pos) => pos >= 0), "aparecen las tres pendientes");
    assert.deepEqual([...orden].sort((a, b) => a - b), orden, "en orden de fecha");
    assert.doesNotMatch(salida, /Titular a1|Titular d1/, "no muestra las ya revisadas");
    assert.match(salida, /Medio:\s+Medio B/);
    assert.match(salida, /Fecha:\s+2026-11-25 10:00 UTC/);
    assert.match(salida, /Enlace:\s+https:\/\/medio-a\.example\/p1/);
    assert.match(salida, /\[1\/3\]/);
    assert.deepEqual(resultado, { aprobadas: 0, descartadas: 0, saltadas: 3, noGuardadas: 0, quedan: 3 });
  });

  it("Enter salta sin escribir nada en disco", async () => {
    const antes = await Promise.all(Object.keys(INICIAL).map((a) => readFile(join(dir, a), "utf8")));
    await revisar(guion("", "", "").preguntar);
    const despues = await Promise.all(Object.keys(INICIAL).map((a) => readFile(join(dir, a), "utf8")));
    assert.deepEqual(despues, antes);
  });

  it("una frase aprueba, «d» descarta y Enter salta", async () => {
    const { resultado } = await revisar(guion("  Rockstar   confirmó el tráiler 3.  ", "d", "").preguntar);

    const p1 = await buscar("p1");
    assert.equal(p1?.estado, "aprobada");
    assert.equal(p1?.resumen, "Rockstar confirmó el tráiler 3.", "se recorta y se normalizan los espacios");

    const p2 = await buscar("p2");
    assert.equal(p2?.estado, "descartada");
    assert.equal(p2?.resumen, null, "descartar no toca el resumen");

    const p3 = await buscar("p3");
    assert.equal(p3?.estado, "pendiente");
    assert.equal(p3?.resumen, null);

    assert.deepEqual(resultado, { aprobadas: 1, descartadas: 1, saltadas: 1, noGuardadas: 0, quedan: 1 });
  });

  it("solo cambia «resumen» y «estado»: ni otros campos, ni su orden, ni otras noticias", async () => {
    await revisar(guion("d", "GTA 6 costará 70 dólares en consolas.", "Rockstar confirmó el mapa.").preguntar);

    for (const [archivo, antes] of Object.entries(INICIAL)) {
      const despues = await leer(archivo);
      assert.deepEqual(despues.map((n) => n.id), antes.map((n) => n.id), `${archivo}: mismas noticias y mismo orden`);
      despues.forEach((n, i) => {
        const original = antes[i]!;
        assert.deepEqual(Object.keys(n), Object.keys(original), `${n.id}: mismas claves en el mismo orden`);
        const { resumen: _r1, estado: _e1, ...resto } = n;
        const { resumen: _r2, estado: _e2, ...restoOriginal } = original;
        assert.deepEqual(resto, restoOriginal, `${n.id}: el resto de campos sigue igual`);
        if (original.estado !== "pendiente") assert.deepEqual(n, original, `${n.id}: ya revisada, intacta`);
      });
    }
    assert.deepEqual((await buscar("p3"))?.campo_extra, { conservar: [1, 2, 3] });
  });

  it("guarda cada decisión en el momento", async () => {
    let p1AlPreguntarSiguiente: Registro | undefined;
    await revisar(
      guion("Rockstar confirmó el tráiler 3.", async () => {
        p1AlPreguntarSiguiente = await buscar("p1");
        return null;
      }).preguntar,
    );
    assert.equal(p1AlPreguntarSiguiente?.estado, "aprobada");
  });

  it("«D» y « d » también descartan", async () => {
    await revisar(guion("D", " d ").preguntar);
    assert.equal((await buscar("p1"))?.estado, "descartada");
    assert.equal((await buscar("p2"))?.estado, "descartada");
  });

  it("«q» sale sin tocar nada más", async () => {
    const { resultado } = await revisar(guion("d", "q").preguntar);
    assert.equal((await buscar("p1"))?.estado, "descartada");
    assert.equal((await buscar("p2"))?.estado, "pendiente");
    assert.equal(resultado.quedan, 2);
  });

  it("el fin de la entrada (Ctrl+D) termina limpio", async () => {
    const { resultado, salida } = await revisar(guion().preguntar);
    assert.equal(resultado.quedan, 3);
    assert.match(salida, /Quedan pendientes: 3/);
  });

  it("si el resumen incumple el contrato, avisa y pide confirmación", async () => {
    const { preguntas, preguntar } = guion(
      "Rockstar retrasa GTA 6. Llegará en 2027.",
      "n", // no se guarda: vuelve a preguntar por la misma noticia
      "Rockstar retrasa GTA 6 a 2027.",
      "Costará 80 euros.",
      "s", // se guarda pese al aviso
    );
    const { salida } = await revisar(preguntar);

    assert.match(salida, /más de una frase/);
    assert.match(salida, /dólares/);
    assert.deepEqual(preguntas.slice(0, 5), [
      PREGUNTA_RESUMEN,
      PREGUNTA_CONFIRMAR,
      PREGUNTA_RESUMEN,
      PREGUNTA_RESUMEN,
      PREGUNTA_CONFIRMAR,
    ]);
    assert.equal((await buscar("p1"))?.resumen, "Rockstar retrasa GTA 6 a 2027.");
    assert.equal((await buscar("p2"))?.resumen, "Costará 80 euros.");
    assert.equal((await buscar("p2"))?.estado, "aprobada");
  });

  it("no pisa una noticia que alguien revisó mientras tanto", async () => {
    const { resultado, salida } = await revisar(
      guion(async () => {
        const octubre = await leer("2026-10.json");
        Object.assign(octubre[0]!, { estado: "aprobada", resumen: "Resumen de otra persona." });
        await writeFile(join(dir, "2026-10.json"), `${JSON.stringify(octubre, null, 2)}\n`);
        return "Mi resumen.";
      }).preguntar,
    );
    assert.equal((await buscar("p1"))?.resumen, "Resumen de otra persona.");
    assert.equal(resultado.noGuardadas, 1);
    assert.match(salida, /alguien la revisó/);
  });

  it("conserva lo que el recolector añada durante la revisión", async () => {
    await revisar(
      guion("", async () => {
        const noviembre = await leer("2026-11.json");
        noviembre.push(noticia("nueva", { fecha: "2026-11-26T11:00:00.000Z" }));
        await writeFile(join(dir, "2026-11.json"), `${JSON.stringify(noviembre, null, 2)}\n`);
        return "d";
      }).preguntar,
    );
    assert.equal((await buscar("p2"))?.estado, "descartada");
    assert.equal((await buscar("nueva"))?.estado, "pendiente", "la noticia nueva sigue ahí");
  });

  it("no deja que un titular manipule la terminal", async () => {
    const octubre = await leer("2026-10.json");
    octubre[0]!.titular = "GTA 6 \u001b[2J\u001b[31mrojo\u0007";
    await writeFile(join(dir, "2026-10.json"), JSON.stringify(octubre));
    const { salida } = await revisar(guion().preguntar);
    assert.doesNotMatch(salida, /[\u0000-\u0009\u000b-\u001f]/);
    assert.match(salida, /GTA 6 \[2J\[31mrojo/);
  });

  it("sin pendientes, lo dice y no pregunta nada", async () => {
    const vacio = await mkdtemp(join(tmpdir(), "gta-radar-revisar-vacio-"));
    try {
      const { preguntas, preguntar } = guion();
      let salida = "";
      const r = await revisarPendientes({ dirNoticias: join(vacio, "no-existe"), preguntar, escribir: (t) => void (salida += t) });
      assert.match(salida, /No hay noticias pendientes/);
      assert.equal(preguntas.length, 0);
      assert.equal(r.quedan, 0);
    } finally {
      await rm(vacio, { recursive: true, force: true });
    }
  });
});

describe("interpretarRespuesta", () => {
  it("distingue saltar, descartar, salir y aprobar", () => {
    assert.deepEqual(interpretarRespuesta(""), { tipo: "saltar" });
    assert.deepEqual(interpretarRespuesta("   "), { tipo: "saltar" });
    assert.deepEqual(interpretarRespuesta("d"), { tipo: "descartar" });
    assert.deepEqual(interpretarRespuesta("Q"), { tipo: "salir" });
    assert.deepEqual(interpretarRespuesta(" Un  resumen. "), { tipo: "aprobar", resumen: "Un resumen." });
    assert.deepEqual(interpretarRespuesta("de nada"), { tipo: "aprobar", resumen: "de nada" });
  });
});

describe("avisosResumen", () => {
  it("acepta una frase con cifras en dólares", () => {
    assert.deepEqual(avisosResumen("GTA 6 costará 70 dólares en PS5 y Xbox."), []);
    assert.deepEqual(avisosResumen("¿Llegará GTA 6 a PC en 2027?"), []);
  });
  it("avisa de varias frases, euros/libras y textos demasiado largos", () => {
    assert.equal(avisosResumen("Primera frase. Segunda frase.").length, 1);
    assert.equal(avisosResumen("Costará 80 €.").length, 1);
    assert.equal(avisosResumen("Costará 80 euros").length, 1);
    assert.equal(avisosResumen("Costará 70 libras").length, 1);
    assert.equal(avisosResumen("a".repeat(281)).length, 1);
  });
});

describe("crearPreguntador", () => {
  it("lee una línea por pregunta, muestra la pregunta y devuelve null al cerrarse la entrada", async () => {
    const entrada = new PassThrough();
    const salida = new PassThrough();
    let mostrado = "";
    salida.on("data", (trozo: Buffer) => (mostrado += trozo.toString("utf8")));

    const { preguntar, cerrar } = crearPreguntador(entrada, salida);
    entrada.write("Rockstar confirmó la fecha.\n");
    entrada.write("d\n");
    entrada.end();

    assert.equal(await preguntar("Primera › "), "Rockstar confirmó la fecha.");
    assert.equal(await preguntar("Segunda › "), "d");
    assert.equal(await preguntar("Tercera › "), null);
    cerrar();
    assert.match(mostrado, /Primera › /);
    assert.match(mostrado, /Segunda › /);
  });

  it("si la entrada ya estaba cerrada (stdin vacío), devuelve null sin lanzar", async () => {
    const entrada = new PassThrough();
    const { preguntar, cerrar } = crearPreguntador(entrada, new PassThrough());
    entrada.end();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(await preguntar("¿Algo? › "), null);
    assert.equal(await preguntar("¿Otra vez? › "), null);
    cerrar();
    cerrar();
  });
});
