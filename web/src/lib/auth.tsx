import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Grupo, ModuloClave, Profile, Suscripcion } from "../types/database";

interface AuthState {
  cargando: boolean;
  session: Session | null;
  perfil: Profile | null;
  /** Organización (tenant) del usuario. null mientras su rol es 'pendiente'. */
  grupo: Grupo | null;
  /** Módulos abiertos para la organización del usuario. */
  modulos: ModuloClave[];
  tieneModulo: (clave: ModuloClave) => boolean;
  /** Admin de la organización maestra: opera la plataforma, cruza organizaciones. */
  esAdminGlobal: boolean;
  /** Suscripción de la organización. null mientras no hay organización. */
  suscripcion: Suscripcion | null;
  /** false cuando la suscripción venció: se consulta y exporta, pero no se captura. */
  suscripcionPermiteEscribir: boolean;
  /** URL pública del logotipo de la organización, si subió uno. */
  logoUrl: string | null;
  recargarOrganizacion: () => Promise<void>;
  puedeEscribirEnEmpresa: (empresaId: string) => boolean;
  veTodasLasEmpresas: boolean;
  cerrarSesion: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Profile | null>(null);
  const [grupo, setGrupo] = useState<Grupo | null>(null);
  const [modulos, setModulos] = useState<ModuloClave[]>([]);
  const [suscripcion, setSuscripcion] = useState<Suscripcion | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let activo = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!activo) return;
      setSession(data.session);
    });

    const { data: suscripcion } = supabase.auth.onAuthStateChange((_evento, nuevaSession) => {
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

    // El perfil trae la organización; con ella se resuelven la marca que se
    // muestra en la interfaz y los módulos abiertos, que son los que deciden
    // qué rutas y qué menú existen para este usuario. RLS ya acota ambas
    // consultas a su propia organización.
    (async () => {
      const { data: perfilData } = await supabase
        .from("profiles")
        .select("id, nombre, rol, grupo_id, empresa_id, activo")
        .eq("id", session.user.id)
        .single();
      if (!activo) return;

      const perfilCargado = (perfilData as Profile | null) ?? null;
      setPerfil(perfilCargado);

      if (!perfilCargado?.grupo_id) {
        setGrupo(null);
        setModulos([]);
        setSuscripcion(null);
        setCargando(false);
        return;
      }

      await cargarOrganizacion(perfilCargado.grupo_id);
      if (activo) setCargando(false);
    })();

    return () => {
      activo = false;
    };
  }, [session]);

  // La organización se recarga aparte del perfil: al volver de la pasarela de
  // pago hay que refrescar la suscripción sin obligar a cerrar sesión.
  async function cargarOrganizacion(grupoId: string) {
    const [{ data: grupoData }, { data: modulosData }, { data: suscripcionData }] = await Promise.all([
      supabase.from("grupos").select("*").eq("id", grupoId).single(),
      supabase.from("grupo_modulos").select("modulo_clave, habilitado").eq("grupo_id", grupoId).eq("habilitado", true),
      supabase.from("v_suscripcion").select("*").eq("grupo_id", grupoId).maybeSingle(),
    ]);

    setGrupo((grupoData as Grupo | null) ?? null);
    setModulos(((modulosData ?? []) as { modulo_clave: ModuloClave }[]).map((m) => m.modulo_clave));
    setSuscripcion((suscripcionData as Suscripcion | null) ?? null);
  }

  async function recargarOrganizacion() {
    if (perfil?.grupo_id) await cargarOrganizacion(perfil.grupo_id);
  }

  const veTodasLasEmpresas = perfil ? (perfil.rol === "corporativo" || perfil.rol === "admin" || perfil.empresa_id === null) && perfil.rol !== "pendiente" : false;
  const esAdminGlobal = perfil?.rol === "admin" && grupo?.es_maestro === true;

  // El admin de la organización maestra ve todos los módulos: es quien los
  // abre y quien da soporte (mismo criterio que auth_modulo_habilitado() en
  // la base — ver 20260923090001_grupos_modulos.sql).
  function tieneModulo(clave: ModuloClave): boolean {
    return esAdminGlobal || modulos.includes(clave);
  }

  // La suscripción vencida no quita permisos de rol: quita la escritura. Un
  // corporativo sigue siendo corporativo, pero en solo lectura. Esto es un
  // espejo de lo que ya impone RLS (suscripcion_permite_escribir) -- aquí
  // sirve para no ofrecer botones que la base va a rechazar.
  const suscripcionPermiteEscribir = esAdminGlobal || (suscripcion?.puede_escribir ?? false);
  const logoUrl = grupo?.logo_path
    ? supabase.storage.from("branding").getPublicUrl(grupo.logo_path).data.publicUrl
    : null;

  function puedeEscribirEnEmpresa(empresaId: string): boolean {
    if (!suscripcionPermiteEscribir) return false;
    if (!perfil || perfil.rol === "pendiente" || perfil.rol === "direccion") return false;
    if (perfil.rol === "corporativo" || perfil.rol === "admin") return true;
    return perfil.empresa_id === empresaId;
  }

  async function cerrarSesion() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider
      value={{
        cargando,
        session,
        perfil,
        grupo,
        modulos,
        tieneModulo,
        esAdminGlobal,
        suscripcion,
        suscripcionPermiteEscribir,
        logoUrl,
        recargarOrganizacion,
        puedeEscribirEnEmpresa,
        veTodasLasEmpresas,
        cerrarSesion,
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
