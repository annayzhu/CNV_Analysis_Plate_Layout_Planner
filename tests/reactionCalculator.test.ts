import assert from "node:assert/strict";
import test from "node:test";
import { planCnvLayout, type PlanInput } from "../lib/cnvPlanner";
import {
  calculateReactionRequirements,
  DEFAULT_REACTION_SYSTEM,
  reactionSetWaterPerWell,
  validateReactionSystem,
} from "../lib/reactionCalculator";

const input: PlanInput = {
  plateType: 96,
  assayMode: "multiplex",
  samples: [
    { id: "u", name: "U", type: "unknown" },
    { id: "cal", name: "CAL", type: "calibrator" },
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

test("default triplex system is exactly 10.0 µL with 1.5 µL water", () => {
  const plan = planCnvLayout(input);
  const set = plan.reactionSets[0];
  assert.equal(reactionSetWaterPerWell(set, DEFAULT_REACTION_SYSTEM), 1.5);
  const total =
    DEFAULT_REACTION_SYSTEM.masterMixPerWellUl +
    DEFAULT_REACTION_SYSTEM.templatePerWellUl +
    set.targets.reduce((sum, target) => sum + target.volumeUl, set.reference.volumeUl) +
    reactionSetWaterPerWell(set, DEFAULT_REACTION_SYSTEM);
  assert.equal(total, 10);
});

test("10% overage is applied to pooled reaction components", () => {
  const plan = planCnvLayout(input);
  const requirements = calculateReactionRequirements(plan, DEFAULT_REACTION_SYSTEM);
  assert.equal(requirements.groups[0].wells, 12);
  assert.equal(requirements.groups[0].preparationReactions, 13.2);
  const masterMix = requirements.groups[0].components.find((component) => component.role === "master-mix");
  assert.equal(masterMix?.totalUl, 66);
});

test("negative auto-water is rejected", () => {
  const plan = planCnvLayout(input);
  const errors = validateReactionSystem(plan, { ...DEFAULT_REACTION_SYSTEM, masterMixPerWellUl: 8 });
  assert.ok(errors.length > 0);
});
