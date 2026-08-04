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
  Languages,
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
  findDuplicateReporters,
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
type Language = "zh" | "en";
const LEGACY_PRESET_ASSAY_IDS = new Set(["Ho_33001161_cn", "Ho_33001153_cn", "Ho_00021109_cn"]);

interface StoredState {
  version: 1;
  language?: Language;
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
    assayId: "",
    reporter: "FAM",
    volumeUl: 0.5,
  },
  {
    id: "target-gstt1",
    name: "GSTT1",
    assayId: "",
    reporter: "CY5",
    volumeUl: 0.5,
  },
];

const DEFAULT_REFERENCE: ReferenceAssay = {
  name: "RNase P",
  assayId: "",
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
  const [language, setLanguage] = useState<Language>("zh");
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
  const tr = (zh: string, en: string) => (language === "zh" ? zh : en);

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
  const duplicateReporters = useMemo(() => {
    return findDuplicateReporters({ assayMode, targets, reference });
  }, [assayMode, targets, reference]);
  const reporterIsDuplicate = (reporter: string) => duplicateReporters.has(reporter.trim().toLocaleUpperCase());

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const stored = JSON.parse(raw) as StoredState;
        if (stored.version !== 1) return;
        setLanguage(stored.language ?? "zh");
        setPlateType(stored.plateType);
        setAssayMode(stored.assayMode);
        setSamples(stored.samples);
        setTargets(stored.targets.map((target) => LEGACY_PRESET_ASSAY_IDS.has(target.assayId) ? { ...target, assayId: "" } : target));
        setReference(LEGACY_PRESET_ASSAY_IDS.has(stored.reference.assayId) ? { ...stored.reference, assayId: "" } : stored.reference);
        setReplicates(stored.replicates);
        setLayoutPreset(stored.layoutPreset);
        setLoadingPattern(stored.plateType === 96 ? "sequential" : stored.loadingPattern);
        setReactionSystem(stored.reactionSystem);
        setPlan(stored.plan);
        setSavedAt(stored.savedAt);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);

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
    setToast(tr(`已导入 ${additions.length} 个样本名称。`, `Imported ${additions.length} sample name(s).`));
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
      setToast(tr(`已生成 ${nextPlan.plates.length} 块板，共 ${nextPlan.occupiedWells} 个反应孔。`, `Generated ${nextPlan.plates.length} plate(s) with ${nextPlan.occupiedWells} reaction wells.`));
    } catch (error) {
      setToast(error instanceof Error ? error.message : "排板失败，请检查输入。 / Planning failed.");
    }
  }

  function saveState() {
    const stored: StoredState = {
      version: 1,
      language,
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
    setToast(tr("已保存到本浏览器。", "Saved in this browser."));
  }

  function resetTool() {
    if (!window.confirm(tr("确认清空本工具中保存的样本、assay 与板图？此操作不可撤销。", "Clear all saved samples, assays, and plate layouts? This cannot be undone."))) return;
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
    setToast(tr("工具已重置。", "Reset complete."));
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
        setToast(tr("请选择样本和反应组。", "Select a sample and reaction set."));
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
    setToast(clear ? tr(`${selectedWell} 已清空。`, `${selectedWell} cleared.`) : tr(`${selectedWell} 已手工更新；请查看质控提示。`, `${selectedWell} updated manually; review the QC messages.`));
  }

  async function handleCopy(includeHeader: boolean) {
    if (!plan) return;
    await copyText(instrumentTsv(plan, plan.plates[activePlate], includeHeader));
    setToast(includeHeader ? tr("已复制 Well + Sample（含表头）。", "Copied Well + Sample with headers.") : tr("已复制 Well + Sample（无表头）。", "Copied Well + Sample without headers."));
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
          <div className="brand-mark"><Layers3 size={20} /></div>
          <div className="brand-copy">
            <p className="brand-title">{tr("CNV Analysis 板布局规划工具", "CNV Analysis Plate Layout Planner")}</p>
            <p className="brand-subtitle">{tr("96 / 384 孔 · 排板与反应用量", "96 / 384 wells · Layout & reaction planning")}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="language-switch" role="group" aria-label={tr("界面语言", "Interface language")}>
            <Languages size={14} aria-hidden="true" />
            <button type="button" className={language === "zh" ? "active" : ""} aria-pressed={language === "zh"} onClick={() => setLanguage("zh")}>中文</button>
            <button type="button" className={language === "en" ? "active" : ""} aria-pressed={language === "en"} onClick={() => setLanguage("en")}>EN</button>
          </div>
          <span className={`save-status ${isDirty ? "unsaved" : ""}`}>
            {isDirty ? tr("有未保存更改", "Unsaved changes") : savedAt ? tr(`已保存 ${new Date(savedAt).toLocaleString("zh-CN")}`, `Saved ${new Date(savedAt).toLocaleString("en")}`) : tr("本地就绪", "Ready")}
          </span>
          <button className="button button-clear" onClick={resetTool}><RotateCcw size={16} />{tr("重置工具", "Reset tool")}</button>
          <button className="button" onClick={saveState}><Save size={16} />{tr("保存", "Save")}</button>
          <button className="button button-primary" disabled={!plan || reactionErrors.length > 0} onClick={() => plan && exportAllPlates(plan, reactionSystem)}><Download size={16} />{tr("全部导出", "Export all")}</button>
        </div>
      </header>

      <div className="workspace">
          <aside className="sidebar control-column" aria-label={tr("实验设置", "Experiment setup")}>
            <section className="card section-card">
              <div className="section-heading"><span>01</span><div><h3>{tr("选择孔板与模式", "Plate & assay mode")}</h3><p>{tr("选择本次上机板型", "Select the plate format")}</p></div></div>
              <div className="plate-picker">
                {([96, 384] as const).map((type) => {
                  const size = getPlateDimensions(type);
                  return <button key={type} className={`plate-choice ${plateType === type ? "selected" : ""}`} onClick={() => { setPlateType(type); if (type === 96) setLoadingPattern("sequential"); markDirty(); }}>
                    <span><span className="plate-choice-name">{tr(`${type} 孔板`, `${type}-well plate`)}</span><span className="plate-choice-meta">{tr(`${size.rows} 行 × ${size.columns} 列`, `${size.rows} rows × ${size.columns} columns`)}</span></span>
                    <span className="plate-mini" aria-hidden="true">{Array.from({ length: 12 }).map((_, index) => <span key={index} />)}</span>
                  </button>;
                })}
              </div>
              <label className="field-label">{tr("检测模式", "Detection mode")}</label>
              <div className="mode-cards">
                <button className={assayMode === "duplex" ? "mode-card active" : "mode-card"} onClick={() => { setAssayMode("duplex"); markDirty(); }}>
                  <strong>Duplex</strong><span>{tr("每个 target 分别与 reference 同孔", "Each target shares a well with the reference")}</span>
                </button>
                <button className={assayMode === "multiplex" ? "mode-card active" : "mode-card"} onClick={() => { setAssayMode("multiplex"); markDirty(); }}>
                  <strong>Multiplex</strong><span>{tr("多个 target + reference 同孔", "Multiple targets and the reference share one well")}</span>
                </button>
              </div>
              <div className="field-row three">
                <label><span>{tr("复孔", "Replicates")}</span><input type="number" min={1} max={8} value={replicates} onChange={(event) => { setReplicates(Number(event.target.value)); markDirty(); }} /></label>
                <label><span>{tr("排序", "Layout")}</span><select value={layoutPreset} onChange={(event) => { setLayoutPreset(event.target.value as LayoutPreset); markDirty(); }}><option value="sample-major">{tr("按样本", "By sample")}</option><option value="assay-major">{tr("按反应组", "By reaction set")}</option></select></label>
                <label><span>{tr("加样方式", "Loading method")}</span><select value={loadingPattern} disabled={plateType === 96} onChange={(event) => { setLoadingPattern(event.target.value as LoadingPattern); markDirty(); }}><option value="sequential">{plateType === 96 ? tr("八道排枪直接上样", "Direct 8-channel loading") : tr("连续行序 A–P", "Sequential rows A–P")}</option><option value="interleaved-8-channel">{tr("9 mm 八道隔行", "9 mm interleaved 8-channel")}</option></select></label>
              </div>
              {plateType === 384 && <p className="loading-pattern-note">{tr("连续行序按 A→P；9 mm 八道隔行分 A/C/E/G/I/K/M/O 与 B/D/F/H/J/L/N/P 两轮。", "Sequential follows A→P; 9 mm interleaved uses A/C/E/G/I/K/M/O and B/D/F/H/J/L/N/P in two passes.")}</p>}
              {replicates < 4 && <p className="micro-warning">{tr("官方 CNV 指南建议 4 个复孔；当前设置适合作为方法开发条件，需谨慎判读。", "The official CNV guide recommends four replicates; use fewer replicates only for carefully reviewed method development.")}</p>}
            </section>

            <section className="card section-card">
              <div className="section-heading"><span>02</span><div><h3>{tr("样本与对照", "Samples & controls")}</h3><p>{tr("逐个输入或从 Excel 粘贴", "Enter individually or paste from Excel")}</p></div></div>
              <textarea className="bulk-input" value={bulkText} onChange={(event) => setBulkText(event.target.value)} placeholder={tr("从 Excel 粘贴样本名称，每行一个…", "Paste sample names from Excel, one per line…")} />
              <button className="button button-soft full" onClick={importSamples} disabled={bulkNames.length === 0}><Plus size={16} />{tr(`导入 ${bulkNames.length} 个样本名称`, `Import ${bulkNames.length} sample name(s)`)}</button>
              <div className="editable-list sample-list">
                {samples.map((sample, index) => (
                  <div className="editable-row" key={sample.id}>
                    <input aria-label={tr("样本名称", "Sample name")} value={sample.name} onChange={(event) => updateSample(index, { name: event.target.value })} />
                    <select aria-label={tr("样本类型", "Sample type")} value={sample.type} onChange={(event) => updateSample(index, { type: event.target.value as SampleType })}>
                      {SAMPLE_TYPES.map((type) => <option key={type} value={type}>{sampleTypeLabel(type)}</option>)}
                    </select>
                    <button className="icon-button" aria-label={tr("删除样本", "Delete sample")} onClick={() => { setSamples((current) => current.filter((_, sampleIndex) => sampleIndex !== index)); markDirty(); }}><Trash2 size={15} /></button>
                  </div>
                ))}
              </div>
              <button className="text-button" onClick={() => { setSamples((current) => [...current, { id: uid("sample"), name: `Unknown_${String(current.filter((sample) => sample.type === "unknown").length + 1).padStart(3, "0")}`, type: "unknown" }]); markDirty(); }}><Plus size={14} />{tr("添加一行", "Add row")}</button>
            </section>

            <section className="card section-card">
              <div className="section-heading"><span>03</span><div><h3>{tr("Assay 与荧光", "Assays & reporters")}</h3><p>{tr("靶标、参照与染料", "Targets, reference & dyes")}</p></div></div>
              <div className="assay-header"><span>Target</span><span>Assay ID</span><span>Reporter</span><span className="unit-header">µL</span><span /></div>
              {targets.map((target, index) => (
                <div className="assay-row" key={target.id}>
                  <input value={target.name} aria-label="Target name" onChange={(event) => updateTarget(index, { name: event.target.value })} />
                  <input value={target.assayId} placeholder={tr("可留空", "Optional")} aria-label="Target assay ID" onChange={(event) => updateTarget(index, { assayId: event.target.value })} />
                  <input className={reporterIsDuplicate(target.reporter) ? "reporter-error" : ""} aria-invalid={reporterIsDuplicate(target.reporter)} value={target.reporter} aria-label="Target reporter" onChange={(event) => updateTarget(index, { reporter: event.target.value })} />
                  <input type="number" min={0} step={0.1} value={target.volumeUl} aria-label="Target volume" onChange={(event) => updateTarget(index, { volumeUl: Number(event.target.value) })} />
                  <button className="icon-button" disabled={targets.length === 1} aria-label="删除 target" onClick={() => { setTargets((current) => current.filter((_, targetIndex) => targetIndex !== index)); markDirty(); }}><Trash2 size={14} /></button>
                </div>
              ))}
              <button className="text-button" onClick={() => { setTargets((current) => [...current, { id: uid("target"), name: `Target ${current.length + 1}`, assayId: "", reporter: "", volumeUl: 0.5 }]); markDirty(); }}><Plus size={14} />{tr("添加 Target assay", "Add target assay")}</button>
              <div className="reference-block">
                <span className="reference-label">REFERENCE</span>
                <div className="assay-row no-delete">
                  <input value={reference.name} aria-label="Reference name" onChange={(event) => { setReference((current) => ({ ...current, name: event.target.value })); markDirty(); }} />
                  <input value={reference.assayId} placeholder={tr("可留空", "Optional")} aria-label="Reference assay ID" onChange={(event) => { setReference((current) => ({ ...current, assayId: event.target.value })); markDirty(); }} />
                  <input className={reporterIsDuplicate(reference.reporter) ? "reporter-error" : ""} aria-invalid={reporterIsDuplicate(reference.reporter)} value={reference.reporter} aria-label="Reference reporter" onChange={(event) => { setReference((current) => ({ ...current, reporter: event.target.value })); markDirty(); }} />
                  <input type="number" min={0} step={0.1} value={reference.volumeUl} aria-label="Reference volume" onChange={(event) => { setReference((current) => ({ ...current, volumeUl: Number(event.target.value) })); markDirty(); }} />
                  <span />
                </div>
              </div>
              <div className="reaction-set-preview">
                <span>{tr(`将生成 ${reactionSets.length} 个反应组`, `${reactionSets.length} reaction set(s) will be generated`)}</span>
                {reactionSets.map((set) => <code key={set.id}>{set.name}</code>)}
              </div>
              {duplicateReporters.size > 0 && <p className="reporter-error-note"><AlertTriangle size={14} />{tr("Multiplex 同孔 Reporter 不可重复。", "Reporter channels must be distinct within a multiplex well.")}</p>}
            </section>

            <button className="button button-primary generate-button" disabled={duplicateReporters.size > 0} onClick={generatePlan}><Sparkles size={17} />{tr("生成 CNV 板布局", "Generate CNV layout")}</button>
          </aside>

          <main className="main-area result-column">
            <section className={`hero-strip ${plan ? "" : "empty-preview"}`} aria-labelledby="planner-title">
              <div>
                <p className="eyebrow"><ShieldCheck size={13} />{tr("板布局预览", "Layout preview")}</p>
                <h1 className="hero-title" id="planner-title">{plan ? tr(`已生成 ${plan.plates.length} 块 CNV 实验板`, `${plan.plates.length} CNV plate(s) generated`) : tr("请先完成左侧实验设置", "Complete the setup on the left")}</h1>
                <p className="hero-copy">{tr(
                  "支持 96/384 孔、官方 duplex 与自建 multiplex、横向连续复孔、同板对照重复、10.0 µL 体系计算，以及可直接粘贴到 QuantStudio/SDS 的 Well + Sample 列表。",
                  "Supports 96/384-well plates, official duplex and custom multiplex assays, horizontally contiguous replicates, controls repeated on every plate, 10.0 µL reaction calculations, and Well + Sample lists ready to paste into QuantStudio/SDS.",
                )}</p>
              </div>
              {plan && <div className="summary-grid" aria-label={tr("布局摘要", "Layout summary")}>
                <div className="metric"><span className="metric-label">{tr("预计孔板", "Plates")}</span><strong className="metric-value">{plan?.plates.length ?? "—"}</strong><span className="metric-detail">{plan ? `${plateType}-well` : tr("等待输入", "Waiting")}</span></div>
                <div className="metric"><span className="metric-label">{tr("反应孔", "Reactions")}</span><strong className="metric-value">{plan?.occupiedWells ?? "—"}</strong><span className="metric-detail">{tr("含跨板重复", "Includes repeated controls")}</span></div>
                <div className="metric"><span className="metric-label">{tr("利用率", "Utilization")}</span><strong className="metric-value">{plan ? `${Math.round(plan.occupiedWells / (plan.plates.length * plateType) * 100)}%` : "—"}</strong><span className="metric-detail">{plan ? `${plan.occupiedWells} / ${plan.plates.length * plateType}` : "—"}</span></div>
                <div className="metric"><span className="metric-label">{tr("排布方式", "Layout")}</span><strong className="metric-value metric-text">{plan ? (layoutPreset === "sample-major" ? tr("按样本", "Sample") : tr("按反应组", "Reaction")) : "—"}</strong><span className="metric-detail">{plan ? tr("复孔横向连续", "Horizontal replicates") : tr("等待生成", "Waiting")}</span></div>
              </div>}
            </section>

          <section className="result-content">
            <div className="layout-workbench">
              <div className="plate-stage">
                {!plan || !plate ? (
                  <div className="empty-state compact-empty-state card">
                    <div className="empty-icon"><FlaskConical size={22} /></div>
                    <div>
                      <h3>{tr("板布局将在这里生成", "Your plate layout will appear here")}</h3>
                      <p>{tr("完成左侧样本与 assay 设置后生成布局；反应体系可在右侧随时配置。", "Complete the sample and assay setup on the left, then generate the layout; configure the reaction setup on the right at any time.")}</p>
                    </div>
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
                      <button className="button" onClick={() => handleCopy(true)}><Clipboard size={15} />{tr("复制含表头", "Copy with headers")}</button>
                      <button className="button" onClick={() => handleCopy(false)}><Clipboard size={15} />{tr("复制无表头", "Copy without headers")}</button>
                      <button className="button" onClick={() => exportOnePlate(plan, plate, reactionSystem)}><FileSpreadsheet size={15} />{tr("本板 Excel", "Plate Excel")}</button>
                    </div>
                  </div>
                  <p className="copy-helper"><Info size={12} />{tr("“含表头”复制 Well 与 Sample 两列及列名；“无表头”只复制数据行。两者都用于将当前板的样本列表直接粘贴到 QuantStudio/SDS。", "With headers copies the Well and Sample column names plus data; without headers copies data rows only. Both formats paste the current plate sample list directly into QuantStudio/SDS.")}</p>

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
                    <span><i className="dot unknown" />Unknown</span><span><i className="dot calibrator" />Calibrator</span><span><i className="dot ntc" />NTC</span><span><i className="dot qc" />0/1/2-copy QC</span><span><i className="dot manual" />{tr("手工", "Manual")}</span>
                  </div>
                </section>

                {selected && (
                  <section className="card well-editor">
                    <div className="editor-title"><div><span>{tr("手工编辑孔", "Manual well edit")}</span><strong>{selected.id}</strong></div><button className="icon-button" aria-label={tr("关闭", "Close")} onClick={() => setSelectedWell(null)}><X size={16} /></button></div>
                    <div className="field-row three editor-fields">
                      <label><span>{tr("样本", "Sample")}</span><select value={editorSampleId} onChange={(event) => setEditorSampleId(event.target.value)}><option value="">{tr("请选择", "Select")}</option>{samples.map((sample) => <option key={sample.id} value={sample.id}>{sample.name} · {sampleTypeLabel(sample.type)}</option>)}</select></label>
                      <label><span>{tr("反应组", "Reaction set")}</span><select value={editorReactionSetId} onChange={(event) => setEditorReactionSetId(event.target.value)}>{plan.reactionSets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}</select></label>
                      <label><span>{tr("复孔编号", "Replicate number")}</span><input type="number" min={1} max={replicates} value={editorReplicate} onChange={(event) => setEditorReplicate(Number(event.target.value))} /></label>
                    </div>
                    <div className="editor-actions"><button className="button danger-outline" onClick={() => applyManualWell(true)}><Trash2 size={15} />{tr("清空此孔", "Clear well")}</button><button className="button button-primary" onClick={() => applyManualWell(false)}>{tr("应用并标记手工复核", "Apply and mark for manual review")}</button></div>
                  </section>
                )}

                <section className="card qa-card">
                  <div className="qa-summary">
                    <div className={errorCount ? "qa-badge error" : "qa-badge success"}><ShieldCheck size={19} /><strong>{errorCount ? tr(`${errorCount} 个错误`, `${errorCount} error(s)`) : tr("结构校验通过", "Structural checks passed")}</strong></div>
                    <div className="qa-badge warning"><AlertTriangle size={18} /><strong>{tr(`${warningCount} 个提醒`, `${warningCount} warning(s)`)}</strong></div>
                    <span>{tr("排板规则、同板对照、复孔数与反应总体积", "Layout rules, plate-level controls, replicates, and total reaction volume")}</span>
                  </div>
                  {(issues.length > 0 || reactionErrors.length > 0) && <div className="issue-list">
                    {reactionErrors.map((message) => <div className="issue error" key={message}><AlertTriangle size={15} />{message}</div>)}
                    {issues.map((issue, index) => <div className={`issue ${issue.severity}`} key={`${issue.code}-${index}`}><AlertTriangle size={15} />{issue.plateNumber ? `P${String(issue.plateNumber).padStart(2, "0")} · ` : ""}{issue.wellId ? `${issue.wellId} · ` : ""}{issue.message}</div>)}
                  </div>}
                </section>

                  </>
                )}
              </div>

              <aside className="reaction-column" aria-label={tr("反应体系与用量", "Reaction setup and volumes")}>
                <section className="card reaction-card reaction-panel">
                  <div className="section-heading reaction-heading"><span>04</span><div><h3>{tr("反应体系与用量", "Reaction setup & volumes")}</h3><p>{tr("每孔体积与配液余量", "Per-well volumes & overage")}</p></div></div>
                  <div className="field-row two reaction-input-grid">
                    <label><span>{tr("总体积", "Total volume")} (µL)</span><input type="number" step={0.5} value={reactionSystem.totalPerWellUl} onChange={(event) => { setReactionSystem((current) => ({ ...current, totalPerWellUl: Number(event.target.value) })); markDirty(); }} /></label>
                    <label><span>2X Master Mix (µL)</span><input type="number" step={0.5} value={reactionSystem.masterMixPerWellUl} onChange={(event) => { setReactionSystem((current) => ({ ...current, masterMixPerWellUl: Number(event.target.value) })); markDirty(); }} /></label>
                    <label><span>gDNA / NTC water (µL)</span><input type="number" step={0.5} value={reactionSystem.templatePerWellUl} onChange={(event) => { setReactionSystem((current) => ({ ...current, templatePerWellUl: Number(event.target.value) })); markDirty(); }} /></label>
                    <label><span>{tr("余量", "Overage")} (%)</span><input type="number" step={1} value={reactionSystem.overagePercent} onChange={(event) => { setReactionSystem((current) => ({ ...current, overagePercent: Number(event.target.value) })); markDirty(); }} /></label>
                  </div>
                  <p className="micro-note"><Info size={14} />{tr("水量按每个反应组自动补足；multiplex target 数或 assay 体积变化后会分别校验。", "Water is calculated per reaction set; multiplex target count and assay-volume changes are validated independently.")}</p>

                  {requirements ? (
                    <div className="reaction-results">
                      <div className="reaction-results-heading">
                        <div><span className="eyebrow">REACTION SETUP</span><h3>{tr(`${reactionSystem.totalPerWellUl.toFixed(1)} µL 配液需求`, `${reactionSystem.totalPerWellUl.toFixed(1)} µL mix requirements`)}</h3></div>
                        <span className="pill"><Beaker size={14} />{reactionSystem.overagePercent}% overage</span>
                      </div>
                      <div className="mix-groups reaction-mix-groups">
                        {requirements.groups.map((group) => (
                          <article className="mix-group" key={group.reactionSet.id}>
                            <div className="mix-title"><div><strong>{group.reactionSet.name}</strong><span>{tr(`${group.wells} 孔 · 配制 ${group.preparationReactions} 个反应`, `${group.wells} wells · prepare ${group.preparationReactions} reactions`)}</span></div><b>{group.mixDispensePerWellUl.toFixed(1)} µL/{tr("孔", "well")}</b></div>
                            <table><thead><tr><th>{tr("组分", "Component")}</th><th>{tr("每孔", "Per well")} (µL)</th><th>{tr("总量", "Total")} (µL)</th></tr></thead><tbody>{group.components.map((component) => <tr key={component.name}><td>{component.name}</td><td>{component.perWellUl.toFixed(2)}</td><td>{component.totalUl.toFixed(2)}</td></tr>)}</tbody></table>
                            <p>{tr("另加", "Add separately")} gDNA {tr("或", "or")} NTC water: {reactionSystem.templatePerWellUl.toFixed(1)} µL/{tr("孔", "well")}</p>
                          </article>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="reaction-awaiting"><Beaker size={18} /><span>{tr("生成板布局后，这里会立即显示各反应组的配液总量。", "Generate the plate layout to see preparation totals for every reaction set here.")}</span></div>
                  )}
                </section>
              </aside>
            </div>
          </section>
          </main>
      </div>

      {toast && <div className="toast" role="status" onClick={() => setToast("")}><CheckCircle2 size={17} />{toast}<button><X size={14} /></button></div>}
      <footer><span>{tr("仅供科研使用 · 数据仅在当前浏览器处理", "Research Use Only · Data stays in this browser")}</span><span>Sources: Thermo Fisher TaqMan CNV Guide 4397425 · QuantStudio D&A Guide · Multiplex Optimization Guide</span></footer>
    </div>
  );
}
