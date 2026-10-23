// Descarga de un archivo generado en el navegador (CSV, Excel, PDF, Word).
// Safari (23-oct-2026, Laura no podía bajar el Excel de OV) no descarga si el
// enlace no está en el documento o si la liga blob se libera en seguida; aquí
// el <a> se agrega al body, se hace clic y la liga se libera un minuto después.
// Toda descarga nueva pasa por aquí; nunca `a.click()` suelto.

export function descargarBlob(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
}

/** CSV para Excel: BOM para que respete acentos. */
export function descargarCsv(nombre: string, csv: string): void {
  descargarBlob(new Blob(["﻿" + csv.replace(/^﻿/, "")], { type: "text/csv;charset=utf-8" }), nombre);
}

export function descargarTexto(nombre: string, contenido: string, tipo: string): void {
  descargarBlob(new Blob(["﻿" + contenido.replace(/^﻿/, "")], { type: tipo }), nombre);
}
