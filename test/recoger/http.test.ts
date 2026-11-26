import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  descargarTexto,
  esperaPedidaPorServidor,
  HttpError,
  LimiteTamanoError,
  pedirConReintentos,
  USER_AGENT,
  type FetchFn,
} from "../../src/recoger/http.ts";

/** fetch falso que va devolviendo las respuestas en orden y apunta cada llamada. */
function secuencia(...pasos: Array<Response | Error>) {
  const llamadas: Array<{ url: string; init?: RequestInit }> = [];
  const fetchFn: FetchFn = async (url, init) => {
    llamadas.push({ url, init });
    const paso = pasos[Math.min(llamadas.length - 1, pasos.length - 1)];
    if (paso instanceof Error) throw paso;
    if (!paso) throw new Error("secuencia vacía");
    return paso.clone();
  };
  return { fetchFn, llamadas };
}

function esperasFalsas() {
  const esperas: number[] = [];
  return { esperas, sleepFn: async (ms: number) => void esperas.push(ms) };
}

const URL_PRUEBA = "https://medio.example/feed.xml";

describe("pedirConReintentos", () => {
  it("reintenta un 503 y devuelve la respuesta buena", async () => {
    const { fetchFn, llamadas } = secuencia(new Response(null, { status: 503 }), new Response("ok"));
    const { esperas, sleepFn } = esperasFalsas();
    const r = await pedirConReintentos(URL_PRUEBA, { fetchFn, sleepFn, baseEsperaMs: 100 });
    assert.equal(await r.text(), "ok");
    assert.equal(llamadas.length, 2);
    assert.equal(esperas.length, 1);
    assert.ok(esperas[0]! >= 100 && esperas[0]! < 100 + 250);
  });

  it("respeta retry-after en segundos", async () => {
    const { fetchFn } = secuencia(new Response(null, { status: 429, headers: { "retry-after": "2" } }), new Response("ok"));
    const { esperas, sleepFn } = esperasFalsas();
    await pedirConReintentos(URL_PRUEBA, { fetchFn, sleepFn });
    assert.deepEqual(esperas, [2000]);
  });

  it("abandona sin esperar si el servidor pide más que la espera máxima", async () => {
    const { fetchFn, llamadas } = secuencia(new Response(null, { status: 429, headers: { "retry-after": "3600" } }));
    const { esperas, sleepFn } = esperasFalsas();
    await assert.rejects(pedirConReintentos(URL_PRUEBA, { fetchFn, sleepFn, maxEsperaMs: 60_000 }), (err) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, 429);
      assert.match(err.message, /respetar su límite/);
      return true;
    });
    assert.equal(llamadas.length, 1);
    assert.deepEqual(esperas, []);
  });

  it("no reintenta para siempre: maxReintentos + 1 intentos", async () => {
    const { fetchFn, llamadas } = secuencia(new Response(null, { status: 500 }));
    const { sleepFn } = esperasFalsas();
    await assert.rejects(pedirConReintentos(URL_PRUEBA, { fetchFn, sleepFn, maxReintentos: 2 }), HttpError);
    assert.equal(llamadas.length, 3);
  });

  it("no reintenta un 404", async () => {
    const { fetchFn, llamadas } = secuencia(new Response(null, { status: 404 }));
    const { sleepFn } = esperasFalsas();
    await assert.rejects(pedirConReintentos(URL_PRUEBA, { fetchFn, sleepFn }), (err) => err instanceof HttpError && err.status === 404);
    assert.equal(llamadas.length, 1);
  });

  it("reintenta errores de red", async () => {
    const { fetchFn, llamadas } = secuencia(new TypeError("fetch failed"), new Response("ok"));
    const { sleepFn } = esperasFalsas();
    const r = await pedirConReintentos(URL_PRUEBA, { fetchFn, sleepFn });
    assert.equal(await r.text(), "ok");
    assert.equal(llamadas.length, 2);
  });

  it("corta cada intento al agotarse el tiempo", async () => {
    let intentos = 0;
    const colgado: FetchFn = (_url, init) =>
      new Promise((_resolver, rechazar) => {
        intentos++;
        init?.signal?.addEventListener("abort", () => rechazar(init.signal?.reason));
      });
    const { sleepFn } = esperasFalsas();
    await assert.rejects(
      pedirConReintentos(URL_PRUEBA, { fetchFn: colgado, sleepFn, timeoutMs: 20, maxReintentos: 1 }),
      /tiempo agotado \(20 ms\)/,
    );
    assert.equal(intentos, 2);
  });

  it("manda un User-Agent genérico", async () => {
    const { fetchFn, llamadas } = secuencia(new Response("ok"));
    await pedirConReintentos(URL_PRUEBA, { fetchFn });
    const headers = llamadas[0]?.init?.headers as Record<string, string>;
    assert.equal(headers["user-agent"], USER_AGENT);
  });
});

describe("esperaPedidaPorServidor", () => {
  const ahora = Date.parse("2026-11-26T12:00:00Z");

  it("entiende retry-after como fecha HTTP", () => {
    const r = new Response(null, { status: 503, headers: { "retry-after": "Thu, 26 Nov 2026 12:00:30 GMT" } });
    assert.equal(esperaPedidaPorServidor(r, ahora), 30_000);
  });

  it("entiende x-ratelimit-reset en segundos epoch y en segundos restantes", () => {
    const epoch = new Response(null, {
      status: 429,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(ahora / 1000 + 10) },
    });
    assert.equal(esperaPedidaPorServidor(epoch, ahora), 10_000);
    const delta = new Response(null, { status: 429, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "5" } });
    assert.equal(esperaPedidaPorServidor(delta, ahora), 5_000);
  });

  it("devuelve null si el servidor no dice nada", () => {
    assert.equal(esperaPedidaPorServidor(new Response(null, { status: 503 }), ahora), null);
  });
});

describe("descargarTexto", () => {
  it("rechaza respuestas que declaran más bytes del máximo", async () => {
    const { fetchFn } = secuencia(new Response("x".repeat(10), { headers: { "content-length": "999999" } }));
    await assert.rejects(descargarTexto(URL_PRUEBA, { fetchFn, maxBytes: 1000 }), LimiteTamanoError);
  });

  it("corta la descarga si el cuerpo crece por encima del máximo", async () => {
    let trozosServidos = 0;
    const infinito = new ReadableStream<Uint8Array>({
      pull(control) {
        trozosServidos++;
        control.enqueue(new Uint8Array(1024));
      },
    });
    const fetchFn: FetchFn = async () => new Response(infinito);
    await assert.rejects(descargarTexto(URL_PRUEBA, { fetchFn, maxBytes: 4096 }), LimiteTamanoError);
    assert.ok(trozosServidos < 10);
  });

  it("decodifica con el charset de la cabecera", async () => {
    const bytes = Buffer.from("Código y año", "latin1");
    const fetchFn: FetchFn = async () =>
      new Response(bytes, { headers: { "content-type": "application/rss+xml; charset=ISO-8859-1" } });
    assert.equal(await descargarTexto(URL_PRUEBA, { fetchFn }), "Código y año");
  });

  it("decodifica con el encoding de la declaración XML si no hay charset", async () => {
    const bytes = Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><t>Tráiler</t>', "latin1");
    const fetchFn: FetchFn = async () => new Response(bytes);
    assert.match(await descargarTexto(URL_PRUEBA, { fetchFn }), /<t>Tráiler<\/t>/);
  });
});
