const SECRET_KEY = /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CREDENTIAL|COOKIE|AUTH|AWS_SECRET|GOOGLE_APPLICATION_CREDENTIALS)/i;
const CAPTURED_ENVIRONMENT_KEYS = new Set([
  "PATH", "LD_LIBRARY_PATH", "LANG", "LC_ALL", "NODE_PATH", "PYTHONPATH", "RUSTUP_TOOLCHAIN", "BUN_INSTALL",
]);
const MAX_ENVIRONMENT_VALUE_LENGTH = 16 * 1024;

const VALUE_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:ghp|github_pat|glpat|sk_live|sk_test)_[A-Za-z0-9_\-]{12,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
];

export const REDACTED = "[REDACTED]";

export function redactValue(value: string, seededSecrets: string[] = []): string {
  let result = value;
  // Longest-first replacement prevents a shorter prefix secret from exposing a longer secret's suffix.
  for (const secret of orderedSecrets(seededSecrets)) {
    result = result.split(secret).join(REDACTED);
  }
  for (const pattern of VALUE_PATTERNS) result = result.replace(pattern, REDACTED);
  return result;
}

export function redactEnvironment(environment: Record<string, string | undefined>, home?: string): Record<string, string> {
  const seededSecrets = collectSecretValues(environment);
  return Object.fromEntries(
    Object.entries(environment)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .filter(([key]) => CAPTURED_ENVIRONMENT_KEYS.has(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [
        key,
        normalizeHome(redactValue(value, seededSecrets), home).slice(0, MAX_ENVIRONMENT_VALUE_LENGTH),
      ]),
  );
}

export function collectSecretValues(environment: Record<string, string | undefined>): string[] {
  return orderedSecrets(
    Object.entries(environment)
      .filter(([key, value]) => SECRET_KEY.test(key) && value)
      .map(([, value]) => value!),
  );
}

export function normalizeHome(value: string, home?: string): string {
  if (!home) return value;
  return value === home ? "~" : value.split(`${home}/`).join("~/");
}

export function redactText(value: string, environment: Record<string, string | undefined>): string {
  return redactValue(value, collectSecretValues(environment));
}

function orderedSecrets(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length >= 4))]
    .sort((left, right) => right.length - left.length || left.localeCompare(right));
}
