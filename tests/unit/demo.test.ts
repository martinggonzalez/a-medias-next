import { describe, expect, it, vi } from "vitest";
import { createDemoExpense, DEMO_STORAGE_KEY, loadDemoExpenses, persistDemoExpenses } from "../../src/lib/demo";
import type { ExpenseInput } from "../../src/lib/domain";

const input: ExpenseInput = { merchant: "Mercado", date: "2026-10-19", currency: "EUR", items: [{ id: "a", name: "Pan", amountCents: 101, selected: true }], participants: [{ id: "p1", name: "Ana", weight: 1 }, { id: "p2", name: "Alex", weight: 1 }], splitMode: "equal" };

describe("historial de demostración", () => {
  it("empieza vacío, sin datos falsos ocultos", () => {
    expect(loadDemoExpenses({ getItem: () => null })).toEqual([]);
  });
  it("guarda y restaura sin fotos ni credenciales", () => {
    let raw = "";
    const expense = createDemoExpense(input);
    persistDemoExpenses([expense], { setItem: (key, value) => { expect(key).toBe(DEMO_STORAGE_KEY); raw = value; } });
    expect(loadDemoExpenses({ getItem: () => raw })).toEqual([expense]);
    expect(raw).not.toMatch(/password|accessToken|image|base64/);
  });
  it("no sobrescribe un historial dañado ni oculta fallos de almacenamiento", () => {
    expect(() => loadDemoExpenses({ getItem: () => "{" })).toThrow();
    expect(() => loadDemoExpenses({ getItem: () => '{"items":[{}]}' })).toThrow();
    expect(() => persistDemoExpenses([], { setItem: () => { throw new Error("QuotaExceededError"); } })).toThrow();
  });
  it("limita el historial a 500 gastos", () => {
    const storage = { setItem: vi.fn() };
    expect(() => persistDemoExpenses(Array.from({ length: 501 }, () => createDemoExpense(input)), storage)).toThrow(/500/);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
