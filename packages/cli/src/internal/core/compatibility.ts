import semver from "semver";

export interface CompatibilityDeclaration {
  readonly vibekit: string;
  readonly pi?: string;
  readonly node?: string;
}

export interface CompatibilityActual {
  readonly vibekit: string;
  readonly pi?: string;
  readonly node?: string;
}

export function satisfiesCompatibility(
  declared: CompatibilityDeclaration,
  actual: CompatibilityActual,
): boolean {
  if (!satisfiesRange(declared.vibekit, actual.vibekit)) {
    return false;
  }
  if (declared.pi !== undefined) {
    if (actual.pi === undefined || !satisfiesPi(declared.pi, actual.pi)) {
      return false;
    }
  }
  if (declared.node !== undefined) {
    if (actual.node === undefined || !satisfiesRange(declared.node, actual.node)) {
      return false;
    }
  }
  return true;
}

export function isSemverRange(value: string): boolean {
  return semver.validRange(value) !== null;
}

function satisfiesPi(declared: string, actual: string): boolean {
  if (isSemverRange(declared)) {
    return satisfiesRange(declared, actual);
  }
  return declared === actual;
}

function satisfiesRange(range: string, version: string): boolean {
  const validRange = semver.validRange(range);
  if (validRange === null) {
    return false;
  }
  const normalized = normalizeVersion(version);
  if (normalized === null) {
    return false;
  }
  return semver.satisfies(normalized, validRange, { includePrerelease: true });
}

function normalizeVersion(version: string): string | null {
  const trimmed = version.trim().replace(/^v/i, "");
  if (semver.valid(trimmed)) {
    return trimmed;
  }
  const coerced = semver.coerce(trimmed);
  return coerced === null ? null : coerced.version;
}
