import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

/** Pantalla que reemplaza toda la app mientras `recuperandoContrasena` está
 * activo (ver lib/auth.tsx) -- llega aquí quien abrió un link generado con
 * tipo "recovery" desde Admin -> Usuarios, sin depender de que le llegue el
 * correo de recuperación normal. supabase.auth.updateUser ya opera con la
 * sesión temporal que trae el link, no hace falta contraseña anterior. */
export function NuevaContrasena() {
  const { terminarRecuperacion } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [lista, setLista] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmar) {
      setError("Las dos contraseñas no coinciden.");
      return;
    }

    setGuardando(true);
    const { error } = await supabase.auth.updateUser({ password });
    setGuardando(false);

    if (error) {
      setError(error.message);
      return;
    }
    setLista(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-lg font-semibold text-slate-900">Grupo Loma</h1>
        <p className="mb-6 text-sm text-slate-500">Definir contraseña</p>

        {lista ? (
          <>
            <p className="mb-4 text-sm text-emerald-600">
              ✔ Contraseña actualizada. Ya puedes entrar con ella la próxima vez (o seguir usando magic link, lo que prefieras).
            </p>
            <button
              type="button"
              onClick={terminarRecuperacion}
              className="w-full rounded bg-slate-900 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Continuar
            </button>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <label className="mb-1 block text-sm font-medium text-slate-700">Contraseña nueva</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />

            <label className="mb-1 block text-sm font-medium text-slate-700">Confirmar contraseña</label>
            <input
              type="password"
              required
              minLength={6}
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />

            {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={guardando}
              className="w-full rounded bg-slate-900 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Guardar contraseña"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
