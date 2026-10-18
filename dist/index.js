/**
 * LA GITHUB ACTION DE UXMACHINE · DESPLIEGUE-1 · orden firmada por Albert (17-10-2026)
 *
 * Tras un despliegue pide UNA medida de la dirección publicada (`POST /action/despliegue`), deja el enlace del informe en
 * el resumen del trabajo y, con `esperar`, pregunta su estado (`GET /action/estado/{id}`) cada 20 s hasta 12 minutos. Si
 * termina, añade al resumen lo que dice el servidor; si no, deja sólo el enlace.
 *
 * ── NUNCA TERMINA EN ROJO ───────────────────────────────────────────────────────────────────────────────────────────
 * Un despliegue en rojo se lee como un juicio. Toda negativa del servidor, un 401, un 4xx, un 5xx, un error de red o el
 * tiempo agotado salen como aviso (`::warning::`) y la Action sale con 0. Nunca `setFailed`.
 *
 * ── SUS TEXTOS ──────────────────────────────────────────────────────────────────────────────────────────────────────
 * Los del resumen y los avisos son los firmados por Albert (18-10-2026, `TEXTOS-DE-LA-ACTION.md`, 11 a 18 y 21), literales,
 * en el idioma del input `idioma`. Lo demás es lo que trae el servidor (su `texto`) o datos (el enlace).
 *
 * ── LA CLAVE ────────────────────────────────────────────────────────────────────────────────────────────────────────
 * Va sólo en la cabecera `Authorization`. Nunca en una URL, en el resumen ni en la salida.
 *
 * Sin dependencias: lo poco que haría `@actions/core` (leer un input, un aviso, el resumen) va aquí escrito. Así el
 * fichero es el código, sin compilar, y no arrastra paquetes de terceros.
 */
"use strict";
const fs = require("node:fs");

/** Cada cuánto se pregunta y hasta cuándo. */
const CADA_MS = 20_000;
const TOPE_MS = 12 * 60_000;
/** Lo que tarda como mucho una llamada. */
const LLAMADA_MS = 30_000;
/** Los estados de `estado` que todavía no han terminado. */
const SIN_TERMINAR = ["en_cola", "en_curso", "pedida"];
/** Los entornos de despliegue que cuentan como producción. */
const PRODUCCION = ["Production", "production"];
/** ACCION-AJUSTES · y «Production – <lo que sea>», con guion largo y espacios: así lo manda Vercel con varios proyectos. */
const PRODUCCION_DE_UN_PROYECTO = /^Production – .+$/;
const esProduccion = (entorno) => PRODUCCION.includes(entorno) || PRODUCCION_DE_UN_PROYECTO.test(entorno);

/** 11–18, 21, 25 y 29 de `TEXTOS-DE-LA-ACTION.md`, firmados por Albert (18-10-2026), literales. */
const TEXTOS = Object.freeze({
  es: Object.freeze({
    cabecera: (sha7) => `UXMachine · medido después del despliegue ${sha7}`,
    enlace: "Ver el informe",
    esperando: "Esperando a que termine la medida (hasta 12 minutos).",
    sigue_en_curso: "La medida sigue en curso. Cuando termine, la verás en el informe.",
    memoria: "Comparación con la medida anterior de esta web",
    que_se_midio: (sha7) => `Medimos lo que servía la dirección cuando le llegó el turno, después del despliegue ${sha7}. Si hay una caché delante o llegó otro despliegue mientras tanto, puede ser otra versión.`,
    no_es_produccion: (entorno) => `No se mide: este despliegue no es del entorno de producción (${entorno}).`,
    sin_url: "No se mide: falta la dirección. Pon en el input url la dirección de tu web publicada.",
    sin_conexion: (codigo) => `No hemos podido hablar con UXMachine (${codigo}). Tu despliegue no se ve afectado; esta vez no hay medida.`,
    clave_no_vale: "No podemos medir: la clave de la Action no es válida o se ha quitado. Crea una nueva en tu panel y guárdala en el secreto UXMACHINE_KEY.",
    primera_medida: "Es la primera medida de esta web con esta cuenta. La próxima se comparará con esta.",
  }),
  en: Object.freeze({
    cabecera: (sha7) => `UXMachine · measured after deployment ${sha7}`,
    enlace: "See the report",
    esperando: "Waiting for the measurement to finish (up to 12 minutes).",
    sigue_en_curso: "The measurement is still running. When it finishes, you will see it in the report.",
    memoria: "Compared with the previous measurement of this site",
    que_se_midio: (sha7) => `We measured what the address served when its turn came, after deployment ${sha7}. If there is a cache in front of it or another deployment arrived meanwhile, it may be a different version.`,
    no_es_produccion: (entorno) => `Not measured: this deployment is not to the production environment (${entorno}).`,
    sin_url: "Not measured: no address. Set the url input to the address of your published site.",
    sin_conexion: (codigo) => `We could not reach UXMachine (${codigo}). Your deployment is not affected; there is no measurement this time.`,
    clave_no_vale: "We cannot measure: the Action key is not valid or has been removed. Create a new one in your panel and store it in the UXMACHINE_KEY secret.",
    primera_medida: "This is the first measurement of this site with this account. The next one will be compared with it.",
  }),
});

/**
 * ACCION-AJUSTES · el aviso de una respuesta sin texto: un 401 es la clave, y se dice con el texto 25 (`clave_no_vale`,
 * el de A.10); cualquier otro código, con el de no poder hablar con UXMachine (18).
 */
const avisoDelCodigo = (T, estado) => (estado === 401 ? T.clave_no_vale : T.sin_conexion(String(estado)));

/**
 * ACCION-COMPARACION · el texto de memoria de una respuesta de `estado` terminada: el bloque de `contenido` que va
 * justo detrás de la frase («ha terminado») y antes del JSON, el que escribe `CANAL_MEMORIA`. Sólo existe cuando la
 * memoria tiene algo que decir; la invitación al Seguimiento, si sale, va siempre detrás de él. `null` si no lo hay.
 */
const textoDeMemoria = (cuerpo) => {
  const c = Array.isArray(cuerpo?.contenido) ? cuerpo.contenido : [];
  return c.length >= 3 && typeof c[1] === "string" && c[1] && !c[1].startsWith("```") ? c[1] : null;
};

/** Un input, como lo pasa GitHub: `INPUT_<NOMBRE>` en mayúsculas. */
const entrada = (env, nombre) => String(env[`INPUT_${nombre.replace(/ /g, "_").toUpperCase()}`] ?? "").trim();
/** El escapado de los comandos de flujo de GitHub. */
const escapar = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

/**
 * El cuerpo de la Action, con todo lo que toca el mundo inyectado (para el test): `env`, `fetch`, `dormir(ms)`, `ahora()`,
 * `escribir(texto)` (la salida del trabajo) y `resumir(texto)` (el resumen). Nunca lanza.
 */
async function ejecutar({ env = process.env, fetch: pedir = globalThis.fetch, dormir = (ms) => new Promise((r) => setTimeout(r, ms)),
  ahora = () => Date.now(), escribir = (t) => process.stdout.write(t), resumir = null } = {}) {
  const avisar = (codigo) => escribir(`::warning::${escapar(codigo)}\n`);
  const resumen = resumir ?? ((t) => { if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, t); });
  /** El idioma de los avisos: el del input en cuanto se lee; hasta entonces, el inglés por omisión. */
  let T = TEXTOS.en;
  try {
    const clave = entrada(env, "clave");
    const servidor = (entrada(env, "servidor") || "https://uxmachine.app").replace(/\/+$/, "");
    const entorno = entrada(env, "entorno") || "publicada";
    const idioma = entrada(env, "idioma") || "en";
    T = idioma === "es" ? TEXTOS.es : TEXTOS.en;
    const esperar = entrada(env, "esperar") !== "false";
    const confirmar = entrada(env, "confirmar_publicada") === "true";
    const minimoTexto = entrada(env, "minimo_entre_medidas_h");
    const minimo = minimoTexto === "" ? 6 : Number(minimoTexto);

    /**
     * ACCION-AJUSTES · la dirección es siempre la del input `url`, obligatorio: el evento `deployment_status` sólo
     * decide cuándo. Las direcciones que da el evento cambian con cada despliegue y no se podrían comparar.
     */
    let evento = {};
    try { evento = env.GITHUB_EVENT_PATH ? JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, "utf8")) : {}; } catch { evento = {}; }
    const delDespliegue = env.GITHUB_EVENT_NAME === "deployment_status" ? evento.deployment_status ?? null : null;
    if (delDespliegue && entorno === "publicada") {
      const suEntorno = evento.deployment?.environment ?? delDespliegue.environment ?? "";
      if (!esProduccion(suEntorno)) { avisar(T.no_es_produccion(suEntorno)); return 0; }
    }
    const url = entrada(env, "url");
    if (!url) { avisar(T.sin_url); return 0; }
    const sha = evento.deployment?.sha || env.GITHUB_SHA || "";
    const repo = env.GITHUB_REPOSITORY || "";

    const cabeceras = { authorization: `Bearer ${clave}`, "content-type": "application/json", accept: "application/json" };
    const llamar = async (ruta, opciones = {}) => {
      try {
        const r = await pedir(`${servidor}${ruta}`, { ...opciones, headers: cabeceras, signal: AbortSignal.timeout(LLAMADA_MS) });
        let cuerpo = null;
        try { cuerpo = await r.json(); } catch { cuerpo = null; }
        return { estado: r.status, cuerpo };
      } catch (e) { return { estado: 0, cuerpo: null, codigo: e?.cause?.code || e?.name || "error" }; }
    };

    const p = await llamar("/action/despliegue", { method: "POST", body: JSON.stringify({ url, repo, sha, entorno,
      confirmar_publicada: confirmar, minimo_entre_medidas_h: Number.isFinite(minimo) && minimo >= 0 ? minimo : 6, idioma }) });
    if (p.estado === 0) { avisar(T.sin_conexion(p.codigo)); return 0; }
    if (p.estado === 200 && p.cuerpo?.estado) {
      /** `medida_reciente` o `action_ocupada`: lo que dice el servidor (su código, si no trae frase). */
      let dice = p.cuerpo.texto || p.cuerpo.estado;
      /** 19 · si la anterior falló, detrás de la frase va, tal cual, el `texto` de su estado. */
      const ultima = p.cuerpo.ultima;
      if (p.cuerpo.estado === "medida_reciente" && ultima?.estado === "fallida" && ultima.id) {
        const e = await llamar(`/action/estado/${encodeURIComponent(ultima.id)}?idioma=${encodeURIComponent(idioma)}`);
        if (e.estado === 200 && typeof e.cuerpo?.texto === "string" && e.cuerpo.texto) dice = `${dice} ${e.cuerpo.texto}`;
      }
      avisar(dice);
      resumen(`${dice}\n`);
      return 0;
    }
    if (p.estado !== 202 || !p.cuerpo?.id) {
      avisar(p.cuerpo?.texto || avisoDelCodigo(T, p.estado));
      return 0;
    }
    const sha7 = sha.slice(0, 7);
    resumen(`## ${T.cabecera(sha7)}\n\n${T.que_se_midio(sha7)}\n\n[${T.enlace}](${p.cuerpo.informe})\n`
      + (p.cuerpo.texto ? `\n${p.cuerpo.texto}\n` : ""));
    if (!esperar) return 0;
    resumen(`\n${T.esperando}\n`);

    const fin = ahora() + TOPE_MS;
    while (ahora() < fin) {
      await dormir(CADA_MS);
      const e = await llamar(`/action/estado/${encodeURIComponent(p.cuerpo.id)}?idioma=${encodeURIComponent(idioma)}`);
      if (e.estado !== 200) {
        if (e.estado === 0) continue;
        avisar(avisoDelCodigo(T, e.estado));
        return 0;
      }
      const estado = e.cuerpo?.datos?.estado;
      if (SIN_TERMINAR.includes(estado)) continue;
      /**
       * Terminada (o no se pudo terminar): primero la frase de la respuesta (con su enlace), y después, bajo el rótulo
       * 15, el texto de memoria tal cual; sin él, con la memoria «sin_anterior», el 29; en otro caso, sin rótulo.
       */
      if (e.cuerpo?.texto) resumen(`\n${e.cuerpo.texto}\n`);
      const memoria = textoDeMemoria(e.cuerpo)
        ?? (e.cuerpo?.datos?.memoria?.estado === "sin_anterior" ? T.primera_medida : null);
      if (memoria) resumen(`\n### ${T.memoria}\n\n${memoria}\n`);
      return 0;
    }
    resumen(`\n${T.sigue_en_curso}\n`);
    return 0;
  } catch (e) {
    avisar(T.sin_conexion(e?.name || "error"));
    return 0;
  }
}

module.exports = { ejecutar, CADA_MS, TOPE_MS, TEXTOS };

if (require.main === module) {
  ejecutar().then(() => { process.exitCode = 0; }, () => { process.exitCode = 0; });
}
