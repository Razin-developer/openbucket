import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("README and documentation local links resolve inside the repository", async () => {
  const docs = (await readdir(resolve(root, "docs")))
    .filter((name) => name.endsWith(".md"))
    .map((name) => resolve(root, "docs", name));
  const files = [resolve(root, "README.md"), ...docs];
  const missing = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      let target = match[1].trim();
      if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
      if (/^(?:#|https?:|mailto:)/i.test(target)) continue;
      target = target.split("#", 1)[0];
      if (!target) continue;
      const absolute = resolve(dirname(file), decodeURIComponent(target));
      try {
        await access(absolute);
      } catch {
        missing.push(`${file.slice(root.length + 1)} -> ${target}`);
      }
    }
  }

  assert.deepEqual(missing, []);
});
