"use client";
// CSV bulk import with a column-mapping step (matches their existing Excel).
// Template: /price-list-template.csv
import { useState } from "react";
import { useDB, tx } from "@/lib/store";
import { useSession } from "@/lib/session";
import { parseCSV, toCentavos } from "@/lib/util";
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
  { key: "retail_price", label: "Retail price", required: true },
  { key: "wholesale_price", label: "Wholesale price", required: false },
  { key: "suki_price", label: "Last price (Suki)", required: false },
  { key: "ord_ws_price", label: "ORD W/S", required: false },
  { key: "cost_price", label: "Unit price (cost)", required: false },
  { key: "per_kilo", label: "Per kilo", required: false },
  { key: "low_stock_threshold", label: "Low-stock threshold", required: false },
] as const;

// Internal barcodes for products that have none printed on the pack.
function nextInternalBarcode(products: { barcode: string }[]): string {
  const max = products.reduce((m, p) => {
    const n = parseInt(p.barcode, 10);
    return Number.isFinite(n) && n >= 2000000000000 && n > m ? n : m;
  }, 2000000000000);
  return String(max + 1);
}

export default function ImportPage() {
  const db = useDB();
  const session = useSession();
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [result, setResult] = useState("");

  if (!session) return null;
  const header = rows[0] ?? [];
  const dataRows = rows.slice(1);

  function onFile(f: File | null) {
    if (!f) return;
    f.text().then((text) => {
      const parsed = parseCSV(text);
      setRows(parsed);
      // Auto-map by fuzzy header match
      const m: Record<string, number> = {};
      (parsed[0] ?? []).forEach((h, i) => {
        const n = h.toLowerCase().replace(/[^a-z]/g, "");
        FIELDS.forEach((f2) => {
          const target = f2.key.replace(/_/g, "");
          if (n.includes(target) || target.includes(n)) m[f2.key] = m[f2.key] ?? i;
        });
        if (/(^| )name/i.test(h)) m["name"] = m["name"] ?? i;
        if (/retail|srp/i.test(h)) m["retail_price"] = m["retail_price"] ?? i;
        if (/whole/i.test(h)) m["wholesale_price"] = m["wholesale_price"] ?? i;
        if (/suki/i.test(h)) m["suki_price"] = m["suki_price"] ?? i;
        if (/cost|puhunan|unit price/i.test(h)) m["cost_price"] = m["cost_price"] ?? i;
        if (/ord/i.test(h)) m["ord_ws_price"] = m["ord_ws_price"] ?? i;
        if (/kilo|per kg/i.test(h)) m["per_kilo"] = m["per_kilo"] ?? i;
        if (/last/i.test(h)) m["suki_price"] = m["suki_price"] ?? i;
        if (/selling/i.test(h)) m["retail_price"] = m["retail_price"] ?? i;
      });
      setMapping(m);
      setResult("");
    });
  }

  function runImport() {
    let created = 0, updated = 0, skipped = 0;
    tx((d) => {
      dataRows.forEach((r) => {
        const get = (key: string) => (mapping[key] !== undefined ? (r[mapping[key]] ?? "").trim() : "");
        const name = get("name");
        if (!name) { skipped++; return; }
        const csvBarcode = get("barcode");
        const csvSku = get("sku");
        const size = get("size_variant");
        const catRaw = get("category").toLowerCase();
        const category = (CATEGORIES.find((c) => c === catRaw || c.startsWith(catRaw.slice(0, 5))) ?? "other") as Category;
        // Match an existing product by barcode, then SKU, then name + size.
        const existing =
          (csvBarcode ? d.products.find((p) => p.barcode === csvBarcode) : undefined) ??
          (csvSku ? d.products.find((p) => p.sku.toLowerCase() === csvSku.toLowerCase()) : undefined) ??
          d.products.find((p) => p.name.toLowerCase() === name.toLowerCase() && (p.size_variant ?? "").toLowerCase() === size.toLowerCase());
        // No barcode in the file? Keep the existing one, or mint an internal code.
        const barcode = csvBarcode || existing?.barcode || nextInternalBarcode(d.products);
        const patch = {
          sku: csvSku || (existing?.sku ?? barcode.slice(-6)),
          barcode, name,
          brand: get("brand") || (existing?.brand ?? ""),
          category,
          unit: get("unit") || (existing?.unit ?? "pc"),
          size_variant: get("size_variant") || (existing?.size_variant ?? ""),
          retail_price: toCentavos(get("retail_price")) || (existing?.retail_price ?? 0),
          wholesale_price: toCentavos(get("wholesale_price")) || toCentavos(get("retail_price")) || (existing?.wholesale_price ?? 0),
          suki_price: get("suki_price") ? toCentavos(get("suki_price")) : (existing?.suki_price ?? null),
          cost_price: toCentavos(get("cost_price")) || (existing?.cost_price ?? 0),
          ord_ws_price: get("ord_ws_price") ? toCentavos(get("ord_ws_price")) : (existing?.ord_ws_price ?? null),
          per_kilo: get("per_kilo") ? toCentavos(get("per_kilo")) : (existing?.per_kilo ?? null),
          low_stock_threshold: parseInt(get("low_stock_threshold")) || (existing?.low_stock_threshold ?? d.settings.low_stock_default),
        };
        if (existing) { Object.assign(existing, patch); updated++; }
        else { d.products.push({ ...blankProduct(d.settings.low_stock_default), ...patch }); created++; }
      });
    });
    setResult(`✅ Imported: ${created} new, ${updated} updated, ${skipped} skipped (no product name).`);
  }

  return (
    <div className="space-y-3">
      <h1 className="font-bold text-lg">📄 CSV Price List Import</h1>
      <div className="card p-4 space-y-3">
        <p className="text-sm text-slate-600">
          Upload your Excel price list saved as CSV. Only <b>product name</b> and <b>selling price</b> are required.
          Products are matched by barcode, then SKU, then name + size — existing ones are updated, new ones created.
          No barcode column? The app assigns an internal code automatically.
        </p>
        <a href="/price-list-template.csv" download className="btn-secondary w-full">⬇️ Download CSV template</a>
        <input type="file" accept=".csv,text/csv" className="input" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      </div>

      {rows.length > 1 && (
        <div className="card p-4 space-y-3">
          <h2 className="font-bold">Map your columns ({dataRows.length} rows found)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {FIELDS.map((f) => (
              <div key={f.key} className="flex items-center gap-2">
                <span className="text-sm font-semibold w-40">{f.label}{f.required && <span className="text-red-600">*</span>}</span>
                <select
                  className="input flex-1 !py-2"
                  value={mapping[f.key] ?? -1}
                  onChange={(e) => setMapping({ ...mapping, [f.key]: parseInt(e.target.value) })}
                >
                  <option value={-1}>— not in file —</option>
                  {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="text-xs text-slate-500">
            Preview row 1: {dataRows[0]?.slice(0, 6).join(" | ")}
          </div>
          <button
            className="btn-primary w-full"
            disabled={mapping["name"] === undefined || mapping["retail_price"] === undefined}
            onClick={runImport}
          >
            Import {dataRows.length} rows
          </button>
          {result && <p className="text-sm font-semibold text-orange-700">{result}</p>}
        </div>
      )}
    </div>
  );
}
