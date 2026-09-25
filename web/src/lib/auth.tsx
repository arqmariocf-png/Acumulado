import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Grupo, ModuloClave, Profile, Suscripcion } from "../types/database";
import { urlPublicaDelLogo } from "./marca";

interface AuthState {
  cargando: boolean;
  session: Session | null;
  perfil: Profile | null;
  puedeEscribirEnEmpresa: (empresaId: string) => boolean;
  veTodasLasEmpresas: boolean;
  /** Organización (tenant) del usuario. null mientras no tenga una asignada. */
  grupo: Grupo | null;
  modulos: ModuloClave[];
  tieneModulo: (clave: ModuloClave) => boolean;
  /** Admin de la organización maestra: opera la plataforma, cruza organizaciones. */
  esAdminGlobal: boolean;
  suscripcion: Suscripcion | null;
  /** false cuando la suscripción venció: se consulta y exporta, pero no se captura. */
  suscripcionPermiteEscribir: boolean;
  logoUrl: string | null;
  recargarOrganizacion: () => Promise<void>;
  cerrarSesion: () => Promise<void>;
  recuperandoContrasena: boolean;
  terminarRecuperacion: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Profile | null>(null);
  const [cargando, setCargando] = useState(true);
  const [grupo, setGrupo] = useState<Grupo | null>(null);
  const [modulos, setModulos] = useState<ModuloClave[]>([]);
  const [suscripcion, setSuscripcion] = useState<Suscripcion | null>(null);
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
        .select("id, nombre, rol, grupo_id, empresa_id, activo, bbva_mantenimiento")
        .eq("id", session.user.id)
        .single(),
      supabase.from("permisos_modulo").select("modulo").eq("profile_id", session.user.id),
    ])
      .then(([{ data: fila, error }, { data: permisos }]) => {
        if (!activo) return;
        const data = fila ? { ...(fila as Omit<Profile, "modulos">), modulos: (permisos ?? []).map((m) => String(m.modulo)) } : null;
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
            cacheado = crudo ? ({ ...(JSON.parse(crudo) as Partial<Profile>), modulos: (JSON.parse(crudo) as Partial<Profile>).modulos ?? [] } as Profile) : null;
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

  const veTodasLasEmpresas = perfil ? (perfil.rol === "corporativo" || perfil.rol === "admin" || perfil.empresa_id === null) && perfil.rol !== "pendiente" : false;

  const esAdminGlobal = perfil?.rol === "admin" && grupo?.es_maestro === true;
  const logoUrl = urlPublicaDelLogo(grupo?.logo_path);

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
  const suscripcionPermiteEscribir = esAdminGlobal || !suscripcion || suscripcion.puede_escribir;

  function puedeEscribirEnEmpresa(empresaId: string): boolean {
    if (!suscripcionPermiteEscribir) return false;
    if (!perfil || perfil.rol === "pendiente" || perfil.rol === "direccion") return false;
    if (perfil.rol === "corporativo" || perfil.rol === "admin") return true;
    return perfil.empresa_id === empresaId;
  }

  async function cerrarSesion() {
    await supabase.auth.signOut();
  }

  function terminarRecuperacion() {
    setRecuperandoContrasena(false);
  }

  return (
    <AuthContext.Provider
      value={{
        cargando,
        session,
        perfil,
        puedeEscribirEnEmpresa,
        veTodasLasEmpresas,
        grupo,
        modulos,
        tieneModulo,
        esAdminGlobal,
        suscripcion,
        suscripcionPermiteEscribir,
        logoUrl,
        recargarOrganizacion,
        cerrarSesion,
        recuperandoContrasena,
        terminarRecuperacion,
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
