import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MODULOS_ASIGNABLES, esRolBasico, modulosEfectivos } from "./modulos";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { AppRol, Grupo, ModuloClave, Profile, Suscripcion } from "../types/database";
import { aplicarMarca, recordarOrganizacion, urlPublicaDelLogo } from "./marca";

interface AuthState {
  cargando: boolean;
  session: Session | null;
  perfil: Profile | null;
  puedeEscribirEnEmpresa: (empresaId: string) => boolean;
  /** Ve todas las empresas de su organización (admin, o rol multiempresa
   * con la marca "todas"). Alguien con dos empresas asignadas NO ve todas:
   * ve las dos (empresasAlcance). */
  veTodasLasEmpresas: boolean;
  /** Empresas que la persona maneja (fn_mi_alcance): principal + asignadas,
   * o todas las de la organización. Vacío mientras carga. */
  empresasAlcance: string[];
  /** El rol tiene prendido el interruptor "maneja varias empresas". */
  rolMultiempresa: boolean;
  /** Empresa activa (encabezado): todas las pantallas se filtran por ella.
   * null = "todas", solo posible para quien ve todas. */
  empresaActiva: string | null;
  setEmpresaActiva: (empresaId: string | null) => void;
  /** Maneja más de una empresa: se le muestra el selector del encabezado. */
  eligeEmpresa: boolean;
  /** Perfil real de la sesión (sin "ver como"). */
  perfilReal: Profile | null;
  /** Solo admin: navegar la app como otro rol y empresa (interfaz nada más;
   * RLS sigue siendo la del admin). */
  vistaComo: VistaComo | null;
  setVistaComo: (v: VistaComo | null) => void;
  /** Organización (tenant) del usuario. null mientras no tenga una asignada. */
  grupo: Grupo | null;
  /** Módulos abiertos de la organización, para acotar el menú. null mientras no carga. */
  alcanceOrganizacion: { esMaestra: boolean; modulos: ModuloClave[] } | null;
  modulos: ModuloClave[];
  tieneModulo: (clave: ModuloClave) => boolean;
  /** Admin de la organización maestra: opera la plataforma, cruza organizaciones. */
  esAdminGlobal: boolean;
  suscripcion: Suscripcion | null;
  /** false cuando la suscripción venció: se consulta y exporta, pero no se captura. */
  suscripcionPermiteEscribir: boolean;
  /** Espectador u organización sin suscripción: solo ve. */
  soloConsulta: boolean;
  logoUrl: string | null;
  recargarOrganizacion: () => Promise<void>;
  cerrarSesion: () => Promise<void>;
  recuperandoContrasena: boolean;
  terminarRecuperacion: () => void;
  /** Abre la pantalla de contraseña nueva con la sesión normal (quien entró
   * con una contraseña temporal que le dio RH o el admin). */
  cambiarContrasena: () => void;
}

export interface VistaComo {
  rol: AppRol;
  empresaId: string | null;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

function leerJson<T>(clave: string, almacen: Storage): T | null {
  try {
    const crudo = almacen.getItem(clave);
    return crudo ? (JSON.parse(crudo) as T) : null;
  } catch {
    return null;
  }
}
function guardarJson(clave: string, valor: unknown, almacen: Storage) {
  try {
    if (valor === null || valor === undefined) almacen.removeItem(clave);
    else almacen.setItem(clave, JSON.stringify(valor));
  } catch {
    /* sin almacenamiento */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [perfilReal, setPerfil] = useState<Profile | null>(null);
  const [cargando, setCargando] = useState(true);
  const [grupo, setGrupo] = useState<Grupo | null>(null);
  const [modulos, setModulos] = useState<ModuloClave[]>([]);
  const [suscripcion, setSuscripcion] = useState<Suscripcion | null>(null);
  const [alcance, setAlcance] = useState<{ empresas: string[]; todas: boolean; multiempresa: boolean } | null>(null);
  const [empresaActivaGuardada, setEmpresaActivaGuardada] = useState<string | null | undefined>(undefined);
  const [vistaComo, setVistaComoEstado] = useState<VistaComo | null>(null);
  // Se activa cuando el link viene de generar-link-acceso con tipo
  // "recovery" (ver Usuarios.tsx / NuevaContrasena.tsx): supabase-js detecta
  // el token en el hash de la URL al cargar, sin importar en qué ruta cayó,
  // y dispara este evento en vez de un login normal.
  const [recuperandoContrasena, setRecuperandoContrasena] = useState(false);

  useEffect(() => {
    let activo = true;

    // Sesión "zombi": el token sigue guardado pero Supabase ya no la
    // reconoce (cambio de contraseña en otro dispositivo, sesión revocada).
    // getSession no lo detecta porque no consulta al servidor; getUser sí.
    supabase.auth.getUser().then(({ error }) => {
      if (error && (error.status === 401 || error.status === 403)) supabase.auth.signOut().catch(() => {});
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!activo) return;
      setSession(data.session);
    });

    const { data: suscripcion } = supabase.auth.onAuthStateChange((evento, nuevaSession) => {
      if (evento === "PASSWORD_RECOVERY") setRecuperandoContrasena(true);
      setSession(nuevaSession);
    });

    return () => {
      activo = false;
      suscripcion.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let activo = true;
    if (!session) {
      setPerfil(null);
      setGrupo(null);
      setModulos([]);
      setSuscripcion(null);
      setAlcance(null);
      setCargando(false);
      return;
    }
    setCargando(true);
    // Sin señal (checador offline) el perfil no se puede leer; se usa la
    // última copia guardada en este navegador para que la app no mande a
    // "cuenta sin acceso". Con señal, la copia se refresca cada vez.
    const claveCache = `perfil-cache-${session.user.id}`;
    Promise.all([
      supabase
        .from("profiles")
        .select("id, nombre, rol, grupo_id, empresa_id, todas_las_empresas, activo, bbva_mantenimiento, rh_nivel, espectador")
        .eq("id", session.user.id)
        .single(),
      supabase.from("permisos_modulo").select("modulo").eq("profile_id", session.user.id),
      supabase.rpc("fn_mi_alcance"),
    ])
      .then(([{ data: fila, error }, { data: permisos }, { data: alcanceData }]) => {
        if (!activo) return;
        const a = alcanceData as { empresas?: string[]; todas?: boolean; multiempresa?: boolean } | null;
        setAlcance(a ? { empresas: a.empresas ?? [], todas: !!a.todas, multiempresa: !!a.multiempresa } : null);
        const data = fila ? { ...(fila as Omit<Profile, "modulos">), modulos: modulosEfectivos((fila as { rol: Profile["rol"] }).rol, (permisos ?? []).map((m) => String(m.modulo))) } : null;
        if (data) {
          setPerfil(data as Profile);
          // La organización se carga aparte y sin bloquear: sin señal (el
          // checador trabaja offline) el perfil sale del caché local y esto
          // simplemente no resuelve -- la app sigue funcionando, nada más sin
          // la marca ni el aviso de suscripción.
          void cargarOrganizacion((data as Profile).grupo_id);
          try {
            localStorage.setItem(claveCache, JSON.stringify(data));
          } catch {
            /* sin almacenamiento local */
          }
        } else if (error && !navigator.onLine) {
          let cacheado: Profile | null = null;
          try {
            const crudo = localStorage.getItem(claveCache);
            const parcial = crudo ? (JSON.parse(crudo) as Partial<Profile>) : null;
            cacheado = parcial ? ({ ...parcial, modulos: modulosEfectivos(parcial.rol, parcial.modulos) } as Profile) : null;
          } catch {
            cacheado = null;
          }
          setPerfil(cacheado);
        } else {
          setPerfil(null);
        }
        setCargando(false);
      });
    return () => {
      activo = false;
    };
  }, [session]);

  async function cargarOrganizacion(grupoId: string | null) {
    if (!grupoId) {
      setGrupo(null);
      setModulos([]);
      setSuscripcion(null);
      return;
    }

    const [{ data: grupoData }, { data: modulosData }, { data: suscripcionData }] = await Promise.all([
      supabase.from("grupos").select("*").eq("id", grupoId).maybeSingle(),
      supabase.from("grupo_modulos").select("modulo_clave, habilitado").eq("grupo_id", grupoId).eq("habilitado", true),
      supabase.from("v_suscripcion").select("*").eq("grupo_id", grupoId).maybeSingle(),
    ]);

    setGrupo((grupoData as Grupo | null) ?? null);
    setModulos(((modulosData ?? []) as { modulo_clave: ModuloClave }[]).map((m) => m.modulo_clave));
    setSuscripcion((suscripcionData as Suscripcion | null) ?? null);
  }

  async function recargarOrganizacion() {
    await cargarOrganizacion(perfil?.grupo_id ?? null);
  }

  // "Ver como" (Mario, 28-sep-2026): el admin navega la app con otro rol y
  // empresa para revisar qué ve cada quien. Solo cambia la interfaz.
  useEffect(() => {
    if (!perfilReal) {
      setVistaComoEstado(null);
      return;
    }
    setVistaComoEstado(perfilReal.rol === "admin" ? leerJson<VistaComo>(`vista-como-${perfilReal.id}`, sessionStorage) : null);
    setEmpresaActivaGuardada(leerJson<string>(`empresa-activa-${perfilReal.id}`, localStorage));
  }, [perfilReal]);
  function setVistaComo(v: VistaComo | null) {
    if (!perfilReal || perfilReal.rol !== "admin") return;
    setVistaComoEstado(v);
    guardarJson(`vista-como-${perfilReal.id}`, v, sessionStorage);
  }
  const perfil = useMemo<Profile | null>(() => {
    if (!perfilReal || !vistaComo || perfilReal.rol !== "admin") return perfilReal;
    const basico = esRolBasico(vistaComo.rol);
    return {
      ...perfilReal,
      rol: vistaComo.rol,
      empresa_id: vistaComo.empresaId,
      todas_las_empresas: vistaComo.empresaId === null,
      rh_nivel: vistaComo.rol === "rh" ? "directivo" : null,
      modulos: basico ? MODULOS_ASIGNABLES.map((m) => m.clave) : modulosEfectivos(vistaComo.rol, []),
    };
  }, [perfilReal, vistaComo]);

  // Alcance por persona (28-sep-2026): lo dice la base (fn_mi_alcance).
  // Sin señal (perfil del caché) se cae a la regla vieja por rol.
  const alcanceEfectivo = useMemo(() => {
    if (vistaComo && perfilReal?.rol === "admin") {
      const todas = alcance?.empresas ?? [];
      return vistaComo.empresaId ? { empresas: [vistaComo.empresaId], todas: false, multiempresa: false } : { empresas: todas, todas: true, multiempresa: true };
    }
    return alcance;
  }, [alcance, vistaComo, perfilReal]);
  const veTodasLasEmpresas = perfil
    ? alcanceEfectivo
      ? alcanceEfectivo.todas
      : (perfil.rol === "corporativo" || perfil.rol === "admin" || perfil.empresa_id === null) && perfil.rol !== "pendiente"
    : false;
  const empresasAlcance = useMemo(() => alcanceEfectivo?.empresas ?? (perfil?.empresa_id ? [perfil.empresa_id] : []), [alcanceEfectivo, perfil]);
  const rolMultiempresa = alcanceEfectivo?.multiempresa ?? false;
  const eligeEmpresa = empresasAlcance.length > 1;

  // Empresa activa: una sola → esa; varias → la guardada si sigue en el
  // alcance; si no, "todas" para quien ve todas y la primera para el resto.
  const empresaActiva = useMemo<string | null>(() => {
    if (!perfil) return null;
    if (empresasAlcance.length === 1) return empresasAlcance[0];
    const guardada = empresaActivaGuardada ?? null;
    if (guardada && empresasAlcance.includes(guardada)) return guardada;
    if (veTodasLasEmpresas) return null;
    return empresasAlcance[0] ?? perfil.empresa_id ?? null;
  }, [perfil, empresasAlcance, empresaActivaGuardada, veTodasLasEmpresas]);
  function setEmpresaActiva(empresaId: string | null) {
    if (!perfilReal) return;
    if (empresaId === null && !veTodasLasEmpresas) return;
    if (empresaId !== null && !empresasAlcance.includes(empresaId)) return;
    setEmpresaActivaGuardada(empresaId);
    guardarJson(`empresa-activa-${perfilReal.id}`, empresaId, localStorage);
  }

  const esAdminGlobal = perfil?.rol === "admin" && grupo?.es_maestro === true;
  // Lo que la organización tiene abierto. El menú lo usa para no ofrecerle a
  // un cliente módulos que no contrató (la base ya los rechaza; esto es para
  // que no vea puertas que no abren).
  const alcanceOrganizacion = grupo ? { esMaestra: grupo.es_maestro === true, modulos } : null;
  const logoUrl = urlPublicaDelLogo(grupo?.logo_path);

  // El nombre de la organización manda en el título y en el manifiesto: es lo
  // que queda debajo del icono cuando el cliente instala la aplicación en su
  // teléfono. También se recuerda su código, para que la próxima pantalla de
  // acceso en este dispositivo ya salga con su marca y no con la de otro.
  useEffect(() => {
    if (!grupo) return;
    aplicarMarca(grupo.marca_comercial ?? grupo.nombre, logoUrl);
    recordarOrganizacion(grupo.codigo);
  }, [grupo, logoUrl]);

  // El admin de la organización maestra ve todos los módulos: es quien los
  // abre y quien da soporte (mismo criterio que auth_modulo_habilitado() en la
  // base). Mientras la organización no haya cargado -- sin señal, o un usuario
  // al que todavía no se le asigna -- no se esconde nada: esto es comodidad de
  // interfaz, y quien manda es RLS.
  function tieneModulo(clave: ModuloClave): boolean {
    if (esAdminGlobal || !grupo) return true;
    return modulos.includes(clave);
  }

  // La suscripción vencida no quita permisos de rol: quita la escritura. Es un
  // espejo de lo que ya impone RLS (suscripcion_permite_escribir) -- aquí sirve
  // para no ofrecer botones que la base va a rechazar. Sin organización
  // cargada se deja pasar, por lo mismo de arriba.
  //
  // Solo consulta (29-sep-2026, espejo de auth_solo_consulta): el perfil
  // espectador, y una organización cliente ya cargada que no tiene
  // suscripción (no contratada = no escribe, igual que en la base).
  const soloConsulta = !esAdminGlobal && (!!perfilReal?.espectador || (!!grupo && !grupo.es_maestro && !suscripcion));
  const suscripcionPermiteEscribir = esAdminGlobal || (!soloConsulta && (!suscripcion || suscripcion.puede_escribir));

  function puedeEscribirEnEmpresa(empresaId: string): boolean {
    if (!suscripcionPermiteEscribir) return false;
    if (!perfil || perfil.rol === "pendiente" || perfil.rol === "direccion") return false;
    if (perfil.rol === "admin") return true;
    if (veTodasLasEmpresas) return true;
    return perfil.empresa_id === empresaId || empresasAlcance.includes(empresaId);
  }

  async function cerrarSesion() {
    await supabase.auth.signOut();
  }

  function terminarRecuperacion() {
    setRecuperandoContrasena(false);
  }

  function cambiarContrasena() {
    setRecuperandoContrasena(true);
  }

  return (
    <AuthContext.Provider
      value={{
        cargando,
        session,
        perfil,
        puedeEscribirEnEmpresa,
        veTodasLasEmpresas,
        empresasAlcance,
        rolMultiempresa,
        empresaActiva,
        setEmpresaActiva,
        eligeEmpresa,
        perfilReal,
        vistaComo,
        setVistaComo,
        grupo,
        alcanceOrganizacion,
        modulos,
        tieneModulo,
        esAdminGlobal,
        suscripcion,
        suscripcionPermiteEscribir,
        soloConsulta,
        logoUrl,
        recargarOrganizacion,
        cerrarSesion,
        recuperandoContrasena,
        terminarRecuperacion,
        cambiarContrasena,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}

/** Filtro de empresa de una pantalla = la empresa activa del encabezado.
 * "" significa todas (solo para quien ve todas). */
export function useEmpresaFiltro(): [string, (empresaId: string) => void] {
  const { empresaActiva, setEmpresaActiva } = useAuth();
  return [empresaActiva ?? "", (v) => setEmpresaActiva(v || null)];
}
