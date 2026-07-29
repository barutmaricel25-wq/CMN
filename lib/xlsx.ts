// Minimal .xlsx reader — no dependencies.
// An .xlsx file is a ZIP of XML parts, so we walk the ZIP central directory
// ourselves and inflate each part with the browser's DecompressionStream. That
// is enough to hand every worksheet back as a plain grid of strings, which is
// all the price-list import needs (no formulas, styles or dates).

export interface Sheet {
  name: string;
  rows: string[][];
}

interface Entry {
  method: number;
  start: number;
  size: number;
}

const td = new TextDecoder();
const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

function readZip(buf: ArrayBuffer): Map<string, Entry> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // End-of-central-directory record — scan back from the end for its signature.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
    if (u32(view, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("That file isn't a valid Excel .xlsx workbook.");

  const out = new Map<string, Entry>();
  let p = u32(view, eocd + 16);
  while (p + 46 <= bytes.length && u32(view, p) === 0x02014b50) {
    const method = u16(view, p + 10);
    const size = u32(view, p + 20);
    const nameLen = u16(view, p + 28);
    const extraLen = u16(view, p + 30);
    const commentLen = u16(view, p + 32);
    const local = u32(view, p + 42);
    const name = td.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    // The local header repeats the name and may carry a different extra field,
    // so the data offset has to come from there, not from the directory entry.
    const start = local + 30 + u16(view, local + 26) + u16(view, local + 28);
    out.set(name, { method, start, size });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function readPart(zip: Map<string, Entry>, buf: ArrayBuffer, name: string): Promise<string | null> {
  const e = zip.get(name);
  if (!e) return null;
  const bytes = new Uint8Array(buf, e.start, e.size);
  if (e.method === 0) return td.decode(bytes);
  if (typeof DecompressionStream === "undefined")
    throw new Error("This browser can't open .xlsx files — save the sheet as CSV and upload that instead.");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

const parse = (text: string) => new DOMParser().parseFromString(text, "application/xml");

// "BC7" -> 54 (zero-based column index)
function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
    else if (c >= 97 && c <= 122) n = n * 26 + (c - 96);
    else break;
  }
  return n - 1;
}

function sharedStrings(doc: Document | null): string[] {
  if (!doc) return [];
  return Array.from(doc.getElementsByTagName("si")).map((si) => {
    // Drop phonetic guides so Japanese-styled cells don't double up.
    Array.from(si.getElementsByTagName("rPh")).forEach((n) => n.remove());
    return Array.from(si.getElementsByTagName("t"))
      .map((t) => t.textContent ?? "")
      .join("");
  });
}

function sheetRows(doc: Document, shared: string[]): string[][] {
  const rows: string[][] = [];
  Array.from(doc.getElementsByTagName("row")).forEach((row) => {
    const cells: string[] = [];
    Array.from(row.getElementsByTagName("c")).forEach((c) => {
      const ref = c.getAttribute("r") ?? "";
      const at = ref ? colIndex(ref) : cells.length;
      const type = c.getAttribute("t");
      let value: string;
      if (type === "inlineStr") {
        value = Array.from(c.getElementsByTagName("t"))
          .map((n) => n.textContent ?? "")
          .join("");
      } else {
        const raw = c.getElementsByTagName("v")[0]?.textContent ?? "";
        value = type === "s" ? shared[parseInt(raw, 10)] ?? "" : raw;
      }
      while (cells.length < at) cells.push("");
      cells[at] = value.trim();
    });
    // Rows carry their own 1-based number; blank rows are simply missing.
    const n = parseInt(row.getAttribute("r") ?? "", 10);
    const at = Number.isFinite(n) ? n - 1 : rows.length;
    while (rows.length < at) rows.push([]);
    rows[at] = cells;
  });
  return rows;
}

export async function readXLSX(file: File): Promise<Sheet[]> {
  const buf = await file.arrayBuffer();
  const zip = readZip(buf);

  const wbText = await readPart(zip, buf, "xl/workbook.xml");
  if (!wbText) throw new Error("That file isn't an Excel .xlsx workbook.");
  const wb = parse(wbText);

  const relsText = await readPart(zip, buf, "xl/_rels/workbook.xml.rels");
  const rels = new Map<string, string>();
  if (relsText)
    Array.from(parse(relsText).getElementsByTagName("Relationship")).forEach((r) =>
      rels.set(r.getAttribute("Id") ?? "", r.getAttribute("Target") ?? "")
    );

  const ssText = await readPart(zip, buf, "xl/sharedStrings.xml");
  const shared = sharedStrings(ssText ? parse(ssText) : null);

  const NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const sheets: Sheet[] = [];
  const nodes = Array.from(wb.getElementsByTagName("sheet"));
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const rid = node.getAttributeNS(NS, "id") ?? node.getAttribute("r:id") ?? "";
    const target = (rels.get(rid) ?? `worksheets/sheet${i + 1}.xml`).replace(/^\/?(xl\/)?/, "");
    const text = await readPart(zip, buf, "xl/" + target);
    if (!text) continue;
    sheets.push({ name: node.getAttribute("name") ?? `Sheet ${i + 1}`, rows: sheetRows(parse(text), shared) });
  }
  return sheets;
}
