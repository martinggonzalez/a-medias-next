import type { CoupleMemberId } from "./domain";

/**
 * Imagen de cada persona (carpeta public/avatars). Para usar una foto, copia un archivo cuadrado
 * (por ejemplo 128×128) y cambia aquí la ruta, p. ej. "/avatars/adela.jpg".
 */
export const memberAvatars: Record<CoupleMemberId, string> = {
  adela: "/avatars/Adela.png",
  martin: "/avatars/Martin.png"
};
