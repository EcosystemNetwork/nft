"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useProject } from "@/components/project-context";
import { api, Button, Card, CardHeader, Field, Input, PageHeader, Select, Textarea, toast } from "@/components/ui";
import type { MetadataTemplate } from "@/lib/engine/types";
import type { Project } from "@/lib/store";

export default function Settings() {
  const { project, save, base } = useProject();
  const router = useRouter();
  const [p, setP] = useState({ name: project.name, concept: project.concept, style: project.style, chain: project.chain, mode: project.mode });
  const [canvas, setCanvas] = useState(project.canvas);
  const [meta, setMeta] = useState<MetadataTemplate>(project.metadata);
  const [tiers, setTiers] = useState(project.config.tiers);
  const m = (k: keyof MetadataTemplate) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setMeta({ ...meta, [k]: ["sellerFeeBasisPoints", "startTokenId"].includes(k) ? Number(e.target.value) : e.target.value });

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Project" />
          <div className="space-y-4 px-5 pb-5">
            <Field label="Name"><Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
            <Field label="Concept"><Textarea rows={3} value={p.concept} onChange={(e) => setP({ ...p, concept: e.target.value })} /></Field>
            <Field label="Visual style"><Input value={p.style} onChange={(e) => setP({ ...p, style: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Blockchain">
                <Select value={p.chain} onChange={(e) => setP({ ...p, chain: e.target.value as Project["chain"] })}>
                  <option value="robinhood">Robinhood Chain</option><option value="solana">Solana</option><option value="ethereum">Ethereum</option><option value="base">Base</option><option value="sui">Sui</option>
                </Select>
              </Field>
              <Field label="Production">
                <Select value={p.mode} onChange={(e) => setP({ ...p, mode: e.target.value as Project["mode"] })}>
                  <option value="2d">2D</option><option value="hybrid">Hybrid</option><option value="3d">3D</option>
                </Select>
              </Field>
            </div>
            <Button variant="primary" onClick={() => save(p, "Project saved")}>Save project</Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Canvas & output" sub="Changing the canvas invalidates existing renders (they're re-rendered on demand)." />
          <div className="space-y-4 px-5 pb-5">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Width"><Input type="number" value={canvas.width} onChange={(e) => setCanvas({ ...canvas, width: Number(e.target.value) })} /></Field>
              <Field label="Height"><Input type="number" value={canvas.height} onChange={(e) => setCanvas({ ...canvas, height: Number(e.target.value) })} /></Field>
              <Field label="Format">
                <Select value={canvas.format} onChange={(e) => setCanvas({ ...canvas, format: e.target.value as "png" | "jpeg" })}>
                  <option value="png">PNG</option><option value="jpeg">JPEG</option>
                </Select>
              </Field>
            </div>
            <Button variant="primary" onClick={() => save({ canvas }, "Canvas saved")}>Save canvas</Button>
          </div>
          <CardHeader title="Rarity tiers" sub="Upper rank percentile per tier (e.g. 0.01 = top 1%)." />
          <div className="grid grid-cols-3 gap-3 px-5 pb-5">
            {tiers.map((t, i) => (
              <Field key={i} label={t.name}>
                <Input type="number" step="0.01" min={0} max={1} value={t.maxPercentile} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, maxPercentile: Number(e.target.value) } : x)))} />
              </Field>
            ))}
            <Button className="col-span-3" onClick={() => save({ config: { tiers } }, "Tiers saved")}>Save tiers</Button>
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Metadata template" sub="Different chains and marketplaces use different standards; this controls every exported JSON." />
          <div className="grid gap-4 px-5 pb-5 md:grid-cols-3">
            <Field label="Standard">
              <Select value={meta.standard} onChange={m("standard")}>
                <option value="metaplex">Metaplex (Solana)</option>
                <option value="erc721">ERC-721 / OpenSea</option>
              </Select>
            </Field>
            <Field label="Collection name"><Input value={meta.collectionName} onChange={m("collectionName")} /></Field>
            <Field label="Symbol" hint="Metaplex: max 10 characters"><Input value={meta.symbol} onChange={m("symbol")} /></Field>
            <Field label="Token name pattern" hint="{collection} and {id} are replaced"><Input value={meta.namePattern} onChange={m("namePattern")} /></Field>
            <Field label="First token ID">
              <Select value={meta.startTokenId} onChange={m("startTokenId")}>
                <option value={0}>0</option><option value={1}>1</option>
              </Select>
            </Field>
            <Field label="Royalty (basis points)" hint="500 = 5%"><Input type="number" min={0} max={10000} value={meta.sellerFeeBasisPoints} onChange={m("sellerFeeBasisPoints")} /></Field>
            <Field label="Image base URI" hint="e.g. ipfs://<CID>/ or https://arweave.net/<id>/" className="md:col-span-2"><Input value={meta.imageBaseUri} onChange={m("imageBaseUri")} placeholder="ipfs://…" /></Field>
            <Field label="External URL"><Input value={meta.externalUrl} onChange={m("externalUrl")} placeholder="https://…" /></Field>
            <Field label="Description" className="md:col-span-3"><Textarea rows={2} value={meta.description} onChange={m("description")} /></Field>
            <div className="md:col-span-3">
              <Button variant="primary" onClick={() => save({ metadata: meta }, "Metadata template saved")}>Save metadata template</Button>
              {meta.startTokenId !== project.metadata.startTokenId && <span className="ml-3 text-[12px] text-amber-300">Changing the first token ID requires regenerating the collection.</span>}
            </div>
          </div>
        </Card>

        <Card className="border-bad/30 xl:col-span-2">
          <CardHeader title="Danger zone" />
          <div className="px-5 pb-5">
            <Button
              variant="danger"
              onClick={async () => {
                if (prompt(`Type "${project.name}" to permanently delete this project, its assets, renders and exports.`) !== project.name) return;
                try {
                  await api(base, { method: "DELETE" });
                  router.push("/");
                } catch (e) {
                  toast.err((e as Error).message);
                }
              }}
            >
              Delete project
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
