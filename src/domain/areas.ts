/**
 * Review areas group return lines for sign-offs, budgets and the issue queue.
 * The grouping follows the firm's budget areas where one exists, with a few
 * line-level overrides so equity-compensation lots and K-1 lines land where a
 * reviewer expects them.
 */

export interface Area {
  id: string;
  label: string;
  budgetKey?: string;
  description: string;
}

export const AREAS: Area[] = [
  { id: "intake_and_engagement", label: "Intake and engagement", budgetKey: "intake_and_engagement", description: "Engagement letter, consents, identity, questionnaire." },
  { id: "wages_and_stock_compensation", label: "Wages and stock compensation", budgetKey: "wages_and_stock_compensation", description: "W-2 wages, withholding, RSU, ESPP and ISO lots." },
  { id: "investments_and_digital_assets", label: "Investments and digital assets", budgetKey: "investments_and_digital_assets", description: "Interest, dividends, brokerage sales, crypto, foreign account." },
  { id: "business", label: "Business (Schedule C)", budgetKey: "business", description: "Lindqvist Studio books to tax, SE tax, SEP, health insurance, QBI." },
  { id: "rentals_and_sale", label: "Rentals and property sale", budgetKey: "rentals_and_sale", description: "Schedule E properties, depreciation, passive losses, the condo sale." },
  { id: "pass_throughs_and_basis", label: "Pass-throughs and basis", budgetKey: "pass_throughs_and_basis", description: "K-1 items, S corporation stock basis, partnership capital." },
  { id: "deductions_and_credits", label: "Deductions and credits", budgetKey: "deductions_and_credits", description: "Itemized deductions, charitable gifts, education, child and dependent care, IRA, HSA, due diligence." },
  { id: "tax_computation_and_payments", label: "Tax computation and payments", description: "Form 1040 totals, AMT, other taxes, estimated payments, penalties." },
  { id: "california", label: "California", budgetKey: "california", description: "Part-year residency split, Schedule CA, Form 540NR, FTB payments." },
  { id: "partner_review", label: "Partner review", budgetKey: "partner_review", description: "Material judgments and the filing decision." },
];

const FORM_AREA: Record<string, string> = {
  SchB: "investments_and_digital_assets",
  SchD: "investments_and_digital_assets",
  F8949: "investments_and_digital_assets",
  F8938: "investments_and_digital_assets",
  SchC: "business",
  SchSE: "business",
  "F4562-C": "business",
  F8995: "business",
  F8995A: "business",
  SchE: "rentals_and_sale",
  F4797: "rentals_and_sale",
  "F4562-E": "rentals_and_sale",
  F8582: "rentals_and_sale",
  FTB3885A: "rentals_and_sale",
  F7203: "pass_throughs_and_basis",
  SchA: "deductions_and_credits",
  F8283: "deductions_and_credits",
  F8863: "deductions_and_credits",
  F2441: "deductions_and_credits",
  F8812: "deductions_and_credits",
  F8889: "deductions_and_credits",
  F8606: "deductions_and_credits",
  F8867: "deductions_and_credits",
  SchCA540NR: "california",
  F540NR: "california",
  ScheduleS: "california",
  FTB5805: "california",
  F1040: "tax_computation_and_payments",
  Sch1: "tax_computation_and_payments",
  Sch2: "tax_computation_and_payments",
  Sch3: "tax_computation_and_payments",
  F6251: "tax_computation_and_payments",
  F8959: "tax_computation_and_payments",
  F8960: "tax_computation_and_payments",
  F2210: "tax_computation_and_payments",
};

export function areaForLine(key: string, form: string): string {
  // Equity-compensation lots are tagged N* in the packet (Corvane RSU/ESPP/ISO).
  if (form === "F8949" && /\.N\d+$/.test(key)) return "wages_and_stock_compensation";
  if (form === "F1040" && /^F1040\.1[a-z]?$/.test(key)) return "wages_and_stock_compensation";
  if (form === "F1040" && /^F1040\.25[a-d]?$/.test(key)) return "wages_and_stock_compensation";
  if (form === "F6251" && key === "F6251.2i") return "wages_and_stock_compensation";
  if (form === "SchE" && /^SchE\.28/.test(key)) return "pass_throughs_and_basis";
  if (form === "Sch1" && /^Sch1\.(15|16|17)$/.test(key)) return "business";
  return FORM_AREA[form] ?? "tax_computation_and_payments";
}

export function areaLabel(id: string): string {
  return AREAS.find((a) => a.id === id)?.label ?? id;
}

const DOCUMENT_TYPE_AREA: Record<string, string> = {
  engagement_letter: "intake_and_engagement",
  consent_7216: "intake_and_engagement",
  irs_ip_pin_notice: "intake_and_engagement",
  identity_document: "intake_and_engagement",
  prior_year_return: "intake_and_engagement",
  prior_workpaper: "intake_and_engagement",
  "W-2": "wages_and_stock_compensation",
  stock_plan_supplement: "wages_and_stock_compensation",
  "3921": "wages_and_stock_compensation",
  "3922": "wages_and_stock_compensation",
  paystub: "california",
  books_profit_loss: "business",
  books_transaction_detail: "business",
  "1099-NEC": "business",
  "1099-K": "business",
  invoice: "business",
  mileage_log: "business",
  client_note: "business",
  insurance_statement: "business",
  retirement_contribution: "business",
  books_report: "business",
  "1099-composite": "investments_and_digital_assets",
  "1099-INT": "investments_and_digital_assets",
  "1099-DA": "investments_and_digital_assets",
  transaction_export: "investments_and_digital_assets",
  foreign_bank_statement: "investments_and_digital_assets",
  "K-1-1065": "pass_throughs_and_basis",
  "K-1-state-supplement": "pass_throughs_and_basis",
  "K-1-1120S": "pass_throughs_and_basis",
  "1099-R": "deductions_and_credits",
  "5498": "deductions_and_credits",
  "1099-SA": "deductions_and_credits",
  "5498-SA": "deductions_and_credits",
  rental_owner_statement: "rentals_and_sale",
  rental_ledger: "rentals_and_sale",
  closing_statement_seller: "rentals_and_sale",
  "1099-S": "rentals_and_sale",
  "1098": "deductions_and_credits",
  property_tax_bill: "rentals_and_sale",
  closing_statement_buyer: "deductions_and_credits",
  payoff_statement: "deductions_and_credits",
  property_tax_receipt: "deductions_and_credits",
  "1098-T": "deductions_and_credits",
  letter: "deductions_and_credits",
  dependent_care_statement: "deductions_and_credits",
  donation_receipt: "deductions_and_credits",
  "1098-C": "deductions_and_credits",
  payment_confirmation: "tax_computation_and_payments",
  irs_transcript: "tax_computation_and_payments",
  irs_notice: "tax_computation_and_payments",
};

export function areaForDocument(documentType: string, issuer: string): string {
  if (documentType === "invoice" && /heating|air/i.test(issuer)) return "rentals_and_sale";
  if (documentType === "1098" && /fremont|golden bear/i.test(issuer)) return "rentals_and_sale";
  return DOCUMENT_TYPE_AREA[documentType] ?? "intake_and_engagement";
}
