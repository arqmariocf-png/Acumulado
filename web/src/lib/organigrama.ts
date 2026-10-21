import { SECCIONES, type SeccionMenu } from "./menu";

/** Organigrama de dirección general (Mario, 25-sep-2026): los departamentos
 * con responsable, color y las opciones del menú que les tocan. */
export interface AreaOrganigrama extends SeccionMenu {
  responsable: string | null;
  color: string;
}

const DETALLE: Record<string, { responsable: string | null; color: string }> = {
  finanzas: { responsable: "Laura Ortaza", color: "bg-emerald-600" },
  contabilidad: { responsable: "Delia Farfán", color: "bg-teal-600" },
  legal: { responsable: "Belén Vergara / Eréndira Solís", color: "bg-rose-700" },
  rh: { responsable: "Fernando Gómez / Eréndira Solís", color: "bg-violet-600" },
  almacen: { responsable: null, color: "bg-amber-600" },
  compras: { responsable: null, color: "bg-violet-600" },
  logistica: { responsable: null, color: "bg-orange-600" },
  mantenimiento: { responsable: "Christian Bonifacio", color: "bg-sky-600" },
  operacion: { responsable: null, color: "bg-slate-700" },
  sistemas: { responsable: "Mario Contreras", color: "bg-zinc-700" },
};

/** Los departamentos del organigrama. Desde el deber ser (21-oct-2026) el
 * menú va por proceso (7 grupos, 22 menús) y ya no coincide con los
 * departamentos: cada menú dice a qué departamento pertenece (`area`) y aquí
 * se juntan sus opciones. Las claves son las de los KPIs (lib/indicadores.ts)
 * y las de los tableros de tareas por área. */
const DEPARTAMENTOS: { clave: string; titulo: string; proposito: string }[] = [
  { clave: "finanzas", titulo: "Finanzas", proposito: "Tesorería, cuentas por pagar, cobranza y presupuestos de las 8 empresas." },
  { clave: "contabilidad", titulo: "Contabilidad", proposito: "Conciliación bancaria, CFDI y datos fiscales." },
  { clave: "legal", titulo: "Legal", proposito: "Asuntos y juicios, crédito a clientes, contratos y cumplimiento normativo." },
  { clave: "rh", titulo: "Recursos humanos", proposito: "Personal, expedientes, nómina, checador y accesos al sistema." },
  { clave: "almacen", titulo: "Almacén", proposito: "Entradas y salidas contra OC/OV, existencias y herramienta." },
  { clave: "compras", titulo: "Compras y ventas", proposito: "Requisiciones, órdenes de compra, servicio y venta, cotizaciones y CRM." },
  { clave: "logistica", titulo: "Logística", proposito: "Remisiones, entregas y fletes." },
  { clave: "mantenimiento", titulo: "Mantenimiento", proposito: "La cuadrilla de mantenimiento BBVA: folios, equilibrio y control." },
  { clave: "operacion", titulo: "Operación", proposito: "Obras, precios unitarios y las plantas de producción." },
  { clave: "sistemas", titulo: "Sistemas", proposito: "Usuarios, permisos, catálogos y guía de uso." },
];

export const AREAS: AreaOrganigrama[] = DEPARTAMENTOS.map((d) => ({
  ...d,
  entradas: SECCIONES.filter((s) => s.area === d.clave).flatMap((s) => s.entradas),
  ...(DETALLE[d.clave] ?? { responsable: null, color: "bg-slate-600" }),
}));

export function areaDeClave(clave: string | undefined): AreaOrganigrama | undefined {
  return AREAS.find((a) => a.clave === clave);
}
