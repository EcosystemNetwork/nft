"use client";

import { useEffect, useMemo, useState } from "react";
import { useProject } from "@/components/project-context";
import { api, Badge, Button, Card, cx, Empty, Field, Input, Modal, PageHeader, Select, Spinner, Toggle, toast, useApi } from "@/components/ui";
import { NONE, type TraitCategory, type TraitRule } from "@/lib/engine/types";
import type { Asset } from "@/lib/store";

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

export default function TraitEngine() {
  const { project, base, save, validation } = useProject();
  const { data: assets } = useApi<Asset[]>(`${base}/assets`);
  const [cats, setCats] = useState<TraitCategory[]>(project.config.categories);
  const [rules, setRules] = useState<TraitRule[]>(project.config.rules);
  const [selId, setSelId] = useState<string | null>(project.config.categories[0]?.id ?? null);
  const [tab, setTab] = useState<"traits" | "rules">("traits");
  const [picker, setPicker] = useState<{ catId: string; traitId: string } | null>(null);
  const [newCat, setNewCat] = useState("");
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(cats) !== JSON.stringify(project.config.categories) || JSON.stringify(rules) !== JSON.stringify(project.config.rules);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const sel = cats.find((c) => c.id === selId) ?? null;
  const assetById = useMemo(() => new Map((assets ?? []).map((a) => [a.id, a])), [assets]);
  const allTraits = useMemo(() => cats.flatMap((c) => c.traits.map((t) => ({ ...t, cat: c }))), [cats]);
  const traitName = (id: string) => (id === NONE ? "None" : (allTraits.find((t) => t.id === id)?.name ?? id));

  const updateCat = (id: string, fn: (c: TraitCategory) => TraitCategory) => setCats((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
  const move = (i: number, d: -1 | 1) =>
    setCats((cs) => {
      const n = [...cs];
      const j = i + d;
      if (j < 0 || j >= n.length) return cs;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  async function persist() {
    setSaving(true);
    await save({ config: { categories: cats, rules } }, "Trait configuration saved");
    setSaving(false);
  }

  function autoFill(cat: TraitCategory) {
    const used = new Set(cats.flatMap((c) => c.traits.map((t) => t.assetId)));
    const match = (assets ?? []).filter((a) => (a.categoryHint ?? "").toLowerCase() === cat.name.toLowerCase() && !used.has(a.id));
    if (!match.length) return toast.err(`No unassigned assets tagged "${cat.name}". Import a folder named "${cat.name}".`);
    // First fill existing traits without art whose names match; then create new traits.
    const remaining = [...match];
    const traits = cat.traits.map((t) => {
      if (t.assetId) return t;
      const i = remaining.findIndex((a) => a.name.toLowerCase() === t.name.toLowerCase());
      return i >= 0 ? { ...t, assetId: remaining.splice(i, 1)[0].id } : t;
    });
    for (const a of remaining) traits.push({ id: uid("t"), name: a.name, weight: 10, assetId: a.id });
    updateCat(cat.id, (c) => ({ ...c, traits }));
    toast.ok(`Linked ${match.length} asset(s) to ${cat.name}`);
  }

  return (
    <>
      <PageHeader
        title="Trait Engine"
        sub="Categories are selected top-to-bottom (so rules can depend on earlier picks) and drawn by layer order."
        right={
          <>
            {dirty && <Badge tone="amber">Unsaved changes</Badge>}
            <Button disabled={!dirty} onClick={() => { setCats(project.config.categories); setRules(project.config.rules); }}>
              Discard
            </Button>
            <Button variant="primary" disabled={!dirty} busy={saving} onClick={persist}>
              Save configuration
            </Button>
          </>
        }
      />
      {validation.errors.length > 0 && !dirty && (
        <div className="mb-4 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-[13px] text-rose-200">
          {validation.errors.slice(0, 4).map((e) => <div key={e}>✕ {e}</div>)}
        </div>
      )}

      <div className="mb-4 flex gap-1">
        {(["traits", "rules"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx("rounded-lg px-4 py-2 text-sm", tab === t ? "bg-violet/20 text-ink ring-1 ring-violet/40" : "text-muted hover:bg-panel-2")}>
            {t === "traits" ? "Layers & traits" : `Compatibility rules (${rules.length})`}
          </button>
        ))}
      </div>

      {tab === "traits" ? (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <div className="space-y-2">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newCat.trim()) return;
                const c: TraitCategory = { id: uid("cat"), name: newCat.trim(), required: true, noneWeight: 0, layer: (Math.max(-10, ...cats.map((x) => x.layer)) + 10), traits: [] };
                setCats([...cats, c]);
                setSelId(c.id);
                setNewCat("");
              }}
            >
              <Input placeholder="New layer name" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
              <Button type="submit">+ Add</Button>
            </form>
            {cats.map((c, i) => {
              const missing = c.traits.filter((t) => !t.assetId).length;
              return (
                <div
                  key={c.id}
                  onClick={() => setSelId(c.id)}
                  className={cx(
                    "group flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 transition",
                    selId === c.id ? "border-violet/50 bg-violet/10" : "border-line bg-panel hover:border-line-2",
                  )}
                >
                  <div className="flex flex-col text-[10px] text-dim opacity-0 group-hover:opacity-100">
                    <button onClick={(e) => { e.stopPropagation(); move(i, -1); }} aria-label="Move up">▲</button>
                    <button onClick={(e) => { e.stopPropagation(); move(i, 1); }} aria-label="Move down">▼</button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={cx("truncate font-medium", selId === c.id && "text-violet-2")}>{c.name}</div>
                    <div className="text-[12px] text-muted">
                      {c.traits.length} traits · {c.required ? "required" : "optional"} · z{c.layer}
                    </div>
                  </div>
                  {missing > 0 && <Badge tone="amber">{missing} no art</Badge>}
                </div>
              );
            })}
          </div>

          {!sel ? (
            <Empty title="No layer selected">Add a layer on the left, or apply the AI blueprint.</Empty>
          ) : (
            <CategoryEditor
              cat={sel}
              assetById={assetById}
              base={base}
              onChange={(fn) => updateCat(sel.id, fn)}
              onDelete={() => {
                if (!confirm(`Delete layer "${sel.name}" and its ${sel.traits.length} traits?`)) return;
                const ids = new Set(sel.traits.map((t) => t.id));
                setRules(rules.filter((r) => !ids.has(r.traitId) && !(r.type !== "require" && ids.has(r.targetTraitId)) && !(r.type === "require" && r.targetCategoryId === sel.id)));
                setCats(cats.filter((c) => c.id !== sel.id));
                setSelId(cats.find((c) => c.id !== sel.id)?.id ?? null);
              }}
              onPick={(traitId) => setPicker({ catId: sel.id, traitId })}
              onAutoFill={() => autoFill(sel)}
            />
          )}
        </div>
      ) : (
        <RulesEditor cats={cats} rules={rules} setRules={setRules} traitName={traitName} />
      )}

      <PreviewStrip base={base} cats={cats} rules={rules} />

      <AssetPicker
        open={!!picker}
        assets={assets ?? []}
        base={base}
        hint={cats.find((c) => c.id === picker?.catId)?.name}
        onClose={() => setPicker(null)}
        onPick={(assetId) => {
          if (!picker) return;
          updateCat(picker.catId, (c) => ({ ...c, traits: c.traits.map((t) => (t.id === picker.traitId ? { ...t, assetId } : t)) }));
          setPicker(null);
        }}
      />
    </>
  );
}

function CategoryEditor({
  cat,
  assetById,
  base,
  onChange,
  onDelete,
  onPick,
  onAutoFill,
}: {
  cat: TraitCategory;
  assetById: Map<string, Asset>;
  base: string;
  onChange: (fn: (c: TraitCategory) => TraitCategory) => void;
  onDelete: () => void;
  onPick: (traitId: string) => void;
  onAutoFill: () => void;
}) {
  const total = cat.traits.reduce((s, t) => s + Math.max(0, t.weight), 0) + (cat.required ? 0 : Math.max(0, cat.noneWeight));
  const pct = (w: number) => (total ? `${((Math.max(0, w) / total) * 100).toFixed(1)}%` : "—");
  const setTrait = (id: string, patch: Partial<TraitCategory["traits"][number]>) =>
    onChange((c) => ({ ...c, traits: c.traits.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  return (
    <div>
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Layer name" className="min-w-48 flex-1">
            <Input value={cat.name} onChange={(e) => onChange((c) => ({ ...c, name: e.target.value }))} />
          </Field>
          <Field label="Draw order (z)" className="w-32">
            <Input type="number" value={cat.layer} onChange={(e) => onChange((c) => ({ ...c, layer: Number(e.target.value) }))} />
          </Field>
          <div className="pb-2">
            <Toggle checked={cat.required} onChange={(v) => onChange((c) => ({ ...c, required: v, noneWeight: v ? 0 : c.noneWeight || 20 }))} label="Required" />
          </div>
          {!cat.required && (
            <Field label={`"None" weight · ${pct(cat.noneWeight)}`} className="w-40">
              <Input type="number" min={0} value={cat.noneWeight} onChange={(e) => onChange((c) => ({ ...c, noneWeight: Number(e.target.value) }))} />
            </Field>
          )}
          <div className="flex gap-2 pb-0.5">
            <Button size="sm" onClick={onAutoFill}>Link assets</Button>
            <Button size="sm" variant="danger" onClick={onDelete}>Delete layer</Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {cat.traits.map((t) => {
          const a = t.assetId ? assetById.get(t.assetId) : undefined;
          return (
            <Card key={t.id} className={cx("overflow-hidden", !a && "border-amber/30")}>
              <button onClick={() => onPick(t.id)} className="checker group relative block aspect-square w-full">
                {a ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`${base}/assets/${a.id}?size=300&v=${a.version}`} alt="" className="h-full w-full object-contain" />
                ) : (
                  <span className="absolute inset-0 grid place-items-center text-[13px] text-amber-300">+ Assign artwork</span>
                )}
                <span className="absolute inset-0 grid place-items-center bg-black/50 text-[13px] opacity-0 transition group-hover:opacity-100">Change artwork</span>
                <span className="absolute top-2 right-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[12px] font-semibold tabular-nums">{pct(t.weight)}</span>
              </button>
              <div className="space-y-2 p-3">
                <input
                  value={t.name}
                  onChange={(e) => setTrait(t.id, { name: e.target.value })}
                  className="w-full bg-transparent text-[13px] font-semibold outline-none focus:text-violet-2"
                />
                <div className="flex items-center gap-2">
                  <input type="range" min={0} max={100} step={0.5} value={Math.min(100, t.weight)} onChange={(e) => setTrait(t.id, { weight: Number(e.target.value) })} className="flex-1" />
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={t.weight}
                    onChange={(e) => setTrait(t.id, { weight: Number(e.target.value) })}
                    className="w-14 rounded-md border border-line-2 bg-panel-2 px-1.5 py-0.5 text-right text-[12px] tabular-nums outline-none"
                  />
                </div>
                <div className="flex justify-between text-[11px] text-dim">
                  <span className="truncate font-mono" title={t.id}>{t.id}</span>
                  <button
                    className="text-rose-300/70 hover:text-rose-300"
                    onClick={() => onChange((c) => ({ ...c, traits: c.traits.filter((x) => x.id !== t.id) }))}
                  >
                    remove
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
        <button
          onClick={() => onChange((c) => ({ ...c, traits: [...c.traits, { id: uid("t"), name: `New ${c.name}`, weight: 10 }] }))}
          className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-line-2 text-sm text-muted hover:border-violet/50 hover:text-ink"
        >
          + Add trait
        </button>
      </div>
      <p className="mt-3 text-[12px] text-dim">
        Percentages are base probabilities from weights. Rules and uniqueness shift the final distribution; see Rarity Analytics for expected vs actual.
      </p>
    </div>
  );
}

const RULE_LABEL: Record<TraitRule["type"], string> = {
  exclude: "can never appear with",
  require: "requires",
  weight: "multiplies the weight of",
};

function RulesEditor({
  cats,
  rules,
  setRules,
  traitName,
}: {
  cats: TraitCategory[];
  rules: TraitRule[];
  setRules: (r: TraitRule[]) => void;
  traitName: (id: string) => string;
}) {
  const [type, setType] = useState<TraitRule["type"]>("exclude");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [catId, setCatId] = useState("");
  const [allowed, setAllowed] = useState<string[]>([]);
  const [mult, setMult] = useState(2);
  const opts = cats.flatMap((c) => c.traits.map((t) => ({ id: t.id, label: `${c.name} / ${t.name}` })));
  const target = cats.find((c) => c.id === catId);

  function add() {
    if (!a) return toast.err("Pick the trait the rule applies to.");
    const id = uid("r");
    if (type === "require") {
      if (!catId || !allowed.length) return toast.err("Pick a category and at least one allowed trait.");
      setRules([...rules, { id, type, traitId: a, targetCategoryId: catId, allowedTraitIds: allowed }]);
    } else {
      if (!b || a === b) return toast.err("Pick a different target trait.");
      setRules([...rules, type === "weight" ? { id, type, traitId: a, targetTraitId: b, multiplier: mult } : { id, type, traitId: a, targetTraitId: b }]);
    }
    setAllowed([]);
  }

  const TraitSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select trait…</option>
      {cats.map((c) => (
        <optgroup key={c.id} label={c.name}>
          {c.traits.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
      <Card className="p-2">
        {!rules.length ? (
          <div className="p-8 text-center text-sm text-muted">No rules. Every combination is allowed.</div>
        ) : (
          <ul className="divide-y divide-line">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-3 text-[13px]">
                <Badge tone={r.type === "exclude" ? "bad" : r.type === "require" ? "cyan" : "amber"}>{r.type.toUpperCase()}</Badge>
                <span className="flex-1">
                  <b>{traitName(r.traitId)}</b> <span className="text-muted">{RULE_LABEL[r.type]}</span>{" "}
                  {r.type === "require" ? (
                    <>
                      <b>{cats.find((c) => c.id === r.targetCategoryId)?.name}</b> <span className="text-muted">∈</span> {r.allowedTraitIds.map(traitName).join(", ")}
                    </>
                  ) : (
                    <b>{traitName(r.targetTraitId)}</b>
                  )}
                  {r.type === "weight" && <span className="text-amber-300"> ×{r.multiplier}</span>}
                  {r.note && <span className="block text-[12px] text-dim">{r.note}</span>}
                </span>
                <button className="text-dim hover:text-rose-300" onClick={() => setRules(rules.filter((x) => x.id !== r.id))} aria-label="Delete rule">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="h-fit space-y-4 p-5">
        <h3 className="font-semibold">Add rule</h3>
        <Field label="Rule type">
          <Select value={type} onChange={(e) => setType(e.target.value as TraitRule["type"])}>
            <option value="exclude">Exclude — never together</option>
            <option value="require">Require — restrict another category</option>
            <option value="weight">Weight — conditional probability</option>
          </Select>
        </Field>
        <Field label="When this trait is selected">
          <TraitSelect value={a} onChange={setA} />
        </Field>
        {type === "require" ? (
          <>
            <Field label="Category">
              <Select value={catId} onChange={(e) => { setCatId(e.target.value); setAllowed([]); }}>
                <option value="">Select category…</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            {target && (
              <Field label="Must be one of">
                <div className="flex max-h-48 flex-wrap gap-1.5 overflow-auto">
                  {[...target.traits.map((t) => ({ id: t.id, name: t.name })), ...(target.required ? [] : [{ id: NONE, name: "None" }])].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setAllowed(allowed.includes(t.id) ? allowed.filter((x) => x !== t.id) : [...allowed, t.id])}
                      className={cx("rounded-md px-2 py-1 text-[12px]", allowed.includes(t.id) ? "bg-cyan/20 text-cyan ring-1 ring-cyan/40" : "bg-panel-3 text-muted")}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </Field>
            )}
          </>
        ) : (
          <Field label={type === "exclude" ? "Never combine with" : "Change the weight of"}>
            <TraitSelect value={b} onChange={setB} />
          </Field>
        )}
        {type === "weight" && (
          <Field label="Multiplier" hint="2 = twice as likely, 0.5 = half, 0 = never.">
            <Input type="number" min={0} step="any" value={mult} onChange={(e) => setMult(Number(e.target.value))} />
          </Field>
        )}
        <Button variant="primary" className="w-full" onClick={add} disabled={!opts.length}>
          Add rule
        </Button>
        <p className="text-[12px] text-dim">Rules are enforced during selection, so invalid combinations are never generated. Remember to save.</p>
      </Card>
    </div>
  );
}

function PreviewStrip({ base, cats, rules }: { base: string; cats: TraitCategory[]; rules: TraitRule[] }) {
  const [items, setItems] = useState<{ image?: string; error?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const r = await api<{ previews: { image?: string; error?: string }[] }>(`${base}/preview`, { method: "POST", json: { count: 12, categories: cats, rules } });
      setItems(r.previews);
    } catch (e) {
      toast.err((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="mt-8 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Quick preview</div>
          <div className="text-[12px] text-muted">12 random samples from the current (unsaved) configuration.</div>
        </div>
        <Button size="sm" variant="primary" onClick={run} busy={busy}>
          ↻ Shuffle preview
        </Button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {busy && !items.length && <Spinner />}
        {items.map((p, i) =>
          p.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={p.image} alt="" className="h-32 w-32 shrink-0 rounded-xl object-cover ring-1 ring-line" />
          ) : (
            <div key={i} className="grid h-32 w-32 shrink-0 place-items-center rounded-xl bg-panel-2 p-2 text-center text-[11px] text-amber-300 ring-1 ring-amber/30" title={p.error}>
              {p.error?.slice(0, 80)}
            </div>
          ),
        )}
        {!items.length && !busy && <div className="py-6 text-[13px] text-dim">Click shuffle to preview combinations.</div>}
      </div>
    </Card>
  );
}

function AssetPicker({
  open,
  assets,
  base,
  hint,
  onClose,
  onPick,
}: {
  open: boolean;
  assets: Asset[];
  base: string;
  hint?: string;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState(true);
  const list = assets.filter(
    (a) => (!only || !hint || (a.categoryHint ?? "").toLowerCase() === hint.toLowerCase()) && (!q || a.name.toLowerCase().includes(q.toLowerCase())),
  );
  return (
    <Modal open={open} onClose={onClose} title="Choose artwork" wide>
      <div className="mb-4 flex items-center gap-3">
        <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        {hint && <Toggle checked={only} onChange={setOnly} label={`Only "${hint}" assets`} />}
      </div>
      {!list.length ? (
        <p className="py-10 text-center text-sm text-muted">No matching assets. Upload some in Asset Studio.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {list.map((a) => (
            <button key={a.id} onClick={() => onPick(a.id)} className="group text-left">
              <div className="checker aspect-square overflow-hidden rounded-xl ring-1 ring-line group-hover:ring-violet">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${base}/assets/${a.id}?size=200&v=${a.version}`} alt="" className="h-full w-full object-contain" loading="lazy" />
              </div>
              <div className="mt-1 truncate text-[12px] text-muted">{a.name}</div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
