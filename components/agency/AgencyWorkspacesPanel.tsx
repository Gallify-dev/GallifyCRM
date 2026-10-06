"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { PRESET_ATENDIMENTO_V0 } from "@/lib/agency/preset";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";

export interface WorkspaceCliente {
  id: string;
  slug: string;
  display_name: string;
}

export function AgencyWorkspacesPanel({ workspaces }: { workspaces: WorkspaceCliente[] }) {
  const t = useT();
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  async function criar(event: FormEvent) {
    event.preventDefault();
    setPending("criar");
    try {
      const res = await fetch("/api/v1/agency/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display_name: nome, slug }),
      });
      const body = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message);
      setNome("");
      setSlug("");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message ? err.message : t("Não foi possível criar o cliente."),
      );
    } finally {
      setPending(null);
    }
  }

  async function entrar(id: string) {
    setPending(id);
    try {
      const res = await fetch(`/api/v1/agency/workspaces/${id}/enter`, { method: "POST" });
      if (!res.ok) throw new Error();
      window.location.assign("/app/inbox");
    } catch {
      toast.error(t("Não foi possível entrar neste cliente."));
      setPending(null);
    }
  }

  async function aplicar(id: string) {
    setPending(`modelo:${id}`);
    try {
      const res = await fetch(`/api/v1/agency/workspaces/${id}/snapshot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(PRESET_ATENDIMENTO_V0),
      });
      const body = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message);
      toast.success(t("Modelo aplicado."));
    } catch (err) {
      toast.error(
        err instanceof Error && err.message ? err.message : t("Não foi possível aplicar o modelo."),
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <section
      className="flex flex-col gap-4 rounded-md border border-border p-4"
      data-testid="agency-workspaces"
    >
      <header>
        <h2 className="text-lg font-semibold">{t("Clientes")}</h2>
        <p className="text-sm text-muted-foreground">
          {t(
            "Cada cliente fica numa organização separada. O que um cliente grava não aparece no outro.",
          )}
        </p>
      </header>

      {workspaces.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("Ainda não há clientes.")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {workspaces.map((workspace) => (
            <li key={workspace.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm">
                {workspace.display_name}
                <span className="ml-2 text-muted-foreground">{workspace.slug}</span>
              </span>
              <span className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending !== null}
                  onClick={() => {
                    void aplicar(workspace.id);
                  }}
                >
                  {t("Aplicar modelo")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={pending !== null}
                  onClick={() => {
                    void entrar(workspace.id);
                  }}
                >
                  {t("Entrar")}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          void criar(event);
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          {t("Nome de exibição")}
          <Input
            value={nome}
            onChange={(event) => setNome(event.target.value)}
            required
            minLength={2}
            maxLength={120}
            name="display_name"
          />
        </label>
        <label className="flex w-full flex-col gap-1 text-sm sm:w-48">
          {t("Identificador")}
          <Input
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            required
            minLength={2}
            maxLength={40}
            pattern="[a-z0-9-]{2,40}"
            name="slug"
          />
        </label>
        <Button type="submit" disabled={pending !== null}>
          {t("Criar cliente")}
        </Button>
      </form>
    </section>
  );
}
