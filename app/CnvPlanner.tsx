"use client";

import {
  AlertTriangle,
  Beaker,
  CheckCircle2,
  Clipboard,
  Download,
  FileSpreadsheet,
  FlaskConical,
  Info,
  Layers3,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  buildReactionSets,
  formatWellId,
  getPlateDimensions,
  planCnvLayout,
  refreshPlan,
  rowLabel,
  sampleTypeLabel,
  validatePlan,
  type AssayMode,
  type LayoutPreset,
  type LoadingPattern,
  type PlanInput,
  type PlanResult,
  type PlateType,
  type ReferenceAssay,
  type SampleInput,
  type SampleType,
  type TargetAssay,
} from "@/lib/cnvPlanner";
import {
  calculateReactionRequirements,
  DEFAULT_REACTION_SYSTEM,
  validateReactionSystem,
  type ReactionSystem,
} from "@/lib/reactionCalculator";
import {
  exportAllPlates,
  exportOnePlate,
  instrumentTsv,
} from "@/lib/exportWorkbook";

const STORAGE_KEY = "taqman-cnv-plate-planner:v1";

interface StoredState {
  version: 1;
  plateType: PlateType;
  assayMode: AssayMode;
  samples: SampleInput[];
  targets: TargetAssay[];
  reference: ReferenceAssay;
  replicates: number;
  layoutPreset: LayoutPreset;
  loadingPattern: LoadingPattern;
  reactionSystem: ReactionSystem;
  plan: PlanResult | null;
  savedAt: string;
}

const SAMPLE_TYPES: SampleType[] = [
  "unknown",
  "calibrator",
  "ntc",
  "qc-0",
  "qc-1",
  "qc-2",
];

const DEFAULT_SAMPLES: SampleInput[] = [
  { id: "sample-unknown-1", name: "Unknown_001", type: "unknown" },
  { id: "sample-calibrator", name: "Calibrator_2copy", type: "calibrator" },
  { id: "sample-ntc", name: "NTC", type: "ntc" },
];

const DEFAULT_TARGETS: TargetAssay[] = [
  {
    id: "target-gstm1",
    name: "GSTM1",
    assayId: "Ho_33001161_cn",
    reporter: "FAM",
    volumeUl: 0.5,
  },
  {
    id: "target-gstt1",
    name: "GSTT1",
    assayId: "Ho_33001153_cn",
    reporter: "CY5",
    volumeUl: 0.5,
  },
];

const DEFAULT_REFERENCE: ReferenceAssay = {
  name: "RNase P",
  assayId: "Ho_00021109_cn",
  reporter: "VIC",
  volumeUl: 0.5,
};

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseNames(value: string) {
  return value
    .split(/\r?\n|\t/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sampleTone(type: SampleType | "") {
  if (type === "ntc") return "ntc";
  if (type === "calibrator") return "calibrator";
  if (type.startsWith("qc-")) return "qc";
  return "unknown";
}

function copyText(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
  return Promise.resolve();
}

export function CnvPlanner() {
  const [plateType, setPlateType] = useState<PlateType>(96);
  const [assayMode, setAssayMode] = useState<AssayMode>("multiplex");
  const [samples, setSamples] = useState<SampleInput[]>(clone(DEFAULT_SAMPLES));
  const [targets, setTargets] = useState<TargetAssay[]>(clone(DEFAULT_TARGETS));
  const [reference, setReference] = useState<ReferenceAssay>(clone(DEFAULT_REFERENCE));
  const [replicates, setReplicates] = useState(4);
  const [layoutPreset, setLayoutPreset] = useState<LayoutPreset>("sample-major");
  const [loadingPattern, setLoadingPattern] = useState<LoadingPattern>("sequential");
  const [reactionSystem, setReactionSystem] = useState<ReactionSystem>(DEFAULT_REACTION_SYSTEM);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [activePlate, setActivePlate] = useState(0);
  const [bulkText, setBulkText] = useState("");
  const [selectedWell, setSelectedWell] = useState<string | null>(null);
  const [editorSampleId, setEditorSampleId] = useState("");
  const [editorReactionSetId, setEditorReactionSetId] = useState("");
  const [editorReplicate, setEditorReplicate] = useState(1);
  const [toast, setToast] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  const bulkNames = useMemo(() => parseNames(bulkText), [bulkText]);
  const reactionSets = useMemo(
    () => buildReactionSets({ assayMode, targets, reference }),
    [assayMode, targets, reference],
  );
  const issues = useMemo(() => (plan ? validatePlan(plan) : []), [plan]);
  const reactionErrors = useMemo(
    () => (plan ? validateReactionSystem(plan, reactionSystem) : []),
    [plan, reactionSystem],
  );
  const requirements = useMemo(
    () => (plan ? calculateReactionRequirements(plan, reactionSystem) : null),
    [plan, reactionSystem],
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as StoredState;
      if (stored.version !== 1) return;
      setPlateType(stored.plateType);
      setAssayMode(stored.assayMode);
      setSamples(stored.samples);
      setTargets(stored.targets);
      setReference(stored.reference);
      setReplicates(stored.replicates);
      setLayoutPreset(stored.layoutPreset);
      setLoadingPattern(stored.loadingPattern);
      setReactionSystem(stored.reactionSystem);
      setPlan(stored.plan);
      setSavedAt(stored.savedAt);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (plateType === 96 && loadingPattern === "interleaved-8-channel") {
      setLoadingPattern("sequential");
    }
  }, [plateType, loadingPattern]);

  function markDirty() {
    setIsDirty(true);
  }

  function updateSample(index: number, patch: Partial<SampleInput>) {
    setSamples((current) => current.map((sample, sampleIndex) => sampleIndex === index ? { ...sample, ...patch } : sample));
    markDirty();
  }

  function updateTarget(index: number, patch: Partial<TargetAssay>) {
    setTargets((current) => current.map((target, targetIndex) => targetIndex === index ? { ...target, ...patch } : target));
    markDirty();
  }

  function importSamples() {
    const existing = new Set(samples.map((sample) => sample.name.trim().toLocaleLowerCase()));
    const additions = bulkNames
      .filter((name) => !existing.has(name.toLocaleLowerCase()))
      .map((name) => ({ id: uid("sample"), name, type: "unknown" as const }));
    setSamples((current) => [...current, ...additions]);
    setBulkText("");
    markDirty();
    setToast(`已导入 ${additions.length} 个样本名称。`);
  }

  function generatePlan() {
    try {
      const input: PlanInput = {
        plateType,
        assayMode,
        samples: samples.map((sample) => ({ ...sample, name: sample.name.trim() })),
        targets: targets.map((target) => ({ ...target, name: target.name.trim() })),
        reference: { ...reference, name: reference.name.trim() },
        replicates,
        layoutPreset,
        loadingPattern,
      };
      const nextPlan = planCnvLayout(input);
      setPlan(nextPlan);
      setActivePlate(0);
      setSelectedWell(null);
      setIsDirty(true);
      setToast(`已生成 ${nextPlan.plates.length} 块板，共 ${nextPlan.occupiedWells} 个反应孔。`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "排板失败，请检查输入。 / Planning failed.");
    }
  }

  function saveState() {
    const stored: StoredState = {
      version: 1,
      plateType,
      assayMode,
      samples,
      targets,
      reference,
      replicates,
      layoutPreset,
      loadingPattern,
      reactionSystem,
      plan,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    setSavedAt(stored.savedAt);
    setIsDirty(false);
    setToast("已保存到本浏览器。 / Saved in this browser.");
  }

  function resetTool() {
    if (!window.confirm("确认清空本工具中保存的样本、assay 与板图？此操作不可撤销。")) return;
    localStorage.removeItem(STORAGE_KEY);
    setPlateType(96);
    setAssayMode("multiplex");
    setSamples(clone(DEFAULT_SAMPLES));
    setTargets(clone(DEFAULT_TARGETS));
    setReference(clone(DEFAULT_REFERENCE));
    setReplicates(4);
    setLayoutPreset("sample-major");
    setLoadingPattern("sequential");
    setReactionSystem(DEFAULT_REACTION_SYSTEM);
    setPlan(null);
    setSavedAt("");
    setIsDirty(false);
    setToast("工具已重置。 / Reset complete.");
  }

  function selectWell(wellId: string) {
    if (!plan) return;
    const plate = plan.plates[activePlate];
    const well = plate.wells.find((candidate) => candidate.id === wellId);
    if (!well) return;
    setSelectedWell(wellId);
    setEditorSampleId(well.sampleId);
    setEditorReactionSetId(well.reactionSetId || reactionSets[0]?.id || "");
    setEditorReplicate(well.replicate || 1);
  }

  function applyManualWell(clear = false) {
    if (!plan || !selectedWell) return;
    const next = clone(plan);
    const plate = next.plates[activePlate];
    const well = plate.wells.find((candidate) => candidate.id === selectedWell);
    if (!well) return;
    if (clear) {
      Object.assign(well, {
        sampleId: "",
        sample: "",
        sampleType: "",
        reactionSetId: "",
        reactionSet: "",
        replicate: null,
        targets: [],
        reference: "",
        source: "empty",
      });
    } else {
      const sample = samples.find((candidate) => candidate.id === editorSampleId);
      const set = next.reactionSets.find((candidate) => candidate.id === editorReactionSetId);
      if (!sample || !set) {
        setToast("请选择样本和反应组。 / Select a sample and reaction set.");
        return;
      }
      Object.assign(well, {
        sampleId: sample.id,
        sample: sample.name,
        sampleType: sample.type,
        reactionSetId: set.id,
        reactionSet: set.name,
        replicate: editorReplicate,
        targets: set.targets.map((target) => target.name),
        reference: set.reference.name,
        source: "manual",
      });
    }
    setPlan(refreshPlan(next));
    setIsDirty(true);
    setToast(clear ? `${selectedWell} 已清空。` : `${selectedWell} 已手工更新；请查看质控提示。`);
  }

  async function handleCopy(includeHeader: boolean) {
    if (!plan) return;
    await copyText(instrumentTsv(plan, plan.plates[activePlate], includeHeader));
    setToast(includeHeader ? "已复制 Well + Sample（含表头）。" : "已复制 Well + Sample（无表头）。");
  }

  const plate = plan?.plates[activePlate] ?? null;
  const dimensions = getPlateDimensions(plateType);
  const selected = plate?.wells.find((well) => well.id === selectedWell) ?? null;
  const errorCount = issues.filter((issue) => issue.severity === "error").length + reactionErrors.length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Layers3 size={21} /></div>
          <div>
            <h1>TaqMan CNV 板布局规划工具</h1>
            <p>CNV Analysis Plate Planner · qPCR Lab Tools Series</p>
          </div>
        </div>
        <div className="topbar-actions">
          <span className={`save-status ${isDirty ? "unsaved" : ""}`}>
            {isDirty ? "有未保存更改" : savedAt ? `已保存 ${new Date(savedAt).toLocaleString("zh-CN")}` : "未保存"}
          </span>
          <button className="button" onClick={saveState}><Save size={16} />保存</button>
          <button className="button button-ghost" onClick={resetTool}><RotateCcw size={16} />重置工具</button>
        </div>
      </header>

      <main className="workspace">
        <section className="hero-strip">
          <div>
            <span className="eyebrow"><Sparkles size={14} /> TECHNICIAN-FIRST · BROWSER-LOCAL</span>
            <h2>从样本清单到可上机板图，一次完成。</h2>
            <p>支持 96/384 孔、官方 duplex 与自建 multiplex、横向连续复孔、同板对照重复、10.0 µL 体系计算，以及可直接粘贴到 QuantStudio/SDS 的 Well + Sample 列表。</p>
          </div>
          <div className="hero-kpis">
            <div><strong>{plan?.plates.length ?? 0}</strong><span>Plates</span></div>
            <div><strong>{plan?.occupiedWells ?? 0}</strong><span>Wells</span></div>
            <div><strong>{errorCount}</strong><span>Errors</span></div>
          </div>
        </section>

        <div className="notice warning">
          <AlertTriangle size={18} />
          <div><strong>方法边界：</strong>标准 TaqMan Copy Number workflow 是 FAM target + VIC reference 的 duplex。当前 GSTM1-FAM / GSTT1-CY5 / RNase P-VIC 三色方案属于自建 multiplex，正式使用前需锁定 reporter/quencher、仪器光谱校准并与两个 duplex 完成桥接验证。</div>
        </div>

        <div className="layout-grid">
          <aside className="control-column">
            <section className="card section-card">
              <div className="section-heading"><span>01</span><div><h3>实验模式</h3><p>Plate & assay mode</p></div></div>
              <div className="segmented two">
                <button className={plateType === 96 ? "active" : ""} onClick={() => { setPlateType(96); markDirty(); }}>96-well</button>
                <button className={plateType === 384 ? "active" : ""} onClick={() => { setPlateType(384); markDirty(); }}>384-well</button>
              </div>
              <label className="field-label">检测模式 / Detection mode</label>
              <div className="mode-cards">
                <button className={assayMode === "duplex" ? "mode-card active" : "mode-card"} onClick={() => { setAssayMode("duplex"); markDirty(); }}>
                  <strong>Duplex</strong><span>每个 target 分别与 reference 同孔</span>
                </button>
                <button className={assayMode === "multiplex" ? "mode-card active" : "mode-card"} onClick={() => { setAssayMode("multiplex"); markDirty(); }}>
                  <strong>Multiplex</strong><span>多个 target + reference 同孔</span>
                </button>
              </div>
              <div className="field-row three">
                <label><span>复孔 / Replicates</span><input type="number" min={1} max={8} value={replicates} onChange={(event) => { setReplicates(Number(event.target.value)); markDirty(); }} /></label>
                <label><span>排序 / Layout</span><select value={layoutPreset} onChange={(event) => { setLayoutPreset(event.target.value as LayoutPreset); markDirty(); }}><option value="sample-major">按样本</option><option value="assay-major">按反应组</option></select></label>
                <label><span>加样路径</span><select value={loadingPattern} disabled={plateType === 96} onChange={(event) => { setLoadingPattern(event.target.value as LoadingPattern); markDirty(); }}><option value="sequential">连续 A–P</option><option value="interleaved-8-channel">9 mm 八道隔行</option></select></label>
              </div>
              {replicates < 4 && <p className="micro-warning">官方 CNV 指南建议 4 个复孔；当前设置适合作为方法开发条件，需谨慎判读。</p>}
            </section>

            <section className="card section-card">
              <div className="section-heading"><span>02</span><div><h3>样本与对照</h3><p>Samples & controls</p></div></div>
              <textarea className="bulk-input" value={bulkText} onChange={(event) => setBulkText(event.target.value)} placeholder="从 Excel 粘贴样本名称，每行一个…" />
              <button className="button button-soft full" onClick={importSamples} disabled={bulkNames.length === 0}><Plus size={16} />导入 {bulkNames.length} 个样本名称</button>
              <div className="editable-list sample-list">
                {samples.map((sample, index) => (
                  <div className="editable-row" key={sample.id}>
                    <input aria-label="样本名称" value={sample.name} onChange={(event) => updateSample(index, { name: event.target.value })} />
                    <select aria-label="样本类型" value={sample.type} onChange={(event) => updateSample(index, { type: event.target.value as SampleType })}>
                      {SAMPLE_TYPES.map((type) => <option key={type} value={type}>{sampleTypeLabel(type)}</option>)}
                    </select>
                    <button className="icon-button" aria-label="删除样本" onClick={() => { setSamples((current) => current.filter((_, sampleIndex) => sampleIndex !== index)); markDirty(); }}><Trash2 size={15} /></button>
                  </div>
                ))}
              </div>
              <button className="text-button" onClick={() => { setSamples((current) => [...current, { id: uid("sample"), name: `Unknown_${String(current.filter((sample) => sample.type === "unknown").length + 1).padStart(3, "0")}`, type: "unknown" }]); markDirty(); }}><Plus size={14} />添加一行</button>
            </section>

            <section className="card section-card">
              <div className="section-heading"><span>03</span><div><h3>Assay 与荧光</h3><p>Targets, reference & dyes</p></div></div>
              <div className="assay-header"><span>Target</span><span>Assay ID</span><span>Reporter</span><span>µL</span><span /></div>
              {targets.map((target, index) => (
                <div className="assay-row" key={target.id}>
                  <input value={target.name} aria-label="Target name" onChange={(event) => updateTarget(index, { name: event.target.value })} />
                  <input value={target.assayId} aria-label="Target assay ID" onChange={(event) => updateTarget(index, { assayId: event.target.value })} />
                  <input value={target.reporter} aria-label="Target reporter" onChange={(event) => updateTarget(index, { reporter: event.target.value })} />
                  <input type="number" min={0} step={0.1} value={target.volumeUl} aria-label="Target volume" onChange={(event) => updateTarget(index, { volumeUl: Number(event.target.value) })} />
                  <button className="icon-button" disabled={targets.length === 1} aria-label="删除 target" onClick={() => { setTargets((current) => current.filter((_, targetIndex) => targetIndex !== index)); markDirty(); }}><Trash2 size={14} /></button>
                </div>
              ))}
              <button className="text-button" onClick={() => { setTargets((current) => [...current, { id: uid("target"), name: `Target ${current.length + 1}`, assayId: "待确认", reporter: "待确认", volumeUl: 0.5 }]); markDirty(); }}><Plus size={14} />添加 Target assay</button>
              <div className="reference-block">
                <span className="reference-label">REFERENCE</span>
                <div className="assay-row no-delete">
                  <input value={reference.name} aria-label="Reference name" onChange={(event) => { setReference((current) => ({ ...current, name: event.target.value })); markDirty(); }} />
                  <input value={reference.assayId} aria-label="Reference assay ID" onChange={(event) => { setReference((current) => ({ ...current, assayId: event.target.value })); markDirty(); }} />
                  <input value={reference.reporter} aria-label="Reference reporter" onChange={(event) => { setReference((current) => ({ ...current, reporter: event.target.value })); markDirty(); }} />
                  <input type="number" min={0} step={0.1} value={reference.volumeUl} aria-label="Reference volume" onChange={(event) => { setReference((current) => ({ ...current, volumeUl: Number(event.target.value) })); markDirty(); }} />
                  <span />
                </div>
              </div>
              <div className="reaction-set-preview">
                <span>将生成 {reactionSets.length} 个反应组</span>
                {reactionSets.map((set) => <code key={set.id}>{set.name}</code>)}
              </div>
            </section>

            <section className="card section-card">
              <div className="section-heading"><span>04</span><div><h3>10.0 µL 体系</h3><p>Reaction setup</p></div></div>
              <div className="field-row two">
                <label><span>总体积 / Total (µL)</span><input type="number" step={0.5} value={reactionSystem.totalPerWellUl} onChange={(event) => { setReactionSystem((current) => ({ ...current, totalPerWellUl: Number(event.target.value) })); markDirty(); }} /></label>
                <label><span>2X Master Mix (µL)</span><input type="number" step={0.5} value={reactionSystem.masterMixPerWellUl} onChange={(event) => { setReactionSystem((current) => ({ ...current, masterMixPerWellUl: Number(event.target.value) })); markDirty(); }} /></label>
                <label><span>gDNA / NTC water (µL)</span><input type="number" step={0.5} value={reactionSystem.templatePerWellUl} onChange={(event) => { setReactionSystem((current) => ({ ...current, templatePerWellUl: Number(event.target.value) })); markDirty(); }} /></label>
                <label><span>余量 / Overage (%)</span><input type="number" step={1} value={reactionSystem.overagePercent} onChange={(event) => { setReactionSystem((current) => ({ ...current, overagePercent: Number(event.target.value) })); markDirty(); }} /></label>
              </div>
              <p className="micro-note"><Info size={14} />水量按每个反应组自动补足；multiplex target 数或 assay 体积变化后会分别校验。</p>
            </section>

            <button className="button button-primary generate-button" onClick={generatePlan}><Sparkles size={17} />生成 CNV 板布局</button>
          </aside>

          <section className="result-column">
            {!plan || !plate ? (
              <div className="empty-state card">
                <div className="empty-icon"><FlaskConical size={30} /></div>
                <h3>板布局将在这里生成</h3>
                <p>确认样本、assay、荧光通道和反应体系后，点击“生成 CNV 板布局”。</p>
                <div className="empty-checks"><span><CheckCircle2 size={15} />对照每板重复</span><span><CheckCircle2 size={15} />复孔横向连续</span><span><CheckCircle2 size={15} />仪器粘贴表</span></div>
              </div>
            ) : (
              <>
                <section className="card plate-card">
                  <div className="plate-toolbar">
                    <div>
                      <span className="eyebrow">PLATE LAYOUT</span>
                      <h3>{plate.name}</h3>
                    </div>
                    <div className="plate-actions">
                      <button className="button" onClick={() => handleCopy(true)}><Clipboard size={15} />复制含表头</button>
                      <button className="button" onClick={() => handleCopy(false)}><Clipboard size={15} />复制无表头</button>
                      <button className="button" onClick={() => exportOnePlate(plan, plate, reactionSystem)}><FileSpreadsheet size={15} />本板 Excel</button>
                      <button className="button button-primary" disabled={reactionErrors.length > 0} onClick={() => exportAllPlates(plan, reactionSystem)}><Download size={15} />导出全部</button>
                    </div>
                  </div>

                  <div className="plate-tabs">
                    {plan.plates.map((item, index) => (
                      <button key={item.plateNumber} className={activePlate === index ? "active" : ""} onClick={() => { setActivePlate(index); setSelectedWell(null); }}>
                        P{String(item.plateNumber).padStart(2, "0")}<span>{item.wells.filter((well) => well.sample).length} wells</span>
                      </button>
                    ))}
                  </div>

                  <div className={`plate-scroll plate-${plateType}`}>
                    <div className="plate-grid" style={{ gridTemplateColumns: `38px repeat(${dimensions.columns}, minmax(${plateType === 96 ? 70 : 48}px, 1fr))` }}>
                      <div className="corner-cell" />
                      {Array.from({ length: dimensions.columns }, (_, index) => <div className="column-header" key={`column-${index}`}>{index + 1}</div>)}
                      {Array.from({ length: dimensions.rows }, (_, row) => (
                        <div className="plate-row" key={`row-${row}`} style={{ display: "contents" }}>
                          <div className="row-header">{rowLabel(row)}</div>
                          {Array.from({ length: dimensions.columns }, (_, column) => {
                            const well = plate.wells.find((candidate) => candidate.row === row && candidate.column === column)!;
                            return (
                              <button
                                key={well.id}
                                className={`well ${well.sample ? "occupied" : "empty"} ${well.sampleType ? sampleTone(well.sampleType) : ""} ${selectedWell === well.id ? "selected" : ""} ${well.source === "manual" ? "manual" : ""}`}
                                onClick={() => selectWell(well.id)}
                                title={well.sample ? `${well.id} · ${well.sample} · ${well.reactionSet} · R${well.replicate}` : well.id}
                              >
                                <span className="well-id">{formatWellId(row, column, plateType)}</span>
                                {well.sample && <><strong>{well.sample}</strong><small>{well.targets.join("+")} · R{well.replicate}</small></>}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="plate-legend">
                    <span><i className="dot unknown" />Unknown</span><span><i className="dot calibrator" />Calibrator</span><span><i className="dot ntc" />NTC</span><span><i className="dot qc" />0/1/2-copy QC</span><span><i className="dot manual" />Manual</span>
                  </div>
                </section>

                {selected && (
                  <section className="card well-editor">
                    <div className="editor-title"><div><span>手工编辑孔 / Manual edit</span><strong>{selected.id}</strong></div><button className="icon-button" onClick={() => setSelectedWell(null)}><X size={16} /></button></div>
                    <div className="field-row three editor-fields">
                      <label><span>样本</span><select value={editorSampleId} onChange={(event) => setEditorSampleId(event.target.value)}><option value="">请选择</option>{samples.map((sample) => <option key={sample.id} value={sample.id}>{sample.name} · {sampleTypeLabel(sample.type)}</option>)}</select></label>
                      <label><span>反应组</span><select value={editorReactionSetId} onChange={(event) => setEditorReactionSetId(event.target.value)}>{plan.reactionSets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}</select></label>
                      <label><span>复孔编号</span><input type="number" min={1} max={replicates} value={editorReplicate} onChange={(event) => setEditorReplicate(Number(event.target.value))} /></label>
                    </div>
                    <div className="editor-actions"><button className="button danger-outline" onClick={() => applyManualWell(true)}><Trash2 size={15} />清空此孔</button><button className="button button-primary" onClick={() => applyManualWell(false)}>应用并标记手工复核</button></div>
                  </section>
                )}

                <section className="card qa-card">
                  <div className="qa-summary">
                    <div className={errorCount ? "qa-badge error" : "qa-badge success"}><ShieldCheck size={19} /><strong>{errorCount ? `${errorCount} 个错误` : "结构校验通过"}</strong></div>
                    <div className="qa-badge warning"><AlertTriangle size={18} /><strong>{warningCount} 个提醒</strong></div>
                    <span>排板规则、同板对照、复孔数与反应总体积</span>
                  </div>
                  {(issues.length > 0 || reactionErrors.length > 0) && <div className="issue-list">
                    {reactionErrors.map((message) => <div className="issue error" key={message}><AlertTriangle size={15} />{message}</div>)}
                    {issues.map((issue, index) => <div className={`issue ${issue.severity}`} key={`${issue.code}-${index}`}><AlertTriangle size={15} />{issue.plateNumber ? `P${String(issue.plateNumber).padStart(2, "0")} · ` : ""}{issue.wellId ? `${issue.wellId} · ` : ""}{issue.message}</div>)}
                  </div>}
                </section>

                {requirements && (
                  <section className="card reaction-card">
                    <div className="plate-toolbar"><div><span className="eyebrow">REACTION SETUP</span><h3>{reactionSystem.totalPerWellUl.toFixed(1)} µL 公共反应液与模板需求</h3></div><span className="pill"><Beaker size={14} />{reactionSystem.overagePercent}% overage</span></div>
                    <div className="mix-groups">
                      {requirements.groups.map((group) => (
                        <article className="mix-group" key={group.reactionSet.id}>
                          <div className="mix-title"><div><strong>{group.reactionSet.name}</strong><span>{group.wells} wells · prepare {group.preparationReactions} reactions</span></div><b>{group.mixDispensePerWellUl.toFixed(1)} µL/孔</b></div>
                          <table><thead><tr><th>组分</th><th>每孔 µL</th><th>总量 µL</th></tr></thead><tbody>{group.components.map((component) => <tr key={component.name}><td>{component.name}</td><td>{component.perWellUl.toFixed(2)}</td><td>{component.totalUl.toFixed(2)}</td></tr>)}</tbody></table>
                          <p>另加 gDNA 或 NTC water：{reactionSystem.templatePerWellUl.toFixed(1)} µL/孔</p>
                        </article>
                      ))}
                    </div>
                  </section>
                )}

                <section className="card paste-preview">
                  <div className="plate-toolbar"><div><span className="eyebrow">INSTRUMENT SAMPLE LIST</span><h3>仪器样本列表预览</h3></div><span className="pill"><Clipboard size={14} />Well + Sample</span></div>
                  <div className="paste-table-wrap"><table><thead><tr><th>Well</th><th>Sample</th></tr></thead><tbody>{plate.wells.slice(0, 16).map((well) => <tr key={well.id}><td>{formatWellId(well.row, well.column, plateType)}</td><td>{well.sample}</td></tr>)}</tbody></table><div className="fade-note">导出 Excel 含完整 {plateType} 行列表，并同时提供“含表头”和“无表头”两个工作表。</div></div>
                </section>
              </>
            )}
          </section>
        </div>
      </main>

      {toast && <div className="toast" role="status" onClick={() => setToast("")}><CheckCircle2 size={17} />{toast}<button><X size={14} /></button></div>}
      <footer><span>Research Use Only · 数据仅在当前浏览器处理</span><span>Sources: Thermo Fisher TaqMan CNV Guide 4397425 · QuantStudio D&A Guide · Multiplex Optimization Guide</span></footer>
    </div>
  );
}
