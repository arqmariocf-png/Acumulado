// Cola de marcas del checador guardadas en el teléfono cuando no hay señal
// (IndexedDB: la foto se guarda como Blob, cosa que localStorage no puede).
// Se vacía en orden al recuperar la conexión; cada marca viaja con la hora
// real en que se hizo (marcadaEn) para que el registro quede correcto.

export interface MarcaPendiente {
  id: string;
  profileId: string;
  tipo: "entrada" | "salida" | "comida_inicio" | "comida_fin";
  foto: Blob | null;
  lat: number;
  lng: number;
  precision: number;
  marcadaEn: string;
  dispositivo: string;
  /** Mensaje del servidor cuando rechazó la marca (no de red): se muestra
   * para que la persona la descarte o avise a RH. */
  error?: string | null;
}

const BD = "acumulado-checador";
const ALMACEN = "pendientes";

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) {
      reject(new Error("Este navegador no permite guardar marcas sin señal."));
      return;
    }
    const req = indexedDB.open(BD, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ALMACEN)) db.createObjectStore(ALMACEN, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("No se pudo abrir el almacenamiento local."));
  });
}

function pedir<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Error de almacenamiento local."));
  });
}

export async function guardarPendiente(marca: MarcaPendiente): Promise<void> {
  const db = await abrir();
  await pedir(db.transaction(ALMACEN, "readwrite").objectStore(ALMACEN).put(marca));
  db.close();
}

export async function listarPendientes(profileId: string): Promise<MarcaPendiente[]> {
  const db = await abrir();
  const todas = await pedir(db.transaction(ALMACEN, "readonly").objectStore(ALMACEN).getAll());
  db.close();
  return (todas as MarcaPendiente[]).filter((m) => m.profileId === profileId).sort((a, b) => a.marcadaEn.localeCompare(b.marcadaEn));
}

export async function eliminarPendiente(id: string): Promise<void> {
  const db = await abrir();
  await pedir(db.transaction(ALMACEN, "readwrite").objectStore(ALMACEN).delete(id));
  db.close();
}

export function nuevoId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** true cuando el fallo fue de red (sin señal, DNS, servidor inalcanzable)
 * y no una respuesta del servidor. fetch lanza TypeError en ese caso. */
export function esErrorDeRed(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof Error && /Failed to fetch|NetworkError|Load failed|network/i.test(err.message));
}
