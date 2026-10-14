/**
 * Books to tax: a signed reconciliation from the client's profit and loss
 * (D14) to Schedule C net profit, built from the packet's own links. Each
 * books line is matched to the return line that consumes it; differences are
 * itemized with their reason; tax-only deductions are subtracted; the result
 * is compared with the effective Schedule C profit so an unexplained gap is
 * visible instead of hidden.
 */
import type { EffectiveState } from "./effective";
import { numeric } from "./formulas";
import { indexPacket } from "@/packet/load";
import type { Packet, ReturnVersion } from "@/packet/types";
import { round2 } from "./effects";

export interface BridgeItem {
  kind: "start" | "income" | "add_back" | "difference" | "tax_only" | "result";
  label: string;
  amount: number; // signed effect on profit
  booksAmount?: number;
  taxAmount?: number;
  lineKey?: string;
  evidenceRefs: string[];
  explanation: string;
  status?: "baseline" | "adjusted" | "recomputed" | "stale";
}

export interface Bridge {
  booksDocument: string;
  items: BridgeItem[];
  computedProfit: number;
  effectiveProfit: number | null;
  profitStatus: string;
  unexplained: number;
  agrees: boolean;
}

const BOOKS_DOC = "D14";

export function buildBridge(packet: Packet, version: ReturnVersion, effective: EffectiveState): Bridge {
  const idx = indexPacket(packet);
  const lines = idx.linesByVersion.get(version.version)!;
  const booksValues = packet.extracted_values.filter((e) => e.document_id === BOOKS_DOC && e.page === 1);
  const eff = (key: string) => numeric(effective.lines.get(key)?.effective) ?? numeric(lines.get(key)?.value) ?? 0;
  const status = (key: string) => effective.lines.get(key)?.status;
  const consumersOf = (evId: string) => [...lines.values()].filter((l) => l.sources.includes(evId));

  const items: BridgeItem[] = [];
  const netIncome = booksValues.find((e) => e.field === "net_income");
  const totalIncome = booksValues.find((e) => e.field === "total_income");
  const start = numeric(netIncome?.value) ?? 0;
  items.push({ kind: "start", label: "Books net income (cash basis P&L)", amount: start, evidenceRefs: netIncome ? [netIncome.id] : [], explanation: "Starting point: the client's QuickBooks profit and loss." });

  // Income: receipts the return reports beyond (or below) the books.
  const booksIncome = numeric(totalIncome?.value) ?? 0;
  const receipts = eff("SchC.1");
  const incomeDiff = round2(receipts - booksIncome);
  items.push({
    kind: "income",
    label: incomeDiff >= 0 ? "Receipts on the return not in books total income" : "Receipts on the return below books total income",
    amount: incomeDiff,
    booksAmount: booksIncome,
    taxAmount: receipts,
    lineKey: "SchC.1",
    evidenceRefs: totalIncome ? [totalIncome.id, "SchC.1"] : ["SchC.1"],
    explanation: lines.get("SchC.1")?.note ?? "Gross receipts per the return compared with books total income.",
    status: status("SchC.1"),
  });

  // Each books expense line: matched to the return line that consumes it.
  // Lines that combine several books lines (telephone and internet) are
  // reconciled once, as one row, against the sum of their books amounts.
  const expenseValues = booksValues.filter((e) => !["total_income", "total_expenses", "net_income"].includes(e.field) && !/^Sales/.test(e.field));
  const consumedSchC = new Map<string, typeof expenseValues>();
  const unconsumed: typeof expenseValues = [];
  for (const ev of expenseValues) {
    const schc = consumersOf(ev.id).find((l) => l.form === "SchC" && /^SchC\.(8|9|1\d|2[0-7][a-z]?(\.\d+)?)$/.test(l.key));
    if (schc) {
      const list = consumedSchC.get(schc.key) ?? [];
      list.push(ev);
      consumedSchC.set(schc.key, list);
    } else {
      unconsumed.push(ev);
    }
  }
  for (const [key, evs] of consumedSchC) {
    const line = lines.get(key)!;
    const books = round2(evs.reduce((sum, e) => sum + (numeric(e.value) ?? 0), 0));
    const tax = eff(key);
    const diff = round2(books - tax);
    if (Math.abs(diff) < 0.005) continue;
    const label = evs.map((e) => e.label).join(" and ");
    items.push({
      kind: "difference",
      label: `${label}: books ${books.toLocaleString("en-US")} vs return ${tax.toLocaleString("en-US")}`,
      amount: diff,
      booksAmount: books,
      taxAmount: tax,
      lineKey: key,
      evidenceRefs: [...evs.map((e) => e.id), key],
      explanation:
        line.rule === "R-MEALS-50"
          ? "Business meals are deductible at 50%; the other half is added back."
          : `Return line ${key} carries ${diff > 0 ? "less" : "more"} than the books amount; the difference ${diff > 0 ? "increases" : "reduces"} profit.`,
      status: status(key),
    });
  }
  for (const ev of unconsumed) {
    const books = numeric(ev.value) ?? 0;
    // Not deducted on Schedule C: assessed elsewhere, replaced by a tax method, or unexplained.
    const consumer = consumersOf(ev.id)[0];
    const stem = ev.label.split(" - ")[0].toLowerCase().replace("car and truck", "fuel");
    const replacedBy = [...lines.values()].find((l) => l.form === "SchC" && l.note && l.note.toLowerCase().includes(stem));
    const tokens = ev.label.replace(/\(.*?\)/g, "").toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 5);
    const byLabel = tokens.length
      ? [...lines.values()].find((l) => l.form !== "SchC" && tokens.every((w) => l.label.toLowerCase().includes(w)))
      : undefined;
    const target = consumer ?? replacedBy ?? byLabel;
    items.push({
      kind: "add_back",
      label: `Books ${ev.label.toLowerCase()} not deducted on Schedule C`,
      amount: books,
      booksAmount: books,
      taxAmount: 0,
      lineKey: target?.key,
      evidenceRefs: [ev.id, ...(target ? [target.key] : [])],
      explanation: consumer
        ? `Assessed separately on ${consumer.key} (${consumer.label}).`
        : replacedBy
          ? `Replaced on the return by ${replacedBy.key}: ${replacedBy.note}`
          : byLabel
            ? `Assessed separately on ${byLabel.key} (${byLabel.label}).`
            : "No return line uses this books amount; it is added back and needs a reviewer disposition.",
    });
  }

  // Tax-only deductions: Schedule C expense lines with no books source.
  for (const l of lines.values()) {
    if (l.form !== "SchC" || !/^SchC\.(8|9|1\d|2[0-7][a-z]?(\.\d+)?|30)$/.test(l.key)) continue;
    if (consumedSchC.has(l.key)) continue;
    const hasBooksSource = l.sources.some((s) => booksValues.some((b) => b.id === s));
    if (hasBooksSource) continue;
    const amount = eff(l.key);
    items.push({
      kind: "tax_only",
      label: l.label,
      amount: -amount,
      taxAmount: amount,
      lineKey: l.key,
      evidenceRefs: [l.key, ...l.sources],
      explanation: l.note ?? `Tax-only deduction computed by rule ${l.rule}.`,
      status: status(l.key),
    });
  }

  const computedProfit = round2(items.reduce((sum, i) => sum + i.amount, 0));
  const effectiveProfit = numeric(effective.lines.get("SchC.31")?.effective);
  const profitStatus = status("SchC.31") ?? "baseline";
  const unexplained = effectiveProfit === null ? computedProfit : round2(effectiveProfit - computedProfit);
  items.push({
    kind: "result",
    label: "Schedule C net profit per this bridge",
    amount: computedProfit,
    lineKey: "SchC.31",
    evidenceRefs: ["SchC.31"],
    explanation:
      effectiveProfit === null
        ? "No effective Schedule C profit available."
        : Math.abs(unexplained) < 0.005
          ? `Agrees with the effective SchC.31 (${profitStatus}).`
          : `Differs from the effective SchC.31 by ${unexplained.toLocaleString("en-US")}; the difference is unexplained and needs review.`,
    status: effective.lines.get("SchC.31")?.status,
  });
  return {
    booksDocument: BOOKS_DOC,
    items,
    computedProfit,
    effectiveProfit,
    profitStatus,
    unexplained,
    agrees: Math.abs(unexplained) < 0.005,
  };
}
