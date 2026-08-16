// Cabeceras CORS compartidas por todos los edge functions. El frontend corre
// en un origen distinto (Vercel) al de las funciones (Supabase), así que
// toda función debe responder a preflight OPTIONS con esto.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function respuestaCors(): Response {
  return new Response("ok", { headers: corsHeaders });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
