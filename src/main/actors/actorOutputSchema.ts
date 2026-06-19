// Lightweight JSON Schema subset validator for actor outputSchema (P6, R10).
//
// Covers the subset actors realistically need: type, required, properties,
// items, enum. Avoids pulling in Ajv (bundle/native risk). Returns null on
// success or a human-readable error string on failure.

export function validateOutputSchema(value: unknown, schema: Record<string, unknown>): string | null {
  return validateNode(value, schema, "$");
}

function validateNode(value: unknown, schema: Record<string, unknown>, path: string): string | null {
  const type = schema["type"];
  if (typeof type === "string" && !matchesType(value, type)) {
    return `${path}: expected ${type}, got ${Array.isArray(value) ? "array" : typeof value}`;
  }
  const en = schema["enum"];
  if (Array.isArray(en) && !en.some((e) => deepEqual(value, e))) {
    return `${path}: value not in enum`;
  }
  if (schema["type"] === "object" && typeof value === "object" && value !== null && !Array.isArray(value)) {
    const required = schema["required"];
    if (Array.isArray(required)) {
      for (const r of required) {
        if (!(r in (value as Record<string, unknown>))) return `${path}: missing required "${r}"`;
      }
    }
    const props = schema["properties"];
    if (props && typeof props === "object") {
      for (const [key, sub] of Object.entries(props as Record<string, unknown>)) {
        if (key in (value as Record<string, unknown>) && sub && typeof sub === "object") {
          const err = validateNode((value as Record<string, unknown>)[key], sub as Record<string, unknown>, `${path}.${key}`);
          if (err) return err;
        }
      }
    }
  }
  if (schema["type"] === "array" && Array.isArray(value)) {
    const items = schema["items"];
    if (items && typeof items === "object") {
      for (let i = 0; i < value.length; i++) {
        const err = validateNode(value[i], items as Record<string, unknown>, `${path}[${i}]`);
        if (err) return err;
      }
    }
  }
  return null;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number";
    case "boolean": return typeof value === "boolean";
    case "object": return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array": return Array.isArray(value);
    case "null": return value === null;
    default: return true;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
