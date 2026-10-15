import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const base = new URL("../src/renderer/vendor/design-systems/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", base), "utf8"));
let failures = 0;
for (const file of manifest.files) {
  const bytes = await readFile(new URL(file.path, base));
  // Git object hashes prove this is the actual upstream source, not an imitation.
  const sha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  if (sha !== file.sha) { console.error(`Modified upstream file: ${file.path}`); failures++; }
}
if (failures) throw new Error(`${failures} upstream source hashes differ`);
console.log(`Verified ${manifest.files.length} original files at ${manifest.commit}`);
console.log(`License: ${fileURLToPath(new URL("LICENSE", base))}`);
