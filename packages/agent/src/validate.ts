import type { JsonSchema } from "@brasos/host/types";

/** Validates tool arguments against the schema subset we publish. Returns an error message, or null if the arguments are fine. */
export function validate(schema: JsonSchema, args: unknown): string | null {
  if (args === undefined || args === null) args = {};
  if (typeof args !== "object" || Array.isArray(args)) return "arguments must be an object";
  const a = args as Record<string, unknown>;
  const props = schema.properties ?? {};
  for (const k of Object.keys(a)) if (!(k in props)) return `unknown argument "${k}"`;
  for (const k of schema.required ?? []) if (a[k] === undefined) return `missing argument "${k}"`;
  for (const [k, spec] of Object.entries(props)) {
    const v = a[k];
    if (v === undefined) continue;
    const ok =
      spec.type === "string" ? typeof v === "string"
      : spec.type === "boolean" ? typeof v === "boolean"
      : spec.type === "integer" ? Number.isInteger(v)
      : typeof v === "number" && Number.isFinite(v);
    if (!ok) return `argument "${k}" must be a ${spec.type}`;
    if (spec.enum && !spec.enum.includes(v as string)) return `argument "${k}" must be one of ${spec.enum.join(", ")}`;
    if (typeof v === "number" && ((spec.minimum !== undefined && v < spec.minimum) || (spec.maximum !== undefined && v > spec.maximum))) {
      return `argument "${k}" is out of range`;
    }
  }
  return null;
}
