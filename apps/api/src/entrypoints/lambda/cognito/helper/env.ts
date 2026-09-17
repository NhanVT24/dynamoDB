export function readCsvEnv(name: string) {
  return String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function readBooleanEnv(name: string, defaultValue = false) {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return ["1", "true", "yes", "on"].includes(raw);
}
