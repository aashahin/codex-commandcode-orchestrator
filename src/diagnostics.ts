import { mkdir, writeFile, rename, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { errorText } from "./security";
export async function recordProviderProbe(
  root: string,
  provider: string,
  model: string,
  success: boolean,
  error?: unknown,
) {
  if (!/^[\w.-]+$/.test(provider)) return;
  await mkdir(root, { recursive: true, mode: 0o700 });
  const tmp = join(root, `probe-${randomUUID()}.tmp`);
  await writeFile(
    tmp,
    JSON.stringify({
      model,
      success,
      checkedAt: new Date().toISOString(),
      error: error ? errorText(error) : undefined,
    }),
    { mode: 0o600 },
  );
  await rename(tmp, join(root, `provider-${provider}.json`));
}
export async function providerProbe(root: string, provider: string) {
  try {
    return JSON.parse(
      await readFile(join(root, `provider-${provider}.json`), "utf8"),
    );
  } catch {
    return { success: null, message: "No live probe recorded" };
  }
}
