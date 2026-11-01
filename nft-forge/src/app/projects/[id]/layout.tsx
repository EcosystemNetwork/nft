"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ProjectProvider, useProject } from "@/components/project-context";
import { AppFrame, Icon, MobileNav, Sidebar, type NavItem } from "@/components/shell";
import { Badge, Card, fmt, Spinner } from "@/components/ui";

function nav(id: string): NavItem[] {
  const b = `/projects/${id}`;
  return [
    { href: b, label: "Overview", icon: "dashboard" },
    { href: `${b}/architect`, label: "AI Architect", icon: "architect" },
    { href: `${b}/assets`, label: "Asset Studio", icon: "assets" },
    { href: `${b}/traits`, label: "Trait Engine", icon: "traits" },
    { href: `${b}/generate`, label: "Generator", icon: "generate" },
    { href: `${b}/gallery`, label: "Gallery & Review", icon: "gallery" },
    { href: `${b}/rarity`, label: "Rarity Analytics", icon: "rarity" },
    { href: `${b}/qa`, label: "Quality Assurance", icon: "qa" },
    { href: `${b}/export`, label: "Export", icon: "export" },
    { href: `${b}/publish`, label: "IPFS Publishing", icon: "cloud" },
    { href: `${b}/deploy`, label: "Deployment", icon: "deploy" },
    { href: `${b}/settings`, label: "Settings", icon: "settings" },
  ];
}

function ProjectCard() {
  const { project, validation } = useProject();
  return (
    <Card glow className="p-4">
      <Link href="/" className="mb-3 flex items-center gap-1 text-[12px] text-muted hover:text-ink">
        <Icon name="back" className="h-3.5 w-3.5" /> All projects
      </Link>
      <div className="truncate font-semibold">{project.name}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge tone="cyan">{project.chain.toUpperCase()}</Badge>
        <Badge tone="violet">{fmt.n(project.config.supply)}</Badge>
        <Badge>{project.mode.toUpperCase()}</Badge>
      </div>
      <div className="mt-3 text-[12px]">
        {validation.errors.length ? (
          <span className="text-rose-300">● {validation.errors.length} config issue(s)</span>
        ) : (
          <span className="text-green-300">● Configuration valid</span>
        )}
      </div>
    </Card>
  );
}

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const items = nav(id);
  return (
    <ProjectProvider
      id={id}
      fallback={
        <div className="grid min-h-screen place-items-center text-muted">
          <Spinner className="h-6 w-6" />
        </div>
      }
    >
      <AppFrame sidebar={<Sidebar items={items} top={<ProjectCard />} />} mobile={<MobileNav items={items} />}>
        {children}
      </AppFrame>
    </ProjectProvider>
  );
}
