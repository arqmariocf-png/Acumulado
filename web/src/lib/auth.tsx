import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Grupo, ModuloClave, Profile } from "../types/database";

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
        setCargando(false);
        return;
      }

      const [{ data: grupoData }, { data: modulosData }] = await Promise.all([
        supabase.from("grupos").select("*").eq("id", perfilCargado.grupo_id).single(),
        supabase
          .from("grupo_modulos")
          .select("modulo_clave, habilitado")
          .eq("grupo_id", perfilCargado.grupo_id)
          .eq("habilitado", true),
      ]);
      if (!activo) return;

      setGrupo((grupoData as Grupo | null) ?? null);
      setModulos(((modulosData ?? []) as { modulo_clave: ModuloClave }[]).map((m) => m.modulo_clave));
      setCargando(false);
    })();

    return () => {
      activo = false;
    };
  }, [session]);

  const veTodasLasEmpresas = perfil ? (perfil.rol === "corporativo" || perfil.rol === "admin" || perfil.empresa_id === null) && perfil.rol !== "pendiente" : false;
  const esAdminGlobal = perfil?.rol === "admin" && grupo?.es_maestro === true;

  // El admin de la organización maestra ve todos los módulos: es quien los
  // abre y quien da soporte (mismo criterio que auth_modulo_habilitado() en
  // la base — ver 20260923090001_grupos_modulos.sql).
  function tieneModulo(clave: ModuloClave): boolean {
    return esAdminGlobal || modulos.includes(clave);
  }

  function puedeEscribirEnEmpresa(empresaId: string): boolean {
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
