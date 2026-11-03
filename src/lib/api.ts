import { z } from "zod";
import { expenseInputSchema, expenseListSchema, expenseSchema, loginSchema, receiptSchema, validateImage, type Expense, type ExpenseInput } from "./domain";

export class ApiError extends Error {
  constructor(message: string, public readonly status = 0) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!configured) throw new ApiError("Configura NEXT_PUBLIC_API_URL con la dirección de tu backend Spring Boot y vuelve a compilar el frontend.");
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new ApiError("NEXT_PUBLIC_API_URL debe ser una URL completa de tu backend.");
  }
  if (url.username || url.password || url.search || url.hash || !["https:", "http:"].includes(url.protocol)) {
    throw new ApiError("La URL del backend no puede contener credenciales, parámetros ni fragmentos.");
  }
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new ApiError("Usa HTTPS para conectar con el backend fuera de localhost.");
  }
  return configured.replace(/\/+$/, "");
}

async function request<T>(path: string, options: RequestInit, schema?: z.ZodType<T>, timeoutMs = 120_000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${apiBaseUrl()}${path}`, {
      ...options,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) {
      const messages: Record<number, string> = {
        400: "El servidor no pudo validar los datos. Revisa el ticket.",
        401: "La sesión no es válida o ha caducado. Vuelve a iniciar sesión.",
        403: "No tienes acceso a esta operación.",
        409: "El servidor detectó un conflicto. Actualiza el historial antes de volver a guardar.",
        413: "El servidor rechazó la imagen por su tamaño.",
        415: "El servidor no admite este formato de imagen.",
        422: "La IA no pudo leer este ticket. Prueba una foto más nítida o introduce los productos manualmente.",
        429: "Se ha alcanzado el límite de peticiones o la cuota de IA. Espera o introduce los productos manualmente.",
        502: "El servicio de lectura no está disponible. Puedes introducir los productos manualmente.",
        503: "El backend o la IA no están disponibles. Inténtalo más tarde."
      };
      throw new ApiError(messages[response.status] ?? `El servidor devolvió un error (${response.status}).`, response.status);
    }
    if (!schema) return undefined as T;
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiError("El servidor no devolvió JSON válido. Revisa el contrato de API.", response.status);
    }
    const result = schema.safeParse(body);
    if (!result.success) throw new ApiError("La respuesta del backend no cumple el contrato de datos esperado. No se han aceptado datos incompletos.", response.status);
    return result.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) throw new ApiError("El servidor ha tardado demasiado. Si estabas guardando, comprueba el historial antes de repetir: el gasto podría haberse guardado.");
    throw new ApiError("No se pudo conectar. Comprueba la conexión, la URL del backend y CORS. Si estabas guardando, consulta el historial antes de repetir.");
  } finally {
    clearTimeout(timeout);
  }
}

function authorized(token: string): HeadersInit {
  if (!token.trim()) throw new ApiError("Inicia sesión antes de continuar.", 401);
  return { Authorization: `Bearer ${token}` };
}

export function login(email: string, password: string) {
  return request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  }, loginSchema);
}

export function listExpenses(token: string) {
  return request("/api/expenses", { method: "GET", headers: authorized(token) }, expenseListSchema);
}

export function analyzeReceipt(file: File, token: string) {
  validateImage(file);
  const form = new FormData();
  form.append("image", file);
  return request("/api/receipts/analyze", { method: "POST", headers: authorized(token), body: form }, receiptSchema, 150_000);
}

export function saveExpense(input: ExpenseInput, token: string, idempotencyKey: string) {
  const validated = expenseInputSchema.parse(input);
  return request("/api/expenses", {
    method: "POST",
    headers: { ...authorized(token), "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(validated)
  }, expenseSchema).then((expense) => {
    if ((validated.registeredById && expense.registeredById !== validated.registeredById) || (validated.paidById && expense.paidById !== validated.paidById) || expense.settledAt) {
      throw new ApiError("El backend no ha conservado quién registra y quién paga, o ha liquidado un ticket nuevo. Adapta Spring Boot y comprueba el historial antes de repetir.");
    }
    const requestedOwners = new Map(validated.items.map((item) => [item.id, item.ownerId ?? null]));
    if (expense.items.length !== validated.items.length || expense.items.some((item) => !requestedOwners.has(item.id) || requestedOwners.get(item.id) !== (item.ownerId ?? null))) {
      throw new ApiError("El backend no ha conservado los propietarios de los productos. Adapta el campo ownerId en Spring Boot y comprueba el historial antes de repetir: el gasto podría haberse guardado.");
    }
    return expense;
  });
}

export function deleteExpense(id: string, token: string) {
  return request<void>(`/api/expenses/${encodeURIComponent(id)}`, { method: "DELETE", headers: authorized(token) });
}

export async function setExpenseSettlement(expense: Expense, settled: boolean, token: string): Promise<Expense> {
  if (!expense.paidById) throw new ApiError("No se puede liquidar un ticket sin pagador conocido.");
  const updated = await request(`/api/expenses/${encodeURIComponent(expense.id)}/settlement`, {
    method: "PATCH",
    headers: { ...authorized(token), "Content-Type": "application/json" },
    body: JSON.stringify({ settled })
  }, expenseSchema);
  if (Boolean(updated.settledAt) !== settled || JSON.stringify({ ...updated, settledAt: null }) !== JSON.stringify({ ...expense, settledAt: null })) {
    throw new ApiError("El backend no confirmó la liquidación o cambió datos del ticket. Actualiza el historial antes de repetir.");
  }
  return updated;
}
