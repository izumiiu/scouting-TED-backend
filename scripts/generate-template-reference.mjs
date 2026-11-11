// Development tool. Reads the four blank forms locally; never calls AI/Atlas.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readDocx } from "../dist/services/documents/docx-reader.js";
import { readPdf } from "../dist/services/documents/pdf-reader.js";
import {
  fingerprint,
  documentFingerprint,
  cellFingerprint,
} from "../dist/services/documents/blocks.js";
const dir = process.argv[2];
if (!dir)
  throw new Error(
    "Provide directory containing the four Form-TYS(...)-Proposal V2027 forms",
  );
const fingerprints = new Set(),
  defaults = new Set(),
  docs = [];
for (const track of ["IDEA", "POC"])
  for (const ext of ["docx", "pdf"]) {
    const file = await readFile(
      resolve(dir, `Form-TYS(${track})-Proposal V2027.${ext}`),
    );
    const blocks =
      ext === "docx" ? await readDocx(file) : (await readPdf(file)).blocks;
    docs.push(documentFingerprint(blocks));
    for (const b of blocks)
      if (b.table && /^[\d,.%]+$/.test(b.text.trim()))
        defaults.add(cellFingerprint(b));
    for (const b of blocks)
      for (const text of [
        b.text,
        ...b.text.split(/\n/),
        b.rowLabel,
        b.columnLabel,
      ])
        if (text?.trim()) fingerprints.add(fingerprint(text));
  }
const data = {
  version: "ted-v2027-forms-1",
  fingerprints: [...fingerprints].sort(),
  documentFingerprints: docs,
  defaultCells: [...defaults],
};
await writeFile(
  new URL("../src/domain/template-reference.ts", import.meta.url),
  `// Generated from the four user-provided blank TED V2027 forms. Fingerprints only.\nexport interface TemplateReference {version:string;fingerprints:string[];documentFingerprints:string[];defaultCells?:string[];}\nexport const templateReference:TemplateReference=${JSON.stringify(data)};\n`,
);
console.log(
  JSON.stringify({
    templates: 4,
    fingerprints: fingerprints.size,
    containsOriginalText: false,
  }),
);
