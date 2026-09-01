import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Profile } from "../types/database";

interface AuthState {
  cargando: boolean;
  session: Session | null;
  perfil: Profile | null;
  puedeEscribirEnEmpresa: (empresaId: string) => boolean;
  veTodasLasEmpresas: boolean;
  cerrarSesion: () => Promise<void>;
  recuperandoContrasena: boolean;
  terminarRecuperacion: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Profile | null>(null);
  const [cargando, setCargando] = useState(true);
  // Se activa cuando el link viene de generar-link-acceso con tipo
  // "recovery" (ver Usuarios.tsx / NuevaContrasena.tsx): supabase-js detecta
  // el token en el hash de la URL al cargar, sin importar en qué ruta cayó,
  // y dispara este evento en vez de un login normal.
  const [recuperandoContrasena, setRecuperandoContrasena] = useState(false);

  useEffect(() => {
    let activo = true;

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
      setCargando(false);
      return;
    }
    setCargando(true);
    supabase
      .from("profiles")
      .select("id, nombre, rol, empresa_id, activo")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => {
        if (!activo) return;
        setPerfil(data as Profile | null);
        setCargando(false);
      });
    return () => {
      activo = false;
    };
  }, [session]);

  const veTodasLasEmpresas = perfil ? (perfil.rol === "corporativo" || perfil.rol === "admin" || perfil.empresa_id === null) && perfil.rol !== "pendiente" : false;

  function puedeEscribirEnEmpresa(empresaId: string): boolean {
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
