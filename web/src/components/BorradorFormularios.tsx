import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { borradorVigente, campoRespaldable, claveBorrador, descriptorCampo, firmaFormulario, type Borrador } from "../lib/borradores";

// Respaldo de lo capturado en los formularios (Mario, 9-oct-2026: "cuando
// cambian de ventana se pierden los cambios llenados en el formulario").
// Si el celular descarta la pestaña y al volver la recarga, lo escrito en
// cualquier <form> de la pantalla se devuelve solo. Se borra al enviar o al
// limpiar el formulario; un form con data-sin-borrador queda fuera.

type Campo = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function camposDe(form: HTMLFormElement): { campo: Campo; clave: string }[] {
  const vistos = new Map<string, number>();
  const res: { campo: Campo; clave: string }[] = [];
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
    const d = { tag: el.tagName, type: el instanceof HTMLInputElement ? el.type : null, name: el.name, id: el.id, placeholder: "placeholder" in el ? el.placeholder : null, ariaLabel: el.getAttribute("aria-label") };
    if (!campoRespaldable(d)) continue;
    const desc = descriptorCampo(d);
    const n = vistos.get(desc) ?? 0;
    vistos.set(desc, n + 1);
    res.push({ campo: el, clave: `${desc}#${n}` });
  }
  return res;
}

function claveDe(ruta: string, form: HTMLFormElement, campos = camposDe(form)): string {
  return claveBorrador(ruta, firmaFormulario(campos.map((c) => c.clave)));
}

function valorDe(c: Campo): string {
  if (c instanceof HTMLInputElement && (c.type === "checkbox" || c.type === "radio")) return c.checked ? "1" : "0";
  return c.value;
}

/** Pone el valor de forma que React también se entere (inputs controlados). */
function ponerValor(c: Campo, v: string) {
  if (c instanceof HTMLInputElement && (c.type === "checkbox" || c.type === "radio")) {
    if (c.checked !== (v === "1")) c.click();
    return;
  }
  const proto = c instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : c instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(c, v);
  c.dispatchEvent(new Event("input", { bubbles: true }));
  c.dispatchEvent(new Event("change", { bubbles: true }));
}

function leer(clave: string): Borrador | null {
  try {
    return borradorVigente(sessionStorage.getItem(clave), Date.now());
  } catch {
    return null;
  }
}

export function BorradorFormularios() {
  const { pathname } = useLocation();
  const [recuperado, setRecuperado] = useState(false);
  const restaurando = useRef(false);

  useEffect(() => {
    setRecuperado(false);
    const tocados = new WeakSet<Element>();
    const restaurados = new WeakSet<Element>();

    // Formularios repetidos en la pantalla (uno por renglón) tienen la misma
    // firma: no se sabe a cuál pertenece el borrador, así que no se respaldan.
    function firmasRepetidas(): Set<string> {
      const n = new Map<string, number>();
      for (const f of Array.from(document.querySelectorAll("form"))) {
        const k = claveDe(pathname, f);
        n.set(k, (n.get(k) ?? 0) + 1);
      }
      return new Set([...n].filter(([, c]) => c > 1).map(([k]) => k));
    }

    function guardar(e: Event) {
      if (restaurando.current) return;
      const el = e.target as Element | null;
      const form = el?.closest?.("form");
      if (!form || form.hasAttribute("data-sin-borrador")) return;
      tocados.add(el as Element);
      const campos = camposDe(form);
      if (!campos.some((c) => c.campo === el)) return;
      const clave = claveDe(pathname, form, campos);
      if (firmasRepetidas().has(clave)) return;
      const datos: Record<string, string> = {};
      for (const c of campos) datos[c.clave] = valorDe(c.campo);
      try {
        sessionStorage.setItem(clave, JSON.stringify({ guardado: Date.now(), campos: datos }));
      } catch {
        /* sin almacenamiento */
      }
    }

    function olvidar(e: Event) {
      const form = e.target as HTMLFormElement | null;
      if (!(form instanceof HTMLFormElement)) return;
      try {
        sessionStorage.removeItem(claveDe(pathname, form));
      } catch {
        /* sin almacenamiento */
      }
    }

    function restaurar() {
      let alguno = false;
      const repetidas = firmasRepetidas();
      for (const form of Array.from(document.querySelectorAll("form"))) {
        if (form.hasAttribute("data-sin-borrador")) continue;
        const campos = camposDe(form);
        if (campos.length === 0) continue;
        const clave = claveDe(pathname, form, campos);
        if (repetidas.has(clave)) continue;
        const b = leer(clave);
        if (!b) continue;
        restaurando.current = true;
        try {
          for (const { campo, clave } of campos) {
            if (restaurados.has(campo) || tocados.has(campo)) continue;
            restaurados.add(campo);
            const v = b.campos[clave];
            if (v === undefined || v === valorDe(campo)) continue;
            // Un select solo si la opción ya existe (las listas cargan después).
            if (campo instanceof HTMLSelectElement && !Array.from(campo.options).some((o) => o.value === v)) {
              restaurados.delete(campo);
              continue;
            }
            ponerValor(campo, v);
            alguno = true;
          }
        } finally {
          restaurando.current = false;
        }
      }
      if (alguno) setRecuperado(true);
    }

    let pendiente = 0;
    const observador = new MutationObserver(() => {
      if (pendiente) return;
      pendiente = requestAnimationFrame(() => {
        pendiente = 0;
        restaurar();
      });
    });
    observador.observe(document.body, { childList: true, subtree: true });
    restaurar();
    document.addEventListener("input", guardar, true);
    document.addEventListener("change", guardar, true);
    document.addEventListener("submit", olvidar, true);
    document.addEventListener("reset", olvidar, true);
    return () => {
      observador.disconnect();
      if (pendiente) cancelAnimationFrame(pendiente);
      document.removeEventListener("input", guardar, true);
      document.removeEventListener("change", guardar, true);
      document.removeEventListener("submit", olvidar, true);
      document.removeEventListener("reset", olvidar, true);
    };
  }, [pathname]);

  if (!recuperado) return null;
  return (
    <div className="fixed bottom-3 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900 shadow">
      <span>Recuperamos lo que habías capturado en esta pantalla.</span>
      <button
        type="button"
        className="font-medium underline"
        onClick={() => {
          try {
            for (const k of Object.keys(sessionStorage)) if (k.startsWith(`borrador:${pathname}:`)) sessionStorage.removeItem(k);
          } catch {
            /* sin almacenamiento */
          }
          window.location.reload();
        }}
      >
        Descartar
      </button>
      <button type="button" aria-label="Cerrar aviso" onClick={() => setRecuperado(false)} className="text-sky-700">
        ✕
      </button>
    </div>
  );
}
