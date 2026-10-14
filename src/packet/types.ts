/**
 * Types for the pipeline packet exactly as supplied. These describe the input;
 * they never add workpaper concepts (reviews, notes, sign-offs) to the packet.
 */

export type Jurisdiction = "federal" | "california";

export type ValueType =
  | "money"
  | "date"
  | "text"
  | "integer"
  | "quantity"
  | "percent"
  | "boolean"
  | "code"
  | "ssn"
  | "ein"
  | "account_number";

export interface PacketMeta {
  name: string;
  version: string;
  generated: string;
  client_id: string;
}

export interface Person {
  id: string;
  role: "taxpayer" | "spouse" | "dependent";
  name: string;
  ssn: string;
  dob: string;
  occupation?: string;
  relationship?: string;
  months_lived_with_you?: number;
  full_time_student?: boolean;
  note?: string;
  own_income?: string;
  ip_pin: string | null;
  phone?: string;
  email?: string;
}

export interface Household {
  filing_status: string;
  tax_year: number;
  entered_by: string;
  people: Person[];
  addresses: { from: string; to: string | null; address: string; type: string }[];
  residency: { state: string; from: string; to: string; status: string }[];
  bank_account_for_refund_or_payment: { routing: string; account: string; type: string; bank: string };
  prior_year_agi_for_esignature: number;
  related_returns: { who: string; return: string; prepared_by: string; in_this_packet: boolean | string }[];
}

export interface DocumentPage {
  page: number;
  printed_content: string;
}

export interface PacketDocument {
  id: string;
  title: string;
  document_type: string;
  issuer: string;
  belongs_to: string;
  tax_year: number;
  received_at: string;
  uploaded_by: "client" | "firm";
  file_name: string;
  page_count: number;
  pages: DocumentPage[];
  marked_corrected?: boolean;
  extraction: { status: "extracted" | "partial" | "not_extracted"; values: number; reason: string | null };
}

export interface ExtractedValue {
  id: string;
  document_id: string;
  page: number;
  field: string;
  label: string;
  value: unknown;
  value_type: ValueType;
  text_as_read: string;
  position: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

export interface QuestionnaireItem {
  id: string;
  question: string;
  answer: string;
  answered_by: string;
  answered_at: string;
}

export interface ClientMessage {
  id: string;
  sent_at: string;
  from: string;
  to: string;
  text: string;
}

export interface CallNote {
  id: string;
  date: string;
  participants: string[];
  notes: string[];
}

export type StaffRole =
  | "preparer"
  | "reviewer"
  | "partner"
  | "firm_administrator"
  | "quality_reviewer";

export interface Staff {
  id: string;
  name: string;
  role: StaffRole;
  credential: string | null;
  sensitive_data_clearance: boolean;
  active_from: string;
  note?: string;
}

export interface ClientUser {
  id: string;
  name: string;
  role: "client";
}

export interface StarterStandards {
  note: string;
  verification_types: string[];
  variance_review: { compare_to: string; flag_if_change_over_percent: number; and_over_amount: number };
  review_levels: string[];
  rules: string[];
  required_steps: string[];
}

export interface Firm {
  name: string;
  staff: Staff[];
  firm_identity: {
    ein: string;
    address: string;
    phone: string;
    efin: string;
    ero_pin: string;
    ptins: Record<string, string>;
    paid_preparer_signing_returns: string;
  };
  client_users: ClientUser[];
  assignment_at_start: { preparer: string; reviewer: string; partner: string };
  deadlines: { what: string; date: string }[];
  budget_hours: Record<string, number>;
  starter_standards: StarterStandards;
}

export interface ReturnLine {
  key: string;
  jurisdiction: Jurisdiction;
  form: string;
  line: string;
  label: string;
  value: number | string | boolean | null;
  rule: string;
  inputs: string[];
  sources: string[];
  note?: string;
}

export interface TaxEffectRate {
  federal_per_dollar: number;
  california_per_dollar: number;
}

export interface Diagnostic {
  code: string;
  severity: "info" | "warning";
  message: string;
  refs: string[];
}

export interface LineChange {
  key: string;
  change: "added" | "changed" | "removed";
  old?: unknown;
  new?: unknown;
}

export interface VersionAsset {
  asset_id: string;
  description: string;
  activity: string;
  cost: number;
  land_value_not_depreciated: number | null;
  placed_in_service: string;
  method: string;
  life_years: number;
  federal: { prior_accumulated: number; depreciation_2025: number; accumulated_end: number };
  california: { prior_accumulated: number; depreciation_2025: number; accumulated_end: number };
  amt: { depreciation_2025: number; difference_from_regular: number };
  disposed: string | null;
  disposition?: Record<string, unknown>;
  sources: string[];
}

export interface ReturnVersion {
  version: string;
  computed_at: string;
  trigger: string;
  documents_used: string[];
  documents_superseded: string[];
  summary: {
    federal: Record<string, number>;
    california: Record<string, number>;
  };
  tax_effect_rates: Record<string, TaxEffectRate>;
  carryovers_out: Record<string, unknown>;
  assets: VersionAsset[];
  diagnostics: Diagnostic[];
  changes_from_previous: LineChange[];
  lines: ReturnLine[];
}

export interface WhatIfAlternative {
  id: string;
  description: string;
  base_version: string;
  choices: Record<string, string>;
  federal: { base: Record<string, number>; alternative: Record<string, number>; total_tax_change: number; penalty_change: number };
  california: { base: Record<string, number>; alternative: Record<string, number>; total_tax_change: number };
  changed_lines: LineChange[];
}

export interface TimelineEvent {
  id: string;
  at: string;
  event: string;
  actor: string | null;
  detail: string | null;
  refs: string[];
}

export interface Packet {
  packet: PacketMeta;
  readme: Record<string, unknown>;
  household: Household;
  documents: PacketDocument[];
  extracted_values: ExtractedValue[];
  client: { questionnaire: QuestionnaireItem[]; messages: ClientMessage[]; call_notes: CallNote[] };
  firm: Firm;
  prior_years: Record<string, unknown>;
  tax_agency_records: Record<string, unknown>;
  timeline: TimelineEvent[];
  engine_reference: { parameters: Record<string, unknown>; rules: Record<string, string> };
  return_versions: ReturnVersion[];
  what_if: { alternatives: WhatIfAlternative[]; extension: Record<string, unknown> };
  planning_reference_2026: Record<string, unknown>;
  post_filing_rates: Record<string, unknown>;
  fx_rates: Record<string, unknown>;
}
