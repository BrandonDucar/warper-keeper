type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function canonicalize(value: unknown, ancestors = new WeakSet<object>()): CanonicalValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Proof values must be finite.");
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error("Proof values cannot be circular.");
    ancestors.add(value);
    const result = value.map((item) => canonicalize(item, ancestors));
    ancestors.delete(value);
    return result;
  }
  if (typeof value === "object") {
    if (ancestors.has(value)) throw new Error("Proof values cannot be circular.");
    ancestors.add(value);
    const record = value as Record<string, unknown>;
    const result: Record<string, CanonicalValue> = {};
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item !== undefined) result[key] = canonicalize(item, ancestors);
    }
    ancestors.delete(value);
    return result;
  }
  throw new Error("Proof values must be JSON-compatible.");
}

export function canonicalStringify(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export async function sha256Canonical(value: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalStringify(value)),
  );
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}
