import assert from "node:assert/strict";
import test from "node:test";
import {
  formatWellId,
  findDuplicateReporters,
  planCnvLayout,
  validatePlan,
  type PlanInput,
} from "../lib/cnvPlanner";

function baseInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    plateType: 96,
    assayMode: "multiplex",
    samples: [
      { id: "u1", name: "U1", type: "unknown" },
      { id: "u2", name: "U2", type: "unknown" },
      { id: "cal", name: "CAL", type: "calibrator" },
      { id: "ntc", name: "NTC", type: "ntc" },
    ],
    targets: [
      { id: "gstm1", name: "GSTM1", assayId: "A1", reporter: "FAM", volumeUl: 0.5 },
      { id: "gstt1", name: "GSTT1", assayId: "A2", reporter: "CY5", volumeUl: 0.5 },
    ],
    reference: { name: "RNase P", assayId: "R1", reporter: "VIC", volumeUl: 0.5 },
    replicates: 4,
    layoutPreset: "sample-major",
    loadingPattern: "sequential",
    ...overrides,
  };
}

test("multiplex puts all targets and reference in the same four wells", () => {
  const plan = planCnvLayout(baseInput());
  assert.equal(plan.reactionSets.length, 1);
  assert.equal(plan.occupiedWells, 16);
  const u1 = plan.plates.flatMap((plate) => plate.wells).filter((well) => well.sampleId === "u1");
  assert.equal(u1.length, 4);
  assert.deepEqual(u1.map((well) => well.targets), Array(4).fill(["GSTM1", "GSTT1"]));
  assert.ok(u1.every((well) => well.reference === "RNase P"));
});

test("duplex creates one target-reference reaction set per target", () => {
  const plan = planCnvLayout(baseInput({ assayMode: "duplex" }));
  assert.equal(plan.reactionSets.length, 2);
  assert.equal(plan.occupiedWells, 32);
  const u1 = plan.plates.flatMap((plate) => plate.wells).filter((well) => well.sampleId === "u1");
  assert.equal(u1.length, 8);
  assert.deepEqual(new Set(u1.map((well) => well.targets[0])), new Set(["GSTM1", "GSTT1"]));
});

test("replicate groups stay horizontally contiguous and do not cross a row", () => {
  const samples = [
    ...Array.from({ length: 22 }, (_, index) => ({ id: `u${index}`, name: `U${index}`, type: "unknown" as const })),
    { id: "cal", name: "CAL", type: "calibrator" as const },
    { id: "ntc", name: "NTC", type: "ntc" as const },
  ];
  const plan = planCnvLayout(baseInput({ samples, replicates: 4 }));
  for (const sample of samples) {
    const wells = plan.plates.flatMap((plate) => plate.wells).filter((well) => well.sampleId === sample.id);
    const byPlateSet = new Map<string, typeof wells>();
    for (const well of wells) {
      const key = `${well.reactionSetId}:${plan.plates.find((plate) => plate.wells.includes(well))?.plateNumber}`;
      byPlateSet.set(key, [...(byPlateSet.get(key) ?? []), well]);
    }
    for (const group of byPlateSet.values()) {
      assert.equal(new Set(group.map((well) => well.row)).size, 1);
      const columns = group.map((well) => well.column).sort((a, b) => a - b);
      assert.deepEqual(columns, Array.from({ length: columns.length }, (_, index) => columns[0] + index));
    }
  }
});

test("controls are repeated on every plate", () => {
  const samples = [
    ...Array.from({ length: 40 }, (_, index) => ({ id: `u${index}`, name: `U${index}`, type: "unknown" as const })),
    { id: "cal", name: "CAL", type: "calibrator" as const },
    { id: "ntc", name: "NTC", type: "ntc" as const },
  ];
  const plan = planCnvLayout(baseInput({ samples, assayMode: "duplex", replicates: 4 }));
  assert.ok(plan.plates.length > 1);
  for (const plate of plan.plates) {
    assert.equal(plate.wells.filter((well) => well.sampleId === "cal").length, 8);
    assert.equal(plate.wells.filter((well) => well.sampleId === "ntc").length, 8);
  }
  assert.equal(validatePlan(plan).filter((issue) => issue.severity === "error").length, 0);
});

test("384-well instrument IDs match the supplied template convention", () => {
  assert.equal(formatWellId(0, 0, 96), "A01");
  assert.equal(formatWellId(7, 11, 96), "H12");
  assert.equal(formatWellId(0, 0, 384), "A1");
  assert.equal(formatWellId(15, 23, 384), "P24");
});

test("multiplex rejects duplicate reporter channels", () => {
  assert.throws(
    () => planCnvLayout(baseInput({ reference: { name: "RNase P", assayId: "R", reporter: "FAM", volumeUl: 0.5 } })),
    /reporter/i,
  );
});

test("duplicate reporter detection is case-insensitive and only applies to multiplex wells", () => {
  const multiplex = baseInput({
    reference: { name: "RNase P", assayId: "", reporter: " fam ", volumeUl: 0.5 },
  });
  assert.deepEqual([...findDuplicateReporters(multiplex)], ["FAM"]);
  assert.equal(findDuplicateReporters({ ...multiplex, assayMode: "duplex" }).size, 0);
});

test("assay IDs may be blank", () => {
  const plan = planCnvLayout(baseInput({
    targets: [
      { id: "gstm1", name: "GSTM1", assayId: "", reporter: "FAM", volumeUl: 0.5 },
      { id: "gstt1", name: "GSTT1", assayId: "", reporter: "CY5", volumeUl: 0.5 },
    ],
    reference: { name: "RNase P", assayId: "", reporter: "VIC", volumeUl: 0.5 },
  }));
  assert.equal(plan.occupiedWells, 16);
});
