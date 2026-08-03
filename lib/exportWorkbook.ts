import type { PlanResult, PlannerPlate, PlannerWell } from "./cnvPlanner";
import { formatWellId, getPlateDimensions, rowLabel, sampleTypeLabel } from "./cnvPlanner";
import {
  calculateReactionRequirements,
  type ReactionSystem,
} from "./reactionCalculator";

type XLSXModule = typeof import("xlsx-js-style");

const COLORS = {
  ink: "253145",
  blue: "3D4A63",
  blueSoft: "E9EDF3",
  teal: "176B75",
  tealSoft: "DCEBE8",
  amber: "9C6424",
  amberSoft: "F9EEDF",
  border: "D7DCE3",
  white: "FFFFFF",
  canvas: "F7F6F2",
  empty: "F3F4F6",
};

const HEADER_STYLE = {
  fill: { fgColor: { rgb: COLORS.blue } },
  font: { bold: true, color: { rgb: COLORS.white } },
  alignment: { horizontal: "center", vertical: "center" },
  border: {
    top: { style: "thin", color: { rgb: COLORS.border } },
    bottom: { style: "thin", color: { rgb: COLORS.border } },
    left: { style: "thin", color: { rgb: COLORS.border } },
    right: { style: "thin", color: { rgb: COLORS.border } },
  },
};

const CELL_BORDER = {
  top: { style: "thin", color: { rgb: COLORS.border } },
  bottom: { style: "thin", color: { rgb: COLORS.border } },
  left: { style: "thin", color: { rgb: COLORS.border } },
  right: { style: "thin", color: { rgb: COLORS.border } },
};

function safeDateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 40);
}

function targetFill(index: number) {
  return ["DDE8F2", "DCEBE8", "E4E2EF", "F3DFC4", "E1E9E3", "E3E5EC"][index % 6];
}

function applyHeader(XLSX: XLSXModule, sheet: import("xlsx-js-style").WorkSheet, range: string) {
  const decoded = XLSX.utils.decode_range(range);
  for (let row = decoded.s.r; row <= decoded.e.r; row += 1) {
    for (let column = decoded.s.c; column <= decoded.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      if (sheet[address]) sheet[address].s = HEADER_STYLE;
    }
  }
}

function addReadmeSheet(XLSX: XLSXModule, workbook: import("xlsx-js-style").WorkBook, plan: PlanResult) {
  const rows = [
    ["TaqMan CNV Analysis 板布局规划工具 — 导出说明"],
    ["用途", "科研用途（RUO）；用于板布局、加样计划和仪器样本名称粘贴，不替代实验室方法学验证或 CopyCaller 判读。"],
    ["板型", `${plan.input.plateType}-well`],
    ["检测模式", plan.input.assayMode === "multiplex" ? "Multiplex：多个 target + reference 同孔" : "Duplex：每个 target 分别与 reference 同孔"],
    ["复孔", plan.input.replicates],
    ["仪器列表（含表头）", "复制对应 Paste_QS_Pxx 工作表的 Well 与 Sample 两列（包括表头），在 QuantStudio Well Table 第一条样本行右键，选择 Paste 或 Paste only samples。"],
    ["仪器列表（无表头）", "旧版 SDS/7300/7500/StepOnePlus 软件可使用对应 Paste_Legacy_Pxx 工作表；是否包含表头以本机软件版本和已验证模板为准。"],
    ["孔名格式", plan.input.plateType === 96 ? "A01–H12（与用户提供 PCR-96-new.xlsx 一致）" : "A1–P24（与用户提供 PCR-384.xlsx 一致）"],
    ["重要复核", "任何手工编辑孔、multiplex reporter 组合、板型/block、光谱校准、assay ID/浓度/quencher 均需由技术人员在上机前复核。"],
    ["官方 CNV 指南", "https://assets.thermofisher.com/TFS-Assets/LSG/manuals/4397425_CopyNumAssays_UG.pdf"],
    ["QuantStudio 软件指南", "https://documents.thermofisher.com/TFS-Assets/LSG/manuals/MAN0010408_QuantStudioDesign_Analysis_Desktop_Software_UG.pdf"],
    ["Multiplex 优化指南", "https://www.thermofisher.com/TFS-Assets/LSG/manuals/taqman_optimization_man.pdf"],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 26 }, { wch: 110 }];
  sheet["!rows"] = [{ hpt: 28 }];
  sheet["A1"].s = { fill: { fgColor: { rgb: COLORS.blue } }, font: { bold: true, color: { rgb: COLORS.white }, sz: 16 } };
  for (let row = 1; row < rows.length; row += 1) {
    const label = `A${row + 1}`;
    const value = `B${row + 1}`;
    sheet[label].s = { font: { bold: true, color: { rgb: COLORS.ink } }, fill: { fgColor: { rgb: COLORS.blueSoft } }, border: CELL_BORDER, alignment: { vertical: "top", wrapText: true } };
    sheet[value].s = { border: CELL_BORDER, alignment: { vertical: "top", wrapText: true } };
  }
  sheet["!merges"] = [XLSX.utils.decode_range("A1:B1")];
  XLSX.utils.book_append_sheet(workbook, sheet, "README");
}

function addSummarySheet(
  XLSX: XLSXModule,
  workbook: import("xlsx-js-style").WorkBook,
  plan: PlanResult,
  system: ReactionSystem,
) {
  const rows: (string | number)[][] = [
    ["运行摘要 / Run summary", ""],
    ["板数 / Plates", plan.plates.length],
    ["板型 / Plate format", `${plan.input.plateType}-well`],
    ["模式 / Mode", plan.input.assayMode],
    ["样本与对照 / Samples + controls", plan.input.samples.length],
    ["Target assays", plan.input.targets.length],
    ["Reference assay", `${plan.input.reference.name} / ${plan.input.reference.reporter}`],
    ["复孔 / Replicates", plan.input.replicates],
    ["占用孔 / Occupied wells", plan.occupiedWells],
    ["手工编辑孔 / Manual wells", plan.manualWells],
    ["每孔总体积 / Total per well (µL)", system.totalPerWellUl],
    ["模板 / Template per well (µL)", system.templatePerWellUl],
    ["配液余量 / Overage (%)", system.overagePercent],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 36 }, { wch: 52 }];
  sheet["!merges"] = [XLSX.utils.decode_range("A1:B1")];
  sheet["A1"].s = { fill: { fgColor: { rgb: COLORS.blue } }, font: { bold: true, color: { rgb: COLORS.white }, sz: 15 }, alignment: { horizontal: "center" } };
  for (let row = 1; row < rows.length; row += 1) {
    sheet[`A${row + 1}`].s = { font: { bold: true }, fill: { fgColor: { rgb: COLORS.blueSoft } }, border: CELL_BORDER };
    sheet[`B${row + 1}`].s = { border: CELL_BORDER };
  }
  XLSX.utils.book_append_sheet(workbook, sheet, "Run Summary");
}

function addPlateMapSheet(
  XLSX: XLSXModule,
  workbook: import("xlsx-js-style").WorkBook,
  plan: PlanResult,
  plate: PlannerPlate,
) {
  const { rows, columns } = getPlateDimensions(plan.input.plateType);
  const aoa: (string | number)[][] = [[plate.name, ...Array(columns).fill("")], ["", ...Array.from({ length: columns }, (_, index) => index + 1)]];
  for (let row = 0; row < rows; row += 1) {
    aoa.push([
      rowLabel(row),
      ...Array.from({ length: columns }, (_, column) => {
        const well = plate.wells.find((candidate) => candidate.row === row && candidate.column === column);
        return well?.sample ? `${well.sample}\n${well.reactionSet}\nR${well.replicate}` : "";
      }),
    ]);
  }
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet["!merges"] = [XLSX.utils.decode_range(`A1:${XLSX.utils.encode_col(columns)}1`)];
  sheet["!cols"] = [{ wch: 5 }, ...Array.from({ length: columns }, () => ({ wch: plan.input.plateType === 96 ? 18 : 13 }))];
  sheet["!rows"] = [{ hpt: 27 }, { hpt: 22 }, ...Array.from({ length: rows }, () => ({ hpt: plan.input.plateType === 96 ? 51 : 42 }))];
  sheet["A1"].s = { fill: { fgColor: { rgb: COLORS.blue } }, font: { bold: true, color: { rgb: COLORS.white }, sz: 14 }, alignment: { horizontal: "center", vertical: "center" } };
  applyHeader(XLSX, sheet, `A2:${XLSX.utils.encode_col(columns)}2`);
  for (let row = 0; row < rows; row += 1) {
    const rowHeader = `A${row + 3}`;
    sheet[rowHeader].s = HEADER_STYLE;
    for (let column = 0; column < columns; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row + 2, c: column + 1 });
      const well = plate.wells.find((candidate) => candidate.row === row && candidate.column === column);
      const targetIndex = well?.targets[0]
        ? Math.max(0, plan.input.targets.findIndex((target) => target.name === well.targets[0]))
        : 0;
      sheet[address].s = {
        fill: { fgColor: { rgb: well?.sample ? targetFill(targetIndex) : COLORS.empty } },
        font: { color: { rgb: COLORS.ink }, sz: plan.input.plateType === 96 ? 9 : 7 },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: CELL_BORDER,
      };
    }
  }
  XLSX.utils.book_append_sheet(workbook, sheet, `Plate Map P${String(plate.plateNumber).padStart(2, "0")}`);
}

function reporterMapping(well: PlannerWell, plan: PlanResult) {
  if (!well.reactionSetId) return "";
  const set = plan.reactionSets.find((candidate) => candidate.id === well.reactionSetId);
  if (!set) return "";
  return [
    ...set.targets.map((target) => `${target.name}=${target.reporter}`),
    `${set.reference.name}=${set.reference.reporter}`,
  ].join("; ");
}

function addWellDetailSheet(
  XLSX: XLSXModule,
  workbook: import("xlsx-js-style").WorkBook,
  plan: PlanResult,
  plate: PlannerPlate,
) {
  const header = ["Well", "Sample", "Sample Type", "Reaction Set", "Replicate", "Target(s)", "Reference", "Reporter mapping", "Source"];
  const rows = plate.wells
    .filter((well) => well.sample)
    .map((well) => [well.id, well.sample, well.sampleType ? sampleTypeLabel(well.sampleType) : "", well.reactionSet, well.replicate ?? "", well.targets.join(" + "), well.reference, reporterMapping(well, plan), well.source]);
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  sheet["!cols"] = [{ wch: 9 }, { wch: 24 }, { wch: 18 }, { wch: 38 }, { wch: 11 }, { wch: 28 }, { wch: 20 }, { wch: 52 }, { wch: 12 }];
  sheet["!autofilter"] = { ref: `A1:I${rows.length + 1}` };
  sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  applyHeader(XLSX, sheet, "A1:I1");
  XLSX.utils.book_append_sheet(workbook, sheet, `Well Details P${String(plate.plateNumber).padStart(2, "0")}`);
}

function instrumentRows(plan: PlanResult, plate: PlannerPlate, includeHeader: boolean) {
  const rows: string[][] = includeHeader ? [["Well", "Sample"]] : [];
  for (const well of plate.wells) {
    rows.push([
      formatWellId(well.row, well.column, plan.input.plateType, true),
      well.sample || "",
    ]);
  }
  return rows;
}

function addInstrumentSheets(
  XLSX: XLSXModule,
  workbook: import("xlsx-js-style").WorkBook,
  plan: PlanResult,
  plate: PlannerPlate,
) {
  const number = String(plate.plateNumber).padStart(2, "0");
  const qsRows = instrumentRows(plan, plate, true);
  const qsSheet = XLSX.utils.aoa_to_sheet(qsRows);
  qsSheet["!cols"] = [{ wch: 12 }, { wch: 34 }];
  applyHeader(XLSX, qsSheet, "A1:B1");
  XLSX.utils.book_append_sheet(workbook, qsSheet, `Paste_QS_P${number}`);

  const legacySheet = XLSX.utils.aoa_to_sheet(instrumentRows(plan, plate, false));
  legacySheet["!cols"] = [{ wch: 12 }, { wch: 34 }];
  XLSX.utils.book_append_sheet(workbook, legacySheet, `Paste_Legacy_P${number}`);
}

function addAssaySheet(XLSX: XLSXModule, workbook: import("xlsx-js-style").WorkBook, plan: PlanResult) {
  const rows: (string | number)[][] = [
    ["Role", "Assay name", "Assay ID", "Reporter", "Per-well volume (µL)", "Mode note"],
    ...plan.input.targets.map((target) => ["Target", target.name, target.assayId, target.reporter, target.volumeUl, plan.input.assayMode === "multiplex" ? "Shares one well with all listed targets + reference" : "Separate duplex with reference"]),
    ["Reference", plan.input.reference.name, plan.input.reference.assayId, plan.input.reference.reporter, plan.input.reference.volumeUl, "Reference assumption and copy-number stability require validation"],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 13 }, { wch: 24 }, { wch: 24 }, { wch: 16 }, { wch: 22 }, { wch: 62 }];
  applyHeader(XLSX, sheet, "A1:F1");
  XLSX.utils.book_append_sheet(workbook, sheet, "Assay & Dyes");
}

function addReactionSheet(
  XLSX: XLSXModule,
  workbook: import("xlsx-js-style").WorkBook,
  plan: PlanResult,
  system: ReactionSystem,
) {
  const requirements = calculateReactionRequirements(plan, system);
  const rows: (string | number)[][] = [["反应体系与批量配液 / Reaction setup", "", "", "", ""]];
  for (const group of requirements.groups) {
    rows.push(
      ["Reaction set", group.reactionSet.name, "实际孔数", group.wells, ""],
      ["总反应体积 (µL)", system.totalPerWellUl, "公共反应液分装/孔 (µL)", group.mixDispensePerWellUl, ""],
      ["组分 / Component", "每孔 (µL)", `总量（含 ${system.overagePercent}% 余量）(µL)`, "Reporter/role", "备注"],
      ...group.components.map((component) => [component.name, component.perWellUl, component.totalUl, component.role, component.role === "water" ? "自动补足至总反应体积" : ""]),
      ["gDNA / NTC water", system.templatePerWellUl, "按样本分别准备", "template", "NTC 使用无核酸酶水替代模板"],
      ["", "", "", "", ""],
    );
  }
  rows.push(["样本模板需求 / Template requirement", "类型", "孔数", "每孔 (µL)", `最低准备量（含 ${system.overagePercent}%）(µL)`]);
  rows.push(...requirements.samples.map((sample) => [sample.sample, sample.sampleType, sample.wells, sample.templatePerWellUl, sample.requiredUl]));
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 52 }, { wch: 19 }, { wch: 31 }, { wch: 20 }, { wch: 48 }];
  sheet["!merges"] = [XLSX.utils.decode_range("A1:E1")];
  sheet["A1"].s = { fill: { fgColor: { rgb: COLORS.blue } }, font: { bold: true, color: { rgb: COLORS.white }, sz: 14 }, alignment: { horizontal: "center" } };
  for (let index = 1; index < rows.length; index += 1) {
    const first = rows[index][0];
    if (first === "组分 / Component" || first === "样本模板需求 / Template requirement") {
      applyHeader(XLSX, sheet, `A${index + 1}:E${index + 1}`);
    }
  }
  XLSX.utils.book_append_sheet(workbook, sheet, "Reaction Setup");
}

async function makeWorkbook(plan: PlanResult, system: ReactionSystem, plates: PlannerPlate[]) {
  const imported = await import("xlsx-js-style");
  // xlsx-js-style is CommonJS. Vite exposes its members directly while the
  // Node test runtime exposes them under `default`; normalize both shapes.
  const XLSX = (imported.default ?? imported) as unknown as XLSXModule;
  const workbook = XLSX.utils.book_new();
  addReadmeSheet(XLSX, workbook, plan);
  addSummarySheet(XLSX, workbook, { ...plan, plates }, system);
  for (const plate of plates) {
    addPlateMapSheet(XLSX, workbook, plan, plate);
    addWellDetailSheet(XLSX, workbook, plan, plate);
    addInstrumentSheets(XLSX, workbook, plan, plate);
  }
  addAssaySheet(XLSX, workbook, plan);
  addReactionSheet(XLSX, workbook, { ...plan, plates }, system);
  return { XLSX, workbook };
}

/**
 * Build the exact workbook payload used by the browser download flow.
 * Keeping this step document-independent lets automated tests verify the
 * technician-facing sheet names and instrument copy/paste cells.
 */
export async function buildWorkbookData(
  plan: PlanResult,
  system: ReactionSystem,
  plates: PlannerPlate[] = plan.plates,
) {
  const { XLSX, workbook } = await makeWorkbook(plan, system, plates);
  return XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function exportAllPlates(plan: PlanResult, system: ReactionSystem) {
  const data = await buildWorkbookData(plan, system, plan.plates);
  downloadBlob(
    new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `TaqMan_CNV_All_Plates_${plan.input.plateType}well_${safeDateStamp()}.xlsx`,
  );
}

export async function exportOnePlate(
  plan: PlanResult,
  plate: PlannerPlate,
  system: ReactionSystem,
) {
  const data = await buildWorkbookData(plan, system, [plate]);
  downloadBlob(
    new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `TaqMan_CNV_Plate_${String(plate.plateNumber).padStart(2, "0")}_${safeName(plate.name)}_${plan.input.plateType}well_${safeDateStamp()}.xlsx`,
  );
}

export function instrumentTsv(plan: PlanResult, plate: PlannerPlate, includeHeader = true) {
  return instrumentRows(plan, plate, includeHeader)
    .map((row) => row.join("\t"))
    .join("\n");
}
