import { z } from "zod";

const slug = z
  .string()
  .trim()
  .regex(/^[a-z0-9_-]{2,40}$/);

const etapa = z.object({
  name: z.string().trim().min(1).max(80),
  slug,
  position: z.number().finite().optional(),
  is_won: z.boolean().optional(),
  is_lost: z.boolean().optional(),
});

export const snapshotSchema = z
  .object({
    pipeline: z.object({
      name: z.string().trim().min(2).max(120),
      slug,
      stages: z.array(etapa).min(1).max(20),
    }),
    agent: z.object({
      name: z.string().trim().min(2).max(80),
      system_prompt: z.string().min(1).max(20000),
    }),
    event_type: z.object({
      name: z.string().trim().min(2).max(120),
      slug,
      duration_minutes: z.number().int().min(5).max(1440),
      category: z
        .enum([
          "consulta",
          "procedimento",
          "retorno",
          "visita",
          "vistoria",
          "reuniao",
          "call",
          "orcamento",
          "demonstracao",
          "outro",
        ])
        .optional(),
    }),
  })
  .superRefine((valor, ctx) => {
    const ganhos = valor.pipeline.stages.filter((s) => s.is_won).length;
    const perdidos = valor.pipeline.stages.filter((s) => s.is_lost).length;
    if (ganhos > 1 || perdidos > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["pipeline", "stages"],
        message: "No máximo uma etapa ganha e uma etapa perdida.",
      });
    }
    for (const [i, etapaItem] of valor.pipeline.stages.entries()) {
      if (etapaItem.is_won && etapaItem.is_lost) {
        ctx.addIssue({
          code: "custom",
          path: ["pipeline", "stages", i],
          message: "Uma etapa não pode ser ganha e perdida ao mesmo tempo.",
        });
      }
    }
  });

export type SnapshotPreset = z.infer<typeof snapshotSchema>;

export const createChildSchema = z.object({
  display_name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,40}$/),
});

/**
 * Modelo v0 de atendimento. Funil, rascunho de agente e um tipo de compromisso.
 * Não traz sessão de canal nem cobrança.
 */
export const PRESET_ATENDIMENTO_V0: SnapshotPreset = {
  pipeline: {
    name: "Atendimento",
    slug: "atendimento",
    stages: [
      { name: "Novo", slug: "novo", position: 1000, is_won: false, is_lost: false },
      { name: "Qualificado", slug: "qualificado", position: 2000, is_won: false, is_lost: false },
      { name: "Agendado", slug: "agendado", position: 3000, is_won: false, is_lost: false },
      { name: "Ganho", slug: "ganho", position: 4000, is_won: true, is_lost: false },
      { name: "Perdido", slug: "perdido", position: 5000, is_won: false, is_lost: true },
    ],
  },
  agent: {
    name: "Atendimento",
    system_prompt:
      "Você atende a pessoa no WhatsApp, qualifica o interesse e oferece horários da agenda. Não invente preço. Quando a pessoa quiser marcar, use a agenda.",
  },
  event_type: {
    name: "Encontro",
    slug: "encontro",
    duration_minutes: 30,
    category: "reuniao",
  },
};
