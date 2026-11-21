import { describe, expect, it } from "vitest";
import { memberIdFromToken } from "../../src/lib/session";

function token(payload: unknown): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.firma`;
}

const members = ["adela", "martin"] as const;

describe("memberIdFromToken", () => {
  it("lee el participante del token", () => {
    expect(memberIdFromToken(token({ pid: "martin", hid: "x" }), members)).toBe("martin");
    expect(memberIdFromToken(token({ pid: "adela" }), members)).toBe("adela");
  });

  it("ignora identidades desconocidas, tokens rotos y valores no textuales", () => {
    expect(memberIdFromToken(token({ pid: "otra" }), members)).toBeNull();
    expect(memberIdFromToken(token({ pid: 7 }), members)).toBeNull();
    expect(memberIdFromToken(token({}), members)).toBeNull();
    expect(memberIdFromToken("token-de-prueba", members)).toBeNull();
    expect(memberIdFromToken("a.%%%.c", members)).toBeNull();
    expect(memberIdFromToken("", members)).toBeNull();
  });

  it("acepta caracteres no ASCII en otros claims", () => {
    expect(memberIdFromToken(token({ pid: "adela", name: "Martín ñ" }), members)).toBe("adela");
  });
});
