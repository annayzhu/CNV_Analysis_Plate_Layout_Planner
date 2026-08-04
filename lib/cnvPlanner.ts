export type PlateType = 96 | 384;
export type AssayMode = "duplex" | "multiplex";
export type LayoutPreset = "sample-major" | "assay-major";
export type LoadingPattern = "sequential" | "interleaved-8-channel";
export type SampleType =
  | "unknown"
  | "calibrator"
  | "ntc"
  | "qc-0"
  | "qc-1"
  | "qc-2";

export interface SampleInput {
  id: string;
  name: string;
  type: SampleType;
}

export interface TargetAssay {
  id: string;
  name: string;
  assayId: string;
  reporter: string;
  volumeUl: number;
}

export interface ReferenceAssay {
  name: string;
  assayId: string;
  reporter: string;
  volumeUl: number;
}

export interface ReactionSet {
  id: string;
  name: string;
  targets: TargetAssay[];
  reference: ReferenceAssay;
}

export interface PlanInput {
  plateType: PlateType;
  assayMode: AssayMode;
  samples: SampleInput[];
  targets: TargetAssay[];
  reference: ReferenceAssay;
  replicates: number;
  layoutPreset: LayoutPreset;
  loadingPattern: LoadingPattern;
}

export interface PlannerWell {
  id: string;
  row: number;
  column: number;
  sampleId: string;
  sample: string;
  sampleType: SampleType | "";
  reactionSetId: string;
  reactionSet: string;
  replicate: number | null;
  targets: string[];
  reference: string;
  source: "planned" | "manual" | "empty";
}

export interface PlannerPlate {
  plateNumber: number;
  name: string;
  wells: PlannerWell[];
}

export interface PlanResult {
  input: PlanInput;
  reactionSets: ReactionSet[];
  plates: PlannerPlate[];
  occupiedWells: number;
  manualWells: number;
}

export interface ValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  plateNumber?: number;
  wellId?: string;
}

export const INTERLEAVED_384_ROW_ORDER = [
  0, 2, 4, 6, 8, 10, 12, 14, 1, 3, 5, 7, 9, 11, 13, 15,
] as const;

export function defaultLoadingPattern(plateType: PlateType): LoadingPattern {
  return plateType === 384 ? "interleaved-8-channel" : "sequential";
}

interface Unit {
  sample: SampleInput;
  reactionSet: ReactionSet;
}

export function getPlateDimensions(plateType: PlateType) {
  return plateType === 96
    ? { rows: 8, columns: 12 }
    : { rows: 16, columns: 24 };
}

export function rowLabel(rowIndex: number) {
  return String.fromCharCode(65 + rowIndex);
}

export function formatWellId(
  rowIndex: number,
  columnIndex: number,
  plateType: PlateType,
  padded = true,
) {
  const column = String(columnIndex + 1);
  const renderedColumn = padded && plateType === 96 ? column.padStart(2, "0") : column;
  return `${rowLabel(rowIndex)}${renderedColumn}`;
}

export function buildReactionSets(input: Pick<PlanInput, "assayMode" | "targets" | "reference">) {
  if (input.assayMode === "multiplex") {
    return [
      {
        id: "multiplex-panel",
        name: `${input.targets.map((target) => target.name).join(" + ")} + ${input.reference.name}`,
        targets: input.targets,
        reference: input.reference,
      },
    ] satisfies ReactionSet[];
  }

  return input.targets.map((target) => ({
    id: `duplex-${target.id}`,
    name: `${target.name} + ${input.reference.name}`,
    targets: [target],
    reference: input.reference,
  }));
}

export function findDuplicateReporters(
  input: Pick<PlanInput, "assayMode" | "targets" | "reference">,
) {
  if (input.assayMode !== "multiplex") return new Set<string>();
  const counts = new Map<string, number>();
  for (const reporter of [...input.targets.map((target) => target.reporter), input.reference.reporter]) {
    const key = reporter.trim().toLocaleUpperCase();
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([reporter]) => reporter));
}

function createEmptyPlate(plateNumber: number, plateType: PlateType): PlannerPlate {
  const { rows, columns } = getPlateDimensions(plateType);
  const wells: PlannerWell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      wells.push({
        id: formatWellId(row, column, plateType),
        row,
        column,
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
    }
  }
  return { plateNumber, name: `Plate ${plateNumber}`, wells };
}

function loadingRowPasses(input: Pick<PlanInput, "plateType" | "loadingPattern">) {
  const { rows } = getPlateDimensions(input.plateType);
  if (input.plateType === 384 && input.loadingPattern === "interleaved-8-channel") {
    return [
      INTERLEAVED_384_ROW_ORDER.slice(0, 8),
      INTERLEAVED_384_ROW_ORDER.slice(8),
    ];
  }
  return [Array.from({ length: rows }, (_, index) => index)];
}

function orderedUnits(
  samples: SampleInput[],
  reactionSets: ReactionSet[],
  preset: LayoutPreset,
) {
  const units: Unit[] = [];
  if (preset === "assay-major") {
    for (const reactionSet of reactionSets) {
      for (const sample of samples) units.push({ sample, reactionSet });
    }
  } else {
    for (const sample of samples) {
      for (const reactionSet of reactionSets) units.push({ sample, reactionSet });
    }
  }
  return units;
}

function assignUnit(
  plate: PlannerPlate,
  unit: Unit,
  replicates: number,
  row: number,
  startColumn: number,
) {
  for (let replicate = 1; replicate <= replicates; replicate += 1) {
    const well = plate.wells.find(
      (candidate) => candidate.row === row && candidate.column === startColumn + replicate - 1,
    );
    if (!well) throw new Error("Internal plate allocation error.");
    Object.assign(well, {
      sampleId: unit.sample.id,
      sample: unit.sample.name,
      sampleType: unit.sample.type,
      reactionSetId: unit.reactionSet.id,
      reactionSet: unit.reactionSet.name,
      replicate,
      targets: unit.reactionSet.targets.map((target) => target.name),
      reference: unit.reactionSet.reference.name,
      source: "planned" as const,
    });
  }
}

class PlateCursor {
  private slotPointer = 0;

  constructor(
    private readonly rowPasses: number[][],
    private readonly columns: number,
  ) {}

  next(replicates: number) {
    if (replicates > this.columns) return null;
    const columnBlocks = Math.floor(this.columns / replicates);
    let slotWithinPasses = this.slotPointer;
    for (const rows of this.rowPasses) {
      const passCapacity = rows.length * columnBlocks;
      if (slotWithinPasses < passCapacity) {
        const rowIndex = slotWithinPasses % rows.length;
        const columnBlock = Math.floor(slotWithinPasses / rows.length);
        this.slotPointer += 1;
        return {
          row: rows[rowIndex],
          column: columnBlock * replicates,
        };
      }
      slotWithinPasses -= passCapacity;
    }
    return null;
  }
}

function ensureValidInput(input: PlanInput) {
  if (input.samples.length === 0) throw new Error("至少需要 1 个样本或对照。 / Add at least one sample or control.");
  if (input.targets.length === 0) throw new Error("至少需要 1 个 CNV target assay。 / Add at least one target assay.");
  if (!input.reference.name.trim()) throw new Error("请填写参考 assay。 / Enter a reference assay.");
  if (!Number.isInteger(input.replicates) || input.replicates < 1 || input.replicates > 8) {
    throw new Error("复孔数必须为 1–8。 / Replicates must be 1–8.");
  }
  const sampleNames = input.samples.map((sample) => sample.name.trim().toLocaleLowerCase());
  if (new Set(sampleNames).size !== sampleNames.length) {
    throw new Error("样本名称不可重复。 / Sample names must be unique.");
  }
  const targetNames = input.targets.map((target) => target.name.trim().toLocaleLowerCase());
  if (new Set(targetNames).size !== targetNames.length) {
    throw new Error("Target assay 名称不可重复。 / Target assay names must be unique.");
  }
  if (input.assayMode === "multiplex") {
    if (findDuplicateReporters(input).size > 0) {
      throw new Error("Multiplex 同孔 reporter 必须可区分。 / Multiplex reporters must be distinct.");
    }
  }
}

export function planCnvLayout(input: PlanInput): PlanResult {
  ensureValidInput(input);
  const reactionSets = buildReactionSets(input);
  const controls = input.samples.filter((sample) => sample.type !== "unknown");
  const unknowns = input.samples.filter((sample) => sample.type === "unknown");
  const controlUnits = orderedUnits(controls, reactionSets, input.layoutPreset);
  const unknownUnits = orderedUnits(unknowns, reactionSets, input.layoutPreset);
  const rowPasses = loadingRowPasses(input);
  const { columns } = getPlateDimensions(input.plateType);
  const plates: PlannerPlate[] = [];
  let unknownIndex = 0;

  do {
    const plate = createEmptyPlate(plates.length + 1, input.plateType);
    const cursor = new PlateCursor(rowPasses, columns);

    for (const unit of controlUnits) {
      const slot = cursor.next(input.replicates);
      if (!slot) {
        throw new Error("每板对照占用空间超过板容量，请减少对照/复孔数。 / Per-plate controls exceed capacity.");
      }
      assignUnit(plate, unit, input.replicates, slot.row, slot.column);
    }

    while (unknownIndex < unknownUnits.length) {
      const slot = cursor.next(input.replicates);
      if (!slot) break;
      assignUnit(plate, unknownUnits[unknownIndex], input.replicates, slot.row, slot.column);
      unknownIndex += 1;
    }

    plates.push(plate);
    if (plates.length > 99) throw new Error("排板超过 99 块板，请拆分实验。 / More than 99 plates required.");
  } while (unknownIndex < unknownUnits.length);

  return refreshPlan({ input, reactionSets, plates, occupiedWells: 0, manualWells: 0 });
}

export function refreshPlan(plan: PlanResult): PlanResult {
  const occupiedWells = plan.plates.reduce(
    (total, plate) => total + plate.wells.filter((well) => well.sample).length,
    0,
  );
  const manualWells = plan.plates.reduce(
    (total, plate) => total + plate.wells.filter((well) => well.source === "manual").length,
    0,
  );
  return { ...plan, occupiedWells, manualWells };
}

export function validatePlan(plan: PlanResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const expectedReplicates = plan.input.replicates;
  const controls = plan.input.samples.filter((sample) => sample.type !== "unknown");
  const unknowns = plan.input.samples.filter((sample) => sample.type === "unknown");

  for (const plate of plan.plates) {
    const occupied = plate.wells.filter((well) => well.sample);
    const keys = new Set<string>();
    for (const well of occupied) {
      const key = `${well.sampleId}|${well.reactionSetId}|${well.replicate}`;
      if (keys.has(key)) {
        issues.push({
          severity: "error",
          code: "duplicate-replicate",
          message: `${well.sample} / ${well.reactionSet} 出现重复复孔编号。`,
          plateNumber: plate.plateNumber,
          wellId: well.id,
        });
      }
      keys.add(key);
    }

    for (const control of controls) {
      for (const reactionSet of plan.reactionSets) {
        const wells = occupied.filter(
          (well) => well.sampleId === control.id && well.reactionSetId === reactionSet.id,
        );
        if (wells.length !== expectedReplicates) {
          issues.push({
            severity: "error",
            code: "missing-control",
            message: `${control.name} / ${reactionSet.name} 在本板应有 ${expectedReplicates} 孔，实际 ${wells.length} 孔。`,
            plateNumber: plate.plateNumber,
          });
        }
      }
    }
  }

  for (const sample of unknowns) {
    for (const reactionSet of plan.reactionSets) {
      const wells = plan.plates.flatMap((plate) =>
        plate.wells.filter(
          (well) => well.sampleId === sample.id && well.reactionSetId === reactionSet.id,
        ),
      );
      if (wells.length !== expectedReplicates) {
        issues.push({
          severity: "error",
          code: "unknown-replicate-count",
          message: `${sample.name} / ${reactionSet.name} 应有 ${expectedReplicates} 孔，实际 ${wells.length} 孔。`,
        });
      }
    }
  }

  if (!controls.some((sample) => sample.type === "calibrator")) {
    issues.push({
      severity: "warning",
      code: "no-calibrator",
      message: "未设置已知拷贝数校准样本；无法完成标准 ΔΔCt CN 计算。",
    });
  }
  if (!controls.some((sample) => sample.type === "ntc")) {
    issues.push({
      severity: "warning",
      code: "no-ntc",
      message: "未设置 NTC；污染/背景质控不完整。",
    });
  }
  if (expectedReplicates < 4) {
    issues.push({
      severity: "warning",
      code: "replicate-recommendation",
      message: "官方 TaqMan CNV 指南建议每个 gDNA 样本 4 个复孔以获得更可靠的 copy-number call。",
    });
  }
  if (plan.manualWells > 0) {
    issues.push({
      severity: "warning",
      code: "manual-layout",
      message: `存在 ${plan.manualWells} 个手工编辑孔；导出前需人工复核复孔完整性、同板对照和仪器样本列表。`,
    });
  }
  return issues;
}

export function sampleTypeLabel(type: SampleType) {
  const labels: Record<SampleType, string> = {
    unknown: "Unknown",
    calibrator: "Calibrator",
    ntc: "NTC",
    "qc-0": "0-copy QC",
    "qc-1": "1-copy QC",
    "qc-2": "2-copy QC",
  };
  return labels[type];
}
