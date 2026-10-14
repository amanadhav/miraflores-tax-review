import { describe, expect, it } from "vitest";
import { buildBridge } from "@/domain/bridge";
import { buildVariance } from "@/domain/variance";
import { computeEffective } from "@/domain/effective";
import { indexPacket } from "@/packet/load";
import { fixturePacket } from "./helpers/db";

const loaded = fixturePacket();
const packet = loaded.packet;
const v3 = indexPacket(packet).versions.get("v3")!;
const params = packet.engine_reference.parameters;

describe("books to tax bridge", () => {
  it("reconciles books net income to the engine's Schedule C profit at baseline", () => {
    const effective = computeEffective(v3, params, []);
    const bridge = buildBridge(packet, v3, effective);
    expect(bridge.items[0].amount).toBe(89834);
    expect(bridge.computedProfit).toBe(81854);
    expect(bridge.effectiveProfit).toBe(81854);
    expect(bridge.agrees).toBe(true);
    const labels = bridge.items.map((i) => i.label);
    expect(labels.some((l) => /health/i.test(l))).toBe(true);
    expect(bridge.items.find((i) => i.lineKey === "SchC.13" && i.kind === "tax_only")?.amount).toBe(-38000);
    expect(bridge.items.find((i) => i.kind === "income")?.amount).toBe(12400);
  });

  it("reconciles to 73,568 after the four Schedule C corrections", () => {
    const accepted = [
      { id: "a1", targetRef: "SchC.1", kind: "value", proposedValue: 151300 },
      { id: "a2", targetRef: "SchC.44a", kind: "value", proposedValue: 8100 },
      { id: "a3", targetRef: "SchC.25", kind: "value", proposedValue: 2172 },
      { id: "a4", targetRef: "SchC.27a.1", kind: "value", proposedValue: 6634 },
    ];
    const effective = computeEffective(v3, params, accepted);
    expect(effective.lines.get("SchC.9")!.effective).toBe(5670);
    expect(effective.lines.get("SchC.31")!.effective).toBe(73568);
    const bridge = buildBridge(packet, v3, effective);
    expect(bridge.computedProfit).toBe(73568);
    expect(bridge.agrees).toBe(true);
    expect(bridge.items.find((i) => i.kind === "income")?.amount).toBe(0);
    expect(bridge.items.find((i) => i.lineKey === "SchC.25")?.amount).toBe(1308);
    expect(bridge.items.find((i) => i.lineKey === "SchC.27a.1")?.amount).toBe(216);
  });
});

describe("prior-year variance", () => {
  it("applies the firm standard: over 10 percent and over 1,000, with zero prior handled explicitly", () => {
    const effective = computeEffective(v3, params, []);
    const report = buildVariance(packet, v3, effective, new Set(["F1040.1a"]));
    expect(report.thresholdPercent).toBe(10);
    expect(report.thresholdAmount).toBe(1000);
    const wages = report.compared.find((r) => r.key === "F1040.1a")!;
    expect(wages.prior).toBe(156039);
    expect(wages.current).toBe(212400);
    expect(wages.flagged).toBe(true);
    expect(wages.explained).toBe(true);
    const zeroPrior = report.compared.filter((r) => r.prior === 0 && r.flagged);
    for (const r of zeroPrior) {
      expect(r.percent).toBeNull();
      expect(Math.abs(r.delta ?? 0)).toBeGreaterThan(1000);
    }
    expect(report.onlyPrior.some((r) => r.key.startsWith("CA540."))).toBe(true);
    expect(report.compared.filter((r) => r.flagged).length).toBeGreaterThan(5);
  });
});
