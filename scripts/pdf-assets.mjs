import { cp, mkdir } from "node:fs/promises";
const destination = new URL("../public/pdf-assets/", import.meta.url);
await mkdir(destination, { recursive: true });
for (const group of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  await cp(
    new URL("../node_modules/pdfjs-dist/" + group, import.meta.url),
    new URL(group, destination),
    { recursive: true },
  );
}
