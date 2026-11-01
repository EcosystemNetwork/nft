"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Project } from "@/lib/store";
import { api, toast } from "./ui";

export interface Validation {
  errors: string[];
  warnings: string[];
}

interface Ctx {
  project: Project;
  validation: Validation;
  reload: () => Promise<void>;
  /** PATCH the project; returns the saved project or null on error (toast shown). */
  save: (patch: Record<string, unknown>, okMsg?: string) => Promise<Project | null>;
  base: string;
}

const ProjectCtx = createContext<Ctx | null>(null);

export function useProject() {
  const c = useContext(ProjectCtx);
  if (!c) throw new Error("useProject outside provider");
  return c;
}

export function ProjectProvider({ id, children, fallback }: { id: string; children: React.ReactNode; fallback: React.ReactNode }) {
  const [state, setState] = useState<{ project: Project; validation: Validation } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setState(await api(`/api/projects/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const save = useCallback(
    async (patch: Record<string, unknown>, okMsg?: string) => {
      try {
        const r = await api<{ project: Project; validation: Validation }>(`/api/projects/${id}`, { method: "PATCH", json: patch });
        setState(r);
        if (okMsg) toast.ok(okMsg);
        return r.project;
      } catch (e) {
        toast.err((e as Error).message);
        return null;
      }
    },
    [id],
  );
  if (error) return <div className="p-10 text-rose-300">{error}</div>;
  if (!state) return <>{fallback}</>;
  return (
    <ProjectCtx.Provider value={{ ...state, reload, save, base: `/api/projects/${id}` }}>{children}</ProjectCtx.Provider>
  );
}
