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
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Profile | null>(null);
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

  return (
    <AuthContext.Provider value={{ cargando, session, perfil, puedeEscribirEnEmpresa, veTodasLasEmpresas, cerrarSesion }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
