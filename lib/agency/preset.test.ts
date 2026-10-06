import { describe, expect, it } from "vitest";

import { erroDaAgencia } from "./erros";
import { PRESET_ATENDIMENTO_V0, snapshotSchema } from "./preset";

describe("modelo de atendimento v0", () => {
  it("o preset cabe no schema", () => {
    expect(snapshotSchema.safeParse(PRESET_ATENDIMENTO_V0).success).toBe(true);
  });

  it("recusa duas etapas ganhas", () => {
    const quebrado = structuredClone(PRESET_ATENDIMENTO_V0);
    quebrado.pipeline.stages[0]!.is_won = true;
    expect(snapshotSchema.safeParse(quebrado).success).toBe(false);
  });
});

describe("erro da função da agência", () => {
  it("42501 vira 403 sem dizer qual organização existe", () => {
    const erro = erroDaAgencia({ code: "42501", message: "agency_forbidden" });
    expect(erro.status).toBe(403);
    expect(erro.message).not.toMatch(/[0-9a-f]{8}-/);
  });

  it("slug repetido vira 409", () => {
    expect(erroDaAgencia({ code: "23505" }).code).toBe("tenant_already_exists");
  });
});
