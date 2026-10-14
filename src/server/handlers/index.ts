// Importing this module registers every command handler with the dispatcher.
import "./adjustments";
import "./evidence";
import "./findings";
import "./signoffs";
import "./time";
import "./version";
import "./judgments";
import "./requests";
import "./tasks";
import "./standards";
import "./batch";
import "./filing";

export { dispatch, envelopeSchema, registeredCommandTypes } from "../commands";
export type { CommandEnvelope, CommandResult, AuditRow } from "../commands";
