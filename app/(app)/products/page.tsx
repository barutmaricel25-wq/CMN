"use client";
// Product catalog & price list (replaces the Excel file):
// CRUD, three price tiers, CSV import, printable per-category price list.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import { saveProduct } from "@/lib/actions";
import { peso, toCentavos, brandName, compareByBrand } from "@/lib/util";
import { blankProduct } from "@/lib/factories";
import { CATEGORIES, Category, Product } from "@/lib/types";
import BarcodeInput from "@/components/BarcodeInput";

export default function ProductsPage() {
  const db = useDB();
  const session = useSession();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [editing, setEditing] = useState<Product | null>(null);
  const [viewing, setViewing] = useState<Product | null>(null);
  const [printMode, setPrintMode] = useState(false);
  const [focused, setFocused] = useState(false); // show typeahead dropdown

  // Prefill from global search (?q=...)
  useEffect(() => {
    const qq = new URLSearchParams(window.location.search).get("q");
    if (qq) setQ(qq);
  }, []);

  const rows = useMemo(
    () =>
      db.products
        .filter((p) => p.active)
        .filter((p) => !cat || p.category === cat)
        .filter(
          (p) =>
            !q ||
            p.name.toLowerCase().includes(q.toLowerCase()) ||
            p.brand.toLowerCase().includes(q.toLowerCase()) ||
            p.barcode === q ||
            p.sku.toLowerCase() === q.toLowerCase()
        )
        // Alphabetical by brand, then product name (blank brands last).
        .sort(compareByBrand),
    [db.products, q, cat]
  );

  if (!session) return null;
  const user = db.users.find((u) => u.id === session.user_id)!;
  const canEdit = user.role !== "staff";

  if (printMode) {
    const grouped = CATEGORIES.map((c) => ({ c, items: rows.filter((p) => p.category === c) })).filter((g) => g.items.length);
    return (
      <div>
        <div className="flex gap-2 mb-4 print:hidden">
          <button className="btn-secondary" onClick={() => setPrintMode(false)}>← Back</button>
          <button className="btn-primary" onClick={() => window.print()}>🖨️ Print price list</button>
        </div>
        <div className="bg-white p-6 text-sm">
          <h1 className="text-xl font-bold">CMN Trading Corporation — Price List</h1>
          <p className="text-xs mb-4">As of {new Date().toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}</p>
          {grouped.map(({ c, items }) => (
            <div key={c} className="mb-4">
              <h2 className="font-bold uppercase border-b border-black mb-1">{c}</h2>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left">
                    <th className="py-0.5">Item</th><th>Size</th><th className="text-right">Retail</th><th className="text-right">Wholesale</th><th className="text-right">Suki</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} className="border-b border-slate-200">
                      <td className="py-0.5">{brandName(p)}</td>
                      <td>{p.size_variant}</td>
                      <td className="text-right tabular-nums">{peso(p.retail_price)}</td>
                      <td className="text-right tabular-nums">{peso(p.wholesale_price)}</td>
                      <td className="text-right tabular-nums">{p.suki_price ? peso(p.suki_price) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <h1 className="font-bold text-lg">🏷️ Products & Price List</h1>
        <div className="flex gap-2">
          <button className="btn-secondary !py-2" onClick={() => setPrintMode(true)}>🖨️ Price list</button>
          {canEdit && <Link href="/products/import" className="btn-secondary !py-2">📄 CSV import</Link>}
          {canEdit && (
            <button
              className="btn-primary !py-2"
              onClick={() =>
                setEditing(blankProduct(db.settings.low_stock_default))
              }
            >
              + Add
            </button>
          )}
        </div>
      </div>

      <div className="card p-3 space-y-2">
        <BarcodeInput
          onScan={(code) => {
            const p = db.products.find((x) => x.active && (x.barcode === code || x.sku.toLowerCase() === code.toLowerCase()));
            if (p) setViewing(p); else setQ(code);
          }}
          placeholder="Type barcode / SKU, then Enter"
        />
        <div className="relative">
          <input
            className="input w-full"
            placeholder="Search name / brand / SKU…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setFocused(true); }}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
          />
          {/* Typeahead: possible matches while typing */}
          {focused && q.trim().length >= 1 && rows.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-30 card max-h-72 overflow-y-auto">
              {rows.slice(0, 8).map((p) => (
                <button
                  key={p.id}
                  className="w-full text-left px-3 py-2 hover:bg-orange-50 border-b border-slate-100 last:border-0 flex justify-between items-center gap-2"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setViewing(p); setFocused(false); }}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold truncate">{brandName(p)} <span className="text-slate-400 font-normal">{p.size_variant}</span></span>
                    <span className="block text-[11px] text-slate-500">{p.category} · {p.sku}</span>
                  </span>
                  <span className="font-bold text-sm text-orange-700 tabular-nums whitespace-nowrap">{peso(p.retail_price)}</span>
                </button>
              ))}
              {rows.length > 8 && <div className="px-3 py-1.5 text-[11px] text-slate-400">+{rows.length - 8} more — keep typing to narrow</div>}
            </div>
          )}
        </div>
        <select className="input w-full" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="text-xs text-slate-500 px-1">
        {rows.length} product{rows.length !== 1 ? "s" : ""}
        {rows.length > 150 && " — showing first 150, search or filter to narrow"}
      </div>
      <div className="card divide-y divide-slate-100">
        {rows.slice(0, 150).map((p) => (
          <button key={p.id} className="w-full text-left px-4 py-2.5 hover:bg-slate-50" onClick={() => setViewing(p)}>
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{brandName(p)}</div>
                <div className="text-xs text-slate-500">{p.category} · {p.size_variant} · {p.sku} · {p.barcode}</div>
              </div>
              <div className="text-right whitespace-nowrap text-xs">
                <div className="font-bold text-sm tabular-nums">{peso(p.retail_price)}</div>
                <div className="text-slate-500 tabular-nums">WS {peso(p.wholesale_price)} · Suki {p.suki_price ? peso(p.suki_price) : "—"}</div>
              </div>
            </div>
          </button>
        ))}
        {rows.length === 0 && <p className="text-center text-sm text-slate-400 py-8">No products</p>}
      </div>

      {viewing && (
        <PriceDetail
          p={viewing}
          canEdit={canEdit}
          onClose={() => setViewing(null)}
          onEdit={() => { setEditing({ ...viewing }); setViewing(null); }}
        />
      )}

      {editing && (
        <ProductEditor
          product={editing}
          onClose={() => setEditing(null)}
          onSave={(p) => { saveProduct(p, session.user_id); setEditing(null); }}
        />
      )}
    </div>
  );
}

// Big price view: tap a product to check its Retail / Wholesale / Suki price.
function PriceDetail({ p, canEdit, onClose, onEdit }: { p: Product; canEdit: boolean; onClose: () => void; onEdit: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-xl font-bold">{brandName(p)}</div>
        <div className="text-sm text-slate-500 mb-4">{p.size_variant} · {p.category} · {p.sku} · {p.barcode}</div>

        {/* Selling price is the headline; the full price list follows. */}
        <div className="rounded-2xl bg-orange-50 border border-orange-200 p-3 text-center mb-2">
          <div className="text-[10px] font-bold uppercase tracking-wide text-orange-700">Selling price (Retail)</div>
          <div className="text-3xl font-extrabold text-orange-800 tabular-nums leading-tight mt-1">{peso(p.retail_price)}</div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center">
          <PriceBox label="ORD W/S" value={p.ord_ws_price ? peso(p.ord_ws_price) : "—"} />
          <PriceBox label="Whole sale" value={peso(p.wholesale_price)} />
          <PriceBox label="Last price (Suki)" value={p.suki_price ? peso(p.suki_price) : "—"} tone="amber" />
          <PriceBox label="Per kilo" value={p.per_kilo ? peso(p.per_kilo) : "—"} />
          {canEdit && <PriceBox label="Unit price (cost)" value={peso(p.cost_price)} tone="slate" wide />}
        </div>
        <div className="flex gap-2 mt-4">
          <button className="btn-ghost flex-1" onClick={onClose}>Close</button>
          {canEdit && <button className="btn-primary flex-1" onClick={onEdit}>✏️ Edit</button>}
        </div>
      </div>
    </div>
  );
}

function PriceBox({ label, value, tone = "white", wide = false }: { label: string; value: string; tone?: "white" | "amber" | "slate"; wide?: boolean }) {
  const cls =
    tone === "amber" ? "bg-amber-50 border-amber-200 text-amber-800"
      : tone === "slate" ? "bg-slate-100 border-slate-300 text-slate-700"
      : "bg-white border-slate-200 text-slate-800";
  return (
    <div className={`rounded-xl border p-2.5 ${cls} ${wide ? "col-span-2" : ""}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-lg font-extrabold tabular-nums leading-tight">{value}</div>
    </div>
  );
}

function ProductEditor({ product, onClose, onSave }: { product: Product; onClose: () => void; onSave: (p: Product) => void }) {
  const [p, setP] = useState(product);
  const set = (k: keyof Product, v: unknown) => setP({ ...p, [k]: v });
  type PriceKey = "retail_price" | "wholesale_price" | "suki_price" | "cost_price" | "ord_ws_price" | "per_kilo";
  const NULLABLE: PriceKey[] = ["suki_price", "ord_ws_price", "per_kilo"];
  const priceField = (label: string, key: PriceKey) => (
    <div>
      <label className="label">{label}</label>
      <input
        className="input" inputMode="decimal"
        defaultValue={p[key] === null ? "" : ((p[key] as number) / 100).toFixed(2)}
        onBlur={(e) => set(key, NULLABLE.includes(key) && !e.target.value.trim() ? null : toCentavos(e.target.value))}
      />
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 rounded-b-none sm:rounded-2xl space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-lg">{product.name ? "Edit product" : "New product"}</h3>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">SKU</label><input className="input" value={p.sku} onChange={(e) => set("sku", e.target.value)} /></div>
          <div><label className="label">Barcode</label><input className="input font-mono" value={p.barcode} onChange={(e) => set("barcode", e.target.value)} /></div>
        </div>
        <div><label className="label">Name</label><input className="input" value={p.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">Brand</label><input className="input" value={p.brand} onChange={(e) => set("brand", e.target.value)} /></div>
          <div>
            <label className="label">Category</label>
            <select className="input" value={p.category} onChange={(e) => set("category", e.target.value as Category)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div><label className="label">Unit</label><input className="input" value={p.unit} onChange={(e) => set("unit", e.target.value)} /></div>
          <div><label className="label">Size/variant</label><input className="input" value={p.size_variant} onChange={(e) => set("size_variant", e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {priceField("Unit price (cost) ₱", "cost_price")}
          {priceField("ORD W/S ₱", "ord_ws_price")}
          {priceField("Whole sale ₱", "wholesale_price")}
          {priceField("Last price (Suki) ₱", "suki_price")}
          {priceField("Selling price (Retail) ₱", "retail_price")}
          {priceField("Per kilo ₱", "per_kilo")}
        </div>
        <div className="grid grid-cols-2 gap-2 items-end">
          <div>
            <label className="label">Low-stock threshold</label>
            <input className="input" type="number" inputMode="numeric" value={p.low_stock_threshold} onChange={(e) => set("low_stock_threshold", parseInt(e.target.value) || 0)} />
          </div>
          <label className="flex items-center gap-2 font-semibold text-sm pb-3">
            <input type="checkbox" className="w-5 h-5" checked={p.active} onChange={(e) => set("active", e.target.checked)} /> Active
          </label>
        </div>
        <div className="flex gap-2 pt-2">
          <button className="btn-ghost flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" disabled={!p.name.trim()} onClick={() => onSave(p)}>Save</button>
        </div>
      </div>
    </div>
  );
}
