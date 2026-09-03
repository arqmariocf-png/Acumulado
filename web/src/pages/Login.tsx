import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

export function Login() {
  const { session } = useAuth();
  const [modo, setModo] = useState<"entrar" | "crear" | "recuperar">("entrar");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (session) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    setEnviando(true);

    if (modo === "entrar") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else if (modo === "recuperar") {
      // Self-service, complementario al link que un admin puede generar a
      // mano desde Admin -> Usuarios (ver generar-link-acceso/index.ts) para
      // cuando el correo de recuperación no llega. redirectTo explícito para
      // no depender de que el Site URL del proyecto esté bien configurado --
      // vuelve al mismo origen desde el que se pidió. Al abrir el link,
      // supabase-js dispara PASSWORD_RECOVERY (ver lib/auth.tsx) y
      // NuevaContrasena.tsx se encarga del resto.
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      if (error) {
        setError(error.message);
      } else {
        // Supabase no distingue "correo no existe" de "sí existe" en la
        // respuesta (mismo motivo que el caso de signUp más abajo) -- el
        // mensaje es genérico a propósito.
        setMensaje("Si el correo tiene una cuenta, te llegó un link para definir una contraseña nueva.");
      }
    } else {
      const { error, data } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
      } else if (data.user && data.user.identities?.length === 0) {
        // Caso real (Andrea, 31-ago-2026): ya tenía cuenta confirmada (de una
        // invitación) e intentó "Crear cuenta" de nuevo con ese correo.
        // Supabase, a propósito, NO manda error aquí (así nadie puede probar
        // qué correos ya están registrados) -- responde 200 sin sesión,
        // exactamente igual que una cuenta nueva real, pero sin mandar
        // ningún correo porque no hay nada que confirmar. El mensaje
        // genérico de abajo ("revisa tu correo") sería falso en este caso
        // -- se detecta por identities vacío, la señal que sí distingue
        // ambos casos del lado del cliente.
        setError('Ya existe una cuenta con este correo. Usa "Entrar" con tu contraseña.');
      } else if (data.session) {
        // Confirmación de correo desactivada en el proyecto: ya queda con sesión.
        // El trigger handle_new_user ya le creó un profile en rol 'pendiente' —
        // sin acceso a nada hasta que un admin le asigne rol y empresa.
      } else {
        setMensaje("Cuenta creada. Revisa tu correo para confirmar antes de entrar.");
      }
    }

    setEnviando(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-lg font-semibold text-slate-900">Grupo Loma</h1>
        <p className="mb-6 text-sm text-slate-500">Sistema integral</p>

        {modo !== "recuperar" && (
          <div className="mb-4 flex gap-2 text-sm">
            <button
              type="button"
              onClick={() => setModo("entrar")}
              className={`rounded px-2 py-1 ${modo === "entrar" ? "bg-slate-900 text-white" : "text-slate-500"}`}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => setModo("crear")}
              className={`rounded px-2 py-1 ${modo === "crear" ? "bg-slate-900 text-white" : "text-slate-500"}`}
            >
              Crear cuenta
            </button>
          </div>
        )}

        {modo === "recuperar" && <p className="mb-4 text-sm text-slate-600">Escribe tu correo y te mandamos un link para definir una contraseña nueva.</p>}

        <label className="mb-1 block text-sm font-medium text-slate-700">Correo</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
        />

        {modo !== "recuperar" && (
          <>
            <label className="mb-1 block text-sm font-medium text-slate-700">Contraseña</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </>
        )}

        {modo === "entrar" && (
          <button
            type="button"
            onClick={() => {
              setModo("recuperar");
              setError(null);
              setMensaje(null);
            }}
            className="mb-4 block text-xs text-slate-500 underline hover:text-slate-700"
          >
            ¿Olvidaste tu contraseña?
          </button>
        )}

        {modo === "crear" && (
          <p className="mb-4 text-xs text-slate-500">
            Tu cuenta queda sin acceso a datos hasta que un administrador te asigne un rol y una empresa.
          </p>
        )}

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        {mensaje && <p className="mb-4 text-sm text-emerald-600">{mensaje}</p>}

        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded bg-slate-900 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {enviando ? "Enviando…" : modo === "entrar" ? "Entrar" : modo === "crear" ? "Crear cuenta" : "Mandar link"}
        </button>

        {modo === "recuperar" && (
          <button
            type="button"
            onClick={() => {
              setModo("entrar");
              setError(null);
              setMensaje(null);
            }}
            className="mt-3 block w-full text-center text-xs text-slate-500 underline hover:text-slate-700"
          >
            Volver a entrar
          </button>
        )}
      </form>
    </div>
  );
}
