import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

export function Login() {
  const { session } = useAuth();
  const [modo, setModo] = useState<"entrar" | "crear">("entrar");
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
        <h1 className="mb-1 text-lg font-semibold text-slate-900">Acumulado · Grupo Loma</h1>
        <p className="mb-6 text-sm text-slate-500">Conciliación bancaria</p>

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

        <label className="mb-1 block text-sm font-medium text-slate-700">Correo</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
        />

        <label className="mb-1 block text-sm font-medium text-slate-700">Contraseña</label>
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
        />

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
          {enviando ? "Enviando…" : modo === "entrar" ? "Entrar" : "Crear cuenta"}
        </button>
      </form>
    </div>
  );
}
