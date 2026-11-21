/**
 * Lee del token de acceso el participante que ha iniciado sesión (claim `pid` que emite el backend).
 * Es solo para personalizar la interfaz: no autoriza nada. La autorización la hace siempre el backend,
 * que valida la firma del token en cada petición.
 */
export function memberIdFromToken<T extends string>(token: string, allowed: readonly T[]): T | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const json = new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
    const claims: unknown = JSON.parse(json);
    const pid = typeof claims === "object" && claims !== null ? (claims as Record<string, unknown>).pid : undefined;
    return allowed.find((id) => id === pid) ?? null;
  } catch {
    return null;
  }
}
