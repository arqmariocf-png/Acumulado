import { useEffect, useState } from "react";
import { aplicarMarca, marcaPublica, organizacionDeEntrada, urlPublicaDelLogo } from "./marca";

export interface MarcaDeEntrada {
  nombre: string;
  logoUrl: string | null;
}

/** La marca que se muestra ANTES de entrar. La organización se sabe por el
 * `?org=` del link con el que el cliente recibió su aplicación, o por la
 * última sesión en este dispositivo. Si no se sabe de quién es -- alguien que
 * entra por primera vez a la URL pelona -- no se inventa: se queda el nombre
 * neutro de la plataforma, que es preferible a enseñarle la marca de otro. */
export function useMarcaDeEntrada(): MarcaDeEntrada | null {
  const [marca, setMarca] = useState<MarcaDeEntrada | null>(null);

  useEffect(() => {
    const codigo = organizacionDeEntrada();
    if (!codigo) return;
    let vigente = true;
    marcaPublica(codigo)
      .then((m) => {
        if (!vigente || !m) return;
        const encontrada = { nombre: m.nombre, logoUrl: urlPublicaDelLogo(m.logo_path) };
        setMarca(encontrada);
        aplicarMarca(encontrada.nombre, encontrada.logoUrl);
      })
      .catch(() => {
        // Sin señal o sin permiso: se queda el nombre neutro.
      });
    return () => {
      vigente = false;
    };
  }, []);

  return marca;
}
