// Importing this module registers every command handler with the dispatcher.
import "./adjustments";
import "./evidence";
import "./findings";
import "./signoffs";
import "./time";

export { dispatch, envelopeSchema, registeredCommandTypes } from "../commands";
export type { CommandEnvelope, CommandResult, AuditRow } from "../commands";
