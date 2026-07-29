"use client";
// Price list import — built around the CMN workbook exactly as it is kept.
//   · one worksheet per category, and the sheet name IS the category
//   · column A holds the brand (highlighted) with its types listed underneath;
//     the medicine sheets use a highlighted letter instead of a brand
//   · B unit price · C ORD/SUKI · D wholesale · E last price · F selling · G kilo
// Nothing is invented — no sizes, no categories of our own, no barcodes.
import { useMemo, useState } from "react";
import { tx } from "@/lib/store";
import { useSession } from "@/lib/session";
import { parseCSV, toCentavos } from "@/lib/util";
import { readXLSX, Sheet } from "@/lib/xlsx";
import { blankProduct } from "@/lib/factories";

// The columns of the price list, in their sheet order. Defaults are A…G.
const FIELDS = [
  { key: "name", label: "Product / type", col: "A", required: true },
  { key: "cost_price", label: "Unit price", col: "B", required: false },
  { key: "ord_ws_price", label: "ORD/SUKI", col: "C", required: false },
  { key: "wholesale_price", label: "Wholesale price", col: "D", required: false },
  { key: "suki_price", label: "Last price", col: "E", required: false },
  { key: "retail_price", label: "Selling price", col: "F", required: true },
  { key: "per_kilo", label: "Per kilo", col: "G", required: false },
] as const;

type Mapping = Record<string, number>;

const DEFAULT_MAPPING: Mapping = {
  name: 0,
  cost_price: 1,
  ord_ws_price: 2,
  wholesale_price: 3,
  suki_price: 4,
  retail_price: 5,
  per_kilo: 6,
};

// Internal codes so every product has a stable id until real barcodes are added.
function nextInternalBarcode(products: { barcode: string }[]): string {
  const max = products.reduce((m, p) => {
    const n = parseInt(p.barcode, 10);
    return Number.isFinite(n) && n >= 2000000000000 && n > m ? n : m;
  }, 2000000000000);
  return String(max + 1);
}

const HEADER_HINT = /(name|item|product|descr|brand|price|s\.?r\.?p|whole ?sale|selling|last|unit|kilo|ord|suki|size)/i;

// Price lists open with a title and a blank row, so find the row that reads
// most like column titles. Sheets with no titles at all just start at row 1.
function detectHeaderRow(rows: string[][]): number {
  let best = -1;
  let bestScore = 1;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const score = (rows[i] ?? []).filter((c) => c && HEADER_HINT.test(c)).length;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

const isMoney = (s: string) => s !== "" && !isNaN(parseFloat(s.replace(/[^0-9.\-]/g, "")));
const LETTER_ONLY = /^[a-z][.)]?$/i;

interface Plan {
  headerRow: number; // -1 = data starts on the first row
  mapping: Mapping;
  category: string;
  include: boolean;
}

export default function ImportPage() {
  const session = useSession();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [active, setActive] = useState(0);
  const [startFresh, setStartFresh] = useState(false);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  // Rows below each sheet's header, keeping the highlight flags alongside.
  const body = useMemo(
    () =>
      sheets.map((s, i) => {
        const from = (plans[i]?.headerRow ?? -1) + 1;
        return s.rows
          .map((cells, r) => ({ cells, marked: s.marked[r] ?? [] }))
          .slice(from)
          .filter(({ cells }) => cells.some((c) => c && c.trim() !== ""));
      }),
    [sheets, plans]
  );

  // A heading is a highlighted or bold name cell with no prices next to it —
  // that is the brand, or the letter that starts a medicine section. Sheets
  // saved without highlighting still work: a lone name cell means the same.
  const classify = (row: { cells: string[]; marked: boolean[] }, mapping: Mapping) => {
    const nameAt = mapping["name"] ?? 0;
    const text = (row.cells[nameAt] ?? "").trim();
    const hasPrice = FIELDS.some((f) => f.key !== "name" && isMoney((row.cells[mapping[f.key] ?? -1] ?? "").trim()));
    if (!text) return { kind: "skip" as const, text };
    if (hasPrice) return { kind: "item" as const, text };
    const filled = row.cells.filter((c) => c && c.trim() !== "").length;
    if (row.marked[nameAt] || filled === 1) {
      return { kind: LETTER_ONLY.test(text) ? ("letter" as const) : ("brand" as const), text };
    }
    return { kind: "skip" as const, text };
  };

  const counts = useMemo(
    () =>
      body.map((rows, i) => {
        const mapping = plans[i]?.mapping ?? DEFAULT_MAPPING;
        let items = 0;
        let brands = 0;
        let letters = 0;
        rows.forEach((r) => {
          const k = classify(r, mapping).kind;
          if (k === "item") items++;
          else if (k === "brand") brands++;
          else if (k === "letter") letters++;
        });
        return { items, brands, letters };
      }),
    [body, plans]
  );

  if (!session) return null;

  function load(loaded: Sheet[], name: string) {
    const usable = loaded.filter((s) => s.rows.length > 1);
    const built = usable.map<Plan>((s) => ({
      headerRow: detectHeaderRow(s.rows),
      mapping: { ...DEFAULT_MAPPING },
      category: s.name.trim(), // the sheet name IS the category
      include: true,
    }));
    setSheets(usable);
    setPlans(built);
    setActive(0);
    setFileName(name);
    setResult("");
    setError(usable.length ? "" : "No readable sheets found in that file.");
  }

  async function onFile(f: File | null) {
    if (!f) return;
    setBusy(true);
    setError("");
    setResult("");
    setSheets([]);
    setPlans([]);
    try {
      if (/\.xlsx$/i.test(f.name)) {
        load(await readXLSX(f), f.name);
      } else if (/\.xls$/i.test(f.name)) {
        setError("That's the older .xls format. In Excel choose File → Save As → Excel Workbook (.xlsx), then upload again.");
      } else {
        const rows = parseCSV(await f.text());
        load([{ name: f.name.replace(/\.csv$/i, ""), rows, marked: rows.map(() => []) }], f.name);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  }

  const patchPlan = (i: number, patch: Partial<Plan>) =>
    setPlans((ps) => ps.map((p, n) => (n === i ? { ...p, ...patch } : p)));

  const selected = plans.map((p, i) => ({ p, i })).filter(({ p }) => p.include);
  const totalItems = selected.reduce((t, { i }) => t + (counts[i]?.items ?? 0), 0);
  const canImport = totalItems > 0 && selected.every(({ p }) => p.category.trim() !== "");

  function runImport() {
    let created = 0;
    let updated = 0;
    let hidden = 0;
    tx((d) => {
      const seen = new Set<string>();
      selected.forEach(({ p: plan, i }) => {
        let brand = "";
        body[i].forEach((row) => {
          const { kind, text } = classify(row, plan.mapping);
          // A highlighted brand applies to every type under it; a highlighted
          // single letter is just an A-Z divider, so it clears the brand.
          if (kind === "brand") { brand = text; return; }
          if (kind === "letter") { brand = ""; return; }
          if (kind !== "item") return;

          const cell = (key: string) => (plan.mapping[key] !== undefined ? (row.cells[plan.mapping[key]] ?? "").trim() : "");
          const money = (key: string) => (isMoney(cell(key)) ? toCentavos(cell(key)) : null);
          const name = text;

          const existing = d.products.find(
            (x) =>
              x.name.toLowerCase() === name.toLowerCase() &&
              x.brand.toLowerCase() === brand.toLowerCase() &&
              x.category.toLowerCase() === plan.category.toLowerCase()
          );
          const barcode = existing?.barcode || nextInternalBarcode(d.products);
          const patch = {
            name,
            brand,
            category: plan.category,
            barcode,
            sku: existing?.sku || barcode.slice(-6),
            cost_price: money("cost_price") ?? 0,
            ord_ws_price: money("ord_ws_price"),
            wholesale_price: money("wholesale_price") ?? 0,
            suki_price: money("suki_price"),
            retail_price: money("retail_price") ?? 0,
            per_kilo: money("per_kilo"),
            active: true,
          };
          if (existing) {
            Object.assign(existing, patch);
            seen.add(existing.id);
            updated++;
          } else {
            const fresh = { ...blankProduct(d.settings.low_stock_default), ...patch };
            d.products.push(fresh);
            seen.add(fresh.id);
            created++;
          }
        });
      });
      if (startFresh) {
        d.products.forEach((p) => {
          if (!seen.has(p.id) && p.active) {
            p.active = false;
            hidden++;
          }
        });
      }
    });
    setResult(
      `✅ Done — ${created} new, ${updated} updated${hidden ? `, ${hidden} old product${hidden !== 1 ? "s" : ""} hidden` : ""}.`
    );
  }

  const activeSheet = sheets[active];
  const activePlan = plans[active];
  const headerCells = activeSheet && activePlan?.headerRow >= 0 ? activeSheet.rows[activePlan.headerRow] ?? [] : [];
  const columnCount = Math.max(headerCells.length, ...(activeSheet?.rows.slice(0, 30).map((r) => r.length) ?? [0]), 7);
  const colLabel = (i: number) => String.fromCharCode(65 + i) + (headerCells[i] ? ` — ${headerCells[i]}` : "");

  return (
    <div className="space-y-3">
      <h1 className="font-bold text-lg">📥 Import Price List</h1>

      <div className="card p-4 space-y-3">
        <p className="text-sm text-slate-600">
          Upload your Excel price list (<b>.xlsx</b>) just as it is. Each sheet becomes a category with the sheet&apos;s
          own name, the highlighted brand in column A is applied to the types listed under it, and columns B–G are read
          as unit price, ORD/SUKI, wholesale, last price, selling price and per kilo. Nothing else is added — barcodes
          come later.
        </p>
        <input
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="input"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        {busy && <p className="text-sm font-semibold text-orange-700">Reading {fileName}…</p>}
        {error && <p className="text-sm font-semibold text-red-700">⚠ {error}</p>}
      </div>

      {sheets.length > 0 && (
        <>
          <div className="card">
            <div className="px-4 py-2.5 border-b border-slate-200 flex justify-between items-center gap-2">
              <span className="font-bold text-sm">
                {fileName} — {sheets.length} sheet{sheets.length !== 1 ? "s" : ""}
              </span>
              <button
                className="btn-secondary !py-1.5 !px-3 text-xs"
                onClick={() => {
                  const all = selected.length !== plans.length;
                  setPlans((ps) => ps.map((p) => ({ ...p, include: all })));
                }}
              >
                {selected.length === plans.length ? "Untick all" : "Tick all"}
              </button>
            </div>
            <div className="divide-y divide-slate-100 max-h-[45vh] overflow-y-auto">
              {sheets.map((s, i) => (
                <div key={i} className={`px-3 py-2.5 ${active === i ? "bg-orange-50" : ""}`}>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="w-5 h-5 shrink-0"
                      checked={plans[i].include}
                      onChange={(e) => patchPlan(i, { include: e.target.checked })}
                    />
                    <div className="min-w-0 flex-1">
                      <input
                        className="input !py-1.5 font-semibold text-sm"
                        value={plans[i].category}
                        onChange={(e) => patchPlan(i, { category: e.target.value })}
                        title="This becomes the category name"
                      />
                      <div className="text-xs text-slate-500 mt-0.5">
                        {counts[i]?.items ?? 0} item{(counts[i]?.items ?? 0) !== 1 ? "s" : ""}
                        {counts[i]?.brands ? ` · ${counts[i].brands} brands` : ""}
                        {counts[i]?.letters ? ` · ${counts[i].letters} letter sections` : ""}
                        {!counts[i]?.brands && !counts[i]?.letters ? " · no headings found" : ""}
                      </div>
                    </div>
                    <button className="btn-secondary !py-1.5 !px-3 text-xs shrink-0" onClick={() => setActive(i)}>
                      Check
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {activePlan && (
            <div className="card p-4 space-y-3">
              <h2 className="font-bold">“{activeSheet.name}” — how it will be read</h2>
              <div>
                <label className="label">Row with the column titles</label>
                <select
                  className="input"
                  value={activePlan.headerRow}
                  onChange={(e) => patchPlan(active, { headerRow: parseInt(e.target.value) })}
                >
                  <option value={-1}>No title row — items start on row 1</option>
                  {activeSheet.rows.slice(0, 15).map((r, i) => (
                    <option key={i} value={i}>
                      Row {i + 1}: {r.filter(Boolean).slice(0, 5).join(" | ").slice(0, 60) || "(blank)"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {FIELDS.map((f) => (
                  <div key={f.key} className="flex items-center gap-2">
                    <span className="text-sm font-semibold w-36 shrink-0">
                      {f.label}
                      {f.required && <span className="text-red-600">*</span>}
                    </span>
                    <select
                      className="input flex-1 !py-2"
                      value={activePlan.mapping[f.key] ?? -1}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        const mapping = { ...activePlan.mapping };
                        if (v < 0) delete mapping[f.key];
                        else mapping[f.key] = v;
                        patchPlan(active, { mapping });
                      }}
                    >
                      <option value={-1}>— not in this sheet —</option>
                      {Array.from({ length: columnCount }, (_, i) => (
                        <option key={i} value={i}>
                          {colLabel(i)}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div>
                <div className="label">First rows as the app reads them</div>
                <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-56 overflow-y-auto">
                  {body[active]?.slice(0, 12).map((row, i) => {
                    const { kind, text } = classify(row, activePlan.mapping);
                    if (kind === "skip") return null;
                    const price = (row.cells[activePlan.mapping["retail_price"] ?? -1] ?? "").trim();
                    return (
                      <div key={i} className="px-3 py-1.5 text-sm flex justify-between gap-2">
                        {kind === "item" ? (
                          <>
                            <span className="truncate pl-4 text-slate-700">{text}</span>
                            <span className="tabular-nums text-slate-500 shrink-0">{price}</span>
                          </>
                        ) : (
                          <span className="font-bold uppercase text-orange-800">
                            {kind === "letter" ? `${text} —` : text}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <label className="card p-3 flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="w-5 h-5 mt-0.5" checked={startFresh} onChange={(e) => setStartFresh(e.target.checked)} />
            <span className="text-sm">
              <b>Use only this file.</b>
              <span className="block text-xs text-slate-500">
                Hides every product that isn&apos;t in the sheets you ticked, so the app matches your Excel exactly.
                Nothing is deleted — past sales and stock records keep working.
              </span>
            </span>
          </label>

          <button className="btn-primary w-full text-base" disabled={!canImport} onClick={runImport}>
            Import {totalItems} product{totalItems !== 1 ? "s" : ""} from {selected.length} sheet
            {selected.length !== 1 ? "s" : ""}
          </button>
          {result && <p className="text-sm font-semibold text-orange-700 text-center">{result}</p>}
        </>
      )}
    </div>
  );
}
