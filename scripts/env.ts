import { existsSync, readFileSync, copyFileSync } from "fs";

export const ENV_FILE = ".env";
export const ENV_EXAMPLE_FILE = ".env.example";
export const PRIVATE_KEY_PLACEHOLDER = "your_wallet_private_key_here";

export function loadEnvFile(path = ENV_FILE): void {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] == null) process.env[key] = value;
  }
}

export function privateKeyConfigured(): boolean {
  const pk = process.env.PRIVATE_KEY?.trim();
  return !!pk && pk !== PRIVATE_KEY_PLACEHOLDER;
}

export function ensureEnvScaffold(): boolean {
  if (existsSync(ENV_FILE)) return false;
  if (existsSync(ENV_EXAMPLE_FILE)) {
    copyFileSync(ENV_EXAMPLE_FILE, ENV_FILE);
    return true;
  }
  return false;
}

loadEnvFile();
