"use client";
// Price list import — upload the Excel workbook (.xlsx) straight from the
// office PC, or a CSV. Their workbook has one sheet per product group, so every
// sheet is read, its header row found, its columns auto-matched and its
// category guessed from the sheet name. Tick the sheets, press import.
import { useMemo, useState } from "react";
import { tx } from "@/lib/store";
import { useSession } from "@/lib/session";
import { parseCSV, toCentavos } from "@/lib/util";
import { readXLSX, Sheet } from "@/lib/xlsx";
import { blankProduct } from "@/lib/factories";
import { CATEGORIES, Category } from "@/lib/types";

const FIELDS = [
  { key: "sku", label: "SKU", required: false },
  { key: "barcode", label: "Barcode (optional)", required: false },
  { key: "name", label: "Product name", required: true },
  { key: "brand", label: "Brand", required: false },
  { key: "category", label: "Category", required: false },
  { key: "unit", label: "Unit", required: false },
  { key: "size_variant", label: "Size/Variant", required: false },
  { key: "retail_price", label: "Selling price", required: true },
  { key: "wholesale_price", label: "Wholesale price", required: false },
  { key: "suki_price", label: "Last price (Suki)", required: false },
  { key: "ord_ws_price", label: "ORD W/S", required: false },
  { key: "cost_price", label: "Unit price (cost)", required: false },
  { key: "per_kilo", label: "Per kilo", required: false },
  { key: "low_stock_threshold", label: "Low-stock threshold", required: false },
] as const;

type Mapping = Record<string, number>;

// Internal barcodes for products that have none printed on the pack.
function nextInternalBarcode(products: { barcode: string }[]): string {
  const max = products.reduce((m, p) => {
    const n = parseInt(p.barcode, 10);
    return Number.isFinite(n) && n >= 2000000000000 && n > m ? n : m;
  }, 2000000000000);
  return String(max + 1);
}

const HEADER_HINT = /(name|item|product|descr|brand|price|s\.?r\.?p|whole ?sale|selling|last|unit|kilo|ord|barcode|sku|size|variant)/i;

// Price lists rarely start on row 1 — there's usually a title and a blank row.
// The header is the row in the first stretch that reads most like column names.
function detectHeaderRow(rows: string[][]): number {
  let best = 0;
  let bestScore = 0;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const score = (rows[i] ?? []).filter((c) => c && HEADER_HINT.test(c)).length;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= 2 ? best : 0;
}

function autoMap(header: string[]): Mapping {
  const m: Mapping = {};
  const set = (k: string, i: number) => {
    if (m[k] === undefined) m[k] = i;
  };
  header.forEach((h, i) => {
    const n = h.toLowerCase().replace(/[^a-z]/g, "");
    if (!n) return;
    FIELDS.forEach((f) => {
      const target = f.key.replace(/_/g, "");
      // "UNIT PRICE" is their cost column, not the pc/kg/pack unit.
      if (f.key === "unit" && /price/i.test(h)) return;
      if (n.includes(target) || target.includes(n)) set(f.key, i);
    });
    if (/(^| )name|item|descri/i.test(h)) set("name", i);
    if (/selling|retail|srp/i.test(h)) set("retail_price", i);
    if (/whole/i.test(h)) set("wholesale_price", i);
    if (/suki|last/i.test(h)) set("suki_price", i);
    if (/cost|puhunan|unit price/i.test(h)) set("cost_price", i);
    if (/\bord\b/i.test(h)) set("ord_ws_price", i);
    if (/kilo|per kg/i.test(h)) set("per_kilo", i);
    if (/size|variant|weight|grams|\bkg\b/i.test(h)) set("size_variant", i);
  });
  return m;
}

const CAT_HINTS: [RegExp, Category][] = [
  [/dry|kibble|sack/i, "dry food"],
  [/wet|can|pouch|gravy/i, "wet food"],
  [/treat|biscuit|jerky|chew|snack/i, "treats"],
  [/litter|sand|pad|dung/i, "litter & accessories"],
  [/shampoo|groom|soap|brush|clean|powder|conditioner/i, "grooming/cleaning"],
  [/vitamin|med|health|vaccine|dewor|tick|flea|drops|supplement/i, "health"],
  [/cage|carrier|crate|kennel|stroller|mat/i, "carriers & cages"],
  [/collar|leash|harness|lead/i, "collars/leash/harness"],
  [/toy|ball|scratch/i, "toys & scratchers"],
  [/bowl|feeder|feeding|dish|drinker/i, "bowls & feeding"],
  [/cologne|perfume|spray/i, "cologne"],
];

function guessCategory(sheetName: string): Category {
  return CAT_HINTS.find(([re]) => re.test(sheetName))?.[1] ?? "other";
}

interface Plan {
  headerRow: number;
  mapping: Mapping;
  category: Category;
  include: boolean;
}

export default function ImportPage() {
  const session = useSession();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [active, setActive] = useState(0);
  const [carryBrand, setCarryBrand] = useState(true);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  // Rows below each sheet's header, ignoring fully blank ones.
  const dataRows = useMemo(
    () =>
      sheets.map((s, i) =>
        s.rows.slice((plans[i]?.headerRow ?? 0) + 1).filter((r) => r.some((c) => c && c.trim() !== ""))
      ),
    [sheets, plans]
  );

  // Brand-heading rows are not products, so don't count them as ones to import.
  const isHeading = (r: string[]) => carryBrand && r.filter((c) => c && c.trim() !== "").length === 1;
  const itemCounts = useMemo(() => dataRows.map((rs) => rs.filter((r) => !isHeading(r)).length), [dataRows, carryBrand]);

  if (!session) return null;

  function load(loaded: Sheet[], name: string) {
    const usable = loaded.filter((s) => s.rows.length > 1);
    const built = usable.map<Plan>((s) => {
      const headerRow = detectHeaderRow(s.rows);
      const mapping = autoMap(s.rows[headerRow] ?? []);
      return {
        headerRow,
        mapping,
        category: guessCategory(s.name),
        // Only pre-tick sheets we can actually import.
        include: mapping["name"] !== undefined && mapping["retail_price"] !== undefined,
      };
    });
    setSheets(usable);
    setPlans(built);
    setActive(Math.max(0, built.findIndex((p) => p.include)));
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
        load([{ name: f.name.replace(/\.csv$/i, ""), rows: parseCSV(await f.text()) }], f.name);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  }

  function patchPlan(i: number, patch: Partial<Plan>) {
    setPlans((ps) => ps.map((p, n) => (n === i ? { ...p, ...patch } : p)));
  }

  const selected = plans.map((p, i) => ({ p, i })).filter(({ p }) => p.include);
  const totalRows = selected.reduce((t, { i }) => t + (itemCounts[i] ?? 0), 0);
  const canImport = selected.length > 0 && selected.every(({ p }) => p.mapping["name"] !== undefined && p.mapping["retail_price"] !== undefined);

  function runImport() {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    tx((d) => {
      selected.forEach(({ p: plan, i }) => {
        let heading = ""; // brand written as its own row above a block of items
        dataRows[i].forEach((r) => {
          const get = (key: string) => (plan.mapping[key] !== undefined ? (r[plan.mapping[key]] ?? "").trim() : "");
          const filled = r.filter((c) => c && c.trim() !== "");
          const name = get("name");

          // A row with a single filled cell is a brand heading, not a product.
          if (carryBrand && filled.length === 1) {
            heading = filled[0].trim();
            return;
          }
          if (!name) {
            skipped++;
            return;
          }

          const rowBarcode = get("barcode");
          const rowSku = get("sku");
          const size = get("size_variant");
          const catRaw = get("category").toLowerCase();
          const category = catRaw
            ? ((CATEGORIES.find((c) => c === catRaw || c.startsWith(catRaw.slice(0, 5))) ?? plan.category) as Category)
            : plan.category;

          // Match an existing product by barcode, then SKU, then name + size.
          const existing =
            (rowBarcode ? d.products.find((x) => x.barcode === rowBarcode) : undefined) ??
            (rowSku ? d.products.find((x) => x.sku.toLowerCase() === rowSku.toLowerCase()) : undefined) ??
            d.products.find(
              (x) => x.name.toLowerCase() === name.toLowerCase() && (x.size_variant ?? "").toLowerCase() === size.toLowerCase()
            );
          // No barcode in the file? Keep the existing one, or mint an internal code.
          const barcode = rowBarcode || existing?.barcode || nextInternalBarcode(d.products);
          const patch = {
            sku: rowSku || existing?.sku || barcode.slice(-6),
            barcode,
            name,
            brand: get("brand") || heading || existing?.brand || "",
            category,
            unit: get("unit") || existing?.unit || "pc",
            size_variant: size || existing?.size_variant || "",
            retail_price: toCentavos(get("retail_price")) || existing?.retail_price || 0,
            wholesale_price:
              toCentavos(get("wholesale_price")) || toCentavos(get("retail_price")) || existing?.wholesale_price || 0,
            suki_price: get("suki_price") ? toCentavos(get("suki_price")) : existing?.suki_price ?? null,
            cost_price: toCentavos(get("cost_price")) || existing?.cost_price || 0,
            ord_ws_price: get("ord_ws_price") ? toCentavos(get("ord_ws_price")) : existing?.ord_ws_price ?? null,
            per_kilo: get("per_kilo") ? toCentavos(get("per_kilo")) : existing?.per_kilo ?? null,
            low_stock_threshold: parseInt(get("low_stock_threshold")) || existing?.low_stock_threshold || d.settings.low_stock_default,
          };
          if (existing) {
            Object.assign(existing, patch);
            updated++;
          } else {
            d.products.push({ ...blankProduct(d.settings.low_stock_default), ...patch });
            created++;
          }
        });
      });
    });
    setResult(
      `✅ Done — ${created} new product${created !== 1 ? "s" : ""}, ${updated} updated${skipped ? `, ${skipped} row${skipped !== 1 ? "s" : ""} skipped (no product name)` : ""}.`
    );
  }

  const activeSheet = sheets[active];
  const activePlan = plans[active];
  const activeHeader = activeSheet?.rows[activePlan?.headerRow ?? 0] ?? [];

  return (
    <div className="space-y-3">
      <h1 className="font-bold text-lg">📥 Import Price List</h1>

      <div className="card p-4 space-y-3">
        <p className="text-sm text-slate-600">
          Upload your Excel price list (<b>.xlsx</b>) exactly as it is — every sheet is read, and the columns and
          category are worked out for you. A CSV works too. Only the <b>product name</b> and <b>selling price</b> are
          required. Products are matched by barcode, then SKU, then name + size, so existing ones get updated instead of
          duplicated.
        </p>
        <input
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="input"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        <a href="/price-list-template.csv" download className="btn-secondary w-full">
          ⬇️ Download CSV template
        </a>
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
              {sheets.length > 1 && (
                <button
                  className="btn-secondary !py-1.5 !px-3 text-xs"
                  onClick={() => {
                    const all = selected.length !== plans.length;
                    setPlans((ps) => ps.map((p) => ({ ...p, include: all })));
                  }}
                >
                  {selected.length === plans.length ? "Untick all" : "Tick all"}
                </button>
              )}
            </div>
            <div className="divide-y divide-slate-100 max-h-[45vh] overflow-y-auto">
              {sheets.map((s, i) => {
                const plan = plans[i];
                const ready = plan.mapping["name"] !== undefined && plan.mapping["retail_price"] !== undefined;
                return (
                  <div key={i} className={`px-3 py-2.5 ${active === i ? "bg-orange-50" : ""}`}>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="w-5 h-5 shrink-0"
                        checked={plan.include}
                        onChange={(e) => patchPlan(i, { include: e.target.checked })}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold truncate">{s.name}</div>
                        <div className="text-xs text-slate-500">
                          {itemCounts[i] ?? 0} item{(itemCounts[i] ?? 0) !== 1 ? "s" : ""} ·{" "}
                          {ready ? (
                            <span className="text-emerald-700 font-semibold">columns matched</span>
                          ) : (
                            <span className="text-amber-700 font-semibold">needs a name + price column</span>
                          )}
                        </div>
                      </div>
                      <button className="btn-secondary !py-1.5 !px-3 text-xs shrink-0" onClick={() => setActive(i)}>
                        Columns
                      </button>
                    </div>
                    <select
                      className="input !py-1.5 mt-1.5 text-sm"
                      value={plan.category}
                      onChange={(e) => patchPlan(i, { category: e.target.value as Category })}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          Category: {c}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>

          {activePlan && (
            <div className="card p-4 space-y-3">
              <h2 className="font-bold">Columns for “{activeSheet.name}”</h2>
              <div>
                <label className="label">Which row holds the column titles?</label>
                <select
                  className="input"
                  value={activePlan.headerRow}
                  onChange={(e) => {
                    const headerRow = parseInt(e.target.value);
                    patchPlan(active, { headerRow, mapping: autoMap(activeSheet.rows[headerRow] ?? []) });
                  }}
                >
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
                    <span className="text-sm font-semibold w-40 shrink-0">
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
                      <option value={-1}>— not in file —</option>
                      {activeHeader.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                Preview first item:{" "}
                {dataRows[active]?.find((r) => !isHeading(r))?.filter(Boolean).slice(0, 6).join(" | ") || "—"}
              </p>
            </div>
          )}

          <label className="card p-3 flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="w-5 h-5 mt-0.5" checked={carryBrand} onChange={(e) => setCarryBrand(e.target.checked)} />
            <span className="text-sm">
              <b>Rows with only one filled cell are brand headings.</b>
              <span className="block text-xs text-slate-500">
                Applies that brand to the items listed underneath it, the way your price list is laid out.
              </span>
            </span>
          </label>

          <button className="btn-primary w-full text-base" disabled={!canImport} onClick={runImport}>
            Import {totalRows} product{totalRows !== 1 ? "s" : ""} from {selected.length} sheet
            {selected.length !== 1 ? "s" : ""}
          </button>
          {result && <p className="text-sm font-semibold text-orange-700 text-center">{result}</p>}
        </>
      )}
    </div>
  );
}
