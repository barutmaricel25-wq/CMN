"use client";
// Product catalog & price list (replaces the Excel file):
// CRUD, three price tiers, CSV import, printable per-category price list.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import { saveProduct } from "@/lib/actions";
import { peso, toCentavos, uid, brandName } from "@/lib/util";
import { CATEGORIES, Category, Product } from "@/lib/types";
import BarcodeInput from "@/components/BarcodeInput";

export default function ProductsPage() {
  const db = useDB();
  const session = useSession();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [editing, setEditing] = useState<Product | null>(null);
  const [printMode, setPrintMode] = useState(false);

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
        .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
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
                setEditing({
                  id: uid(), sku: "", barcode: "", name: "", brand: "", category: "dry food",
                  unit: "pc", size_variant: "", retail_price: 0, wholesale_price: 0, suki_price: null,
                  cost_price: 0, low_stock_threshold: db.settings.low_stock_default, image_url: null, active: true,
                })
              }
            >
              + Add
            </button>
          )}
        </div>
      </div>

      <div className="card p-3 space-y-2">
        <BarcodeInput onScan={setQ} placeholder="Scan barcode to find product" autoFocus={false} />
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input w-44" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="text-xs text-slate-500 px-1">
        {rows.length} product{rows.length !== 1 ? "s" : ""}
        {rows.length > 150 && " — showing first 150, search or filter to narrow"}
      </div>
      <div className="card divide-y divide-slate-100">
        {rows.slice(0, 150).map((p) => (
          <button key={p.id} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 disabled:hover:bg-white" disabled={!canEdit} onClick={() => setEditing({ ...p })}>
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

function ProductEditor({ product, onClose, onSave }: { product: Product; onClose: () => void; onSave: (p: Product) => void }) {
  const [p, setP] = useState(product);
  const set = (k: keyof Product, v: unknown) => setP({ ...p, [k]: v });
  const priceField = (label: string, key: "retail_price" | "wholesale_price" | "suki_price" | "cost_price") => (
    <div>
      <label className="label">{label}</label>
      <input
        className="input" inputMode="decimal"
        defaultValue={p[key] === null ? "" : ((p[key] as number) / 100).toFixed(2)}
        onBlur={(e) => set(key, key === "suki_price" && !e.target.value.trim() ? null : toCentavos(e.target.value))}
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
          {priceField("Retail price ₱", "retail_price")}
          {priceField("Wholesale price ₱", "wholesale_price")}
          {priceField("Suki price ₱ (blank = retail)", "suki_price")}
          {priceField("Cost price ₱", "cost_price")}
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
