import assert from "node:assert/strict";
import test from "node:test";
import XLSX from "xlsx-js-style";
import { planCnvLayout, type PlanInput } from "../lib/cnvPlanner";
import { buildWorkbookData } from "../lib/exportWorkbook";
import { DEFAULT_REACTION_SYSTEM } from "../lib/reactionCalculator";

const input: PlanInput = {
  plateType: 96,
  assayMode: "multiplex",
  samples: [
    { id: "u", name: "S001", type: "unknown" },
    { id: "cal", name: "CAL_2C", type: "calibrator" },
    { id: "ntc", name: "NTC", type: "ntc" },
  ],
  targets: [
    { id: "gstm1", name: "GSTM1", assayId: "A", reporter: "FAM", volumeUl: 0.5 },
    { id: "gstt1", name: "GSTT1", assayId: "B", reporter: "CY5", volumeUl: 0.5 },
  ],
  reference: { name: "RNase P", assayId: "R", reporter: "VIC", volumeUl: 0.5 },
  replicates: 4,
  layoutPreset: "sample-major",
  loadingPattern: "sequential",
};

test("exported workbook contains technician and instrument-ready sheets", async () => {
  const plan = planCnvLayout(input);
  const data = await buildWorkbookData(plan, DEFAULT_REACTION_SYSTEM);
  const workbook = XLSX.read(data, { type: "array" });

  assert.deepEqual(workbook.SheetNames, [
    "README",
    "Run Summary",
    "Plate Map P01",
    "Well Details P01",
    "Paste_QS_P01",
    "Paste_Legacy_P01",
    "Assay & Dyes",
    "Reaction Setup",
  ]);

  const qs = workbook.Sheets["Paste_QS_P01"];
  assert.equal(qs.A1.v, "Well");
  assert.equal(qs.B1.v, "Sample");
  assert.equal(qs.A2.v, "A01");
  assert.equal(qs.B2.v, plan.plates[0].wells[0].sample);
  assert.equal(qs.A97.v, "H12");

  const legacy = workbook.Sheets["Paste_Legacy_P01"];
  assert.equal(legacy.A1.v, "A01");
  assert.equal(legacy.B1.v, plan.plates[0].wells[0].sample);
  assert.equal(legacy.A96.v, "H12");
});
