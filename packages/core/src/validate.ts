import { isMintedId, SPACE_ID_PREFIX, TENANT_ID_PREFIX } from "./identity.js";
import type { Space } from "./types.js";

/**
 * Validation at the boundary, not everywhere.
 *
 * Anything arriving from AppSync, from S3 or from a form is `unknown` until
 * one of these says otherwise. Inside the app a `Space` is trusted, because
 * it can only have got there through here.
 *
 * Hand-rolled rather than zod: this package has no dependencies, which is what
 * lets a Lambda import it without dragging a validation library into a cold
 * start. A fork that wants zod should add it here and nowhere else.
 */

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Every reason `value` is not a Space. Empty means it is one. */
export function spaceProblems(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return ["not an object"];
  const s = value as Record<string, unknown>;
  const problems: string[] = [];

  if (!isMintedId(s.id, SPACE_ID_PREFIX)) problems.push(`id is not a minted space id: ${JSON.stringify(s.id)}`);
  if (!isMintedId(s.tenantId, TENANT_ID_PREFIX)) problems.push(`tenantId is not a minted tenant id: ${JSON.stringify(s.tenantId)}`);
  if (!isNonEmptyString(s.name)) problems.push("name is missing or blank");
  if (!isNonEmptyString(s.kind)) problems.push("kind is missing or blank");

  return problems;
}

export function isSpace(value: unknown): value is Space {
  return spaceProblems(value).length === 0;
}

/**
 * Throws with EVERY problem rather than the first.
 *
 * A validator that reports one field at a time turns a malformed row into a
 * sequence of deploys. Listing all of them costs one `join`.
 */
export function assertSpace(value: unknown): asserts value is Space {
  const problems = spaceProblems(value);
  if (problems.length > 0) {
    throw new Error(`not a Space: ${problems.join("; ")}`);
  }
}
