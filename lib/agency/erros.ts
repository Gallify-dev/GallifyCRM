import type { ApiErrorCode } from "@/lib/api/errors";

interface RpcError {
  code?: string;
  message?: string;
}

/**
 * Traduz o errcode que as funções da agência levantam para a resposta HTTP.
 * 42501 não diz qual organização existe.
 */
export function erroDaAgencia(error: RpcError): {
  code: ApiErrorCode;
  status: number;
  message: string;
} {
  if (error.code === "42501") {
    return { code: "forbidden", status: 403, message: "Você não administra esta agência." };
  }
  if (error.code === "23505") {
    return {
      code: "tenant_already_exists",
      status: 409,
      message: "Este identificador já está em uso.",
    };
  }
  if (error.code === "23514" || error.code === "22023") {
    return {
      code: "validation_failed",
      status: 400,
      message: "Não foi possível aplicar esta operação na organização.",
    };
  }
  return { code: "internal_error", status: 500, message: "Não foi possível concluir a operação." };
}
