"use client";
// Product catalog & price list (replaces the Excel file):
// CRUD, three price tiers, Excel/CSV import, printable per-category price list.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import { saveBrand, deleteProducts } from "@/lib/actions";
import { peso, toCentavos, brandName, compareByBrand, isInternalBarcode, matchesSearch, searchScore, perUnitLabel } from "@/lib/util";
import { blankProduct } from "@/lib/factories";
import { CATEGORIES, categoriesOf, Product } from "@/lib/types";
import BarcodeInput from "@/components/BarcodeInput";

const SHOW_LIMIT = 400;

export default function ProductsPage() {
  const db = useDB();
  const session = useSession();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [editing, setEditing] = useState<{ brand: string; category: string } | null>(null);
  const [flash, setFlash] = useState("");
  const [viewing, setViewing] = useState<Product | null>(null);
  const [printMode, setPrintMode] = useState(false);
  const [focused, setFocused] = useState(false); // show typeahead dropdown
  const [picking, setPicking] = useState(false); // multi-select mode
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);

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
        // Matches on everything about the product at once, so typing what the
        // list shows ("aozi kitten") finds it.
        .filter((p) => matchesSearch(p, q))
        // Alphabetical by brand, then product name (blank brands last).
        .sort(compareByBrand),
    [db.products, q, cat]
  );

  // The closest matches first — alphabetical order would show whatever happens
  // to sort earliest, which rarely resembles what was typed.
  const suggestions = useMemo(
    () =>
      q.trim().length < 2
        ? []
        : [...rows]
            .sort((a, b) => searchScore(a, q) - searchScore(b, q) || compareByBrand(a, b))
            .slice(0, 8),
    [rows, q]
  );

  // Brand blocks, alphabetical, exactly how the Excel price list is laid out.
  const groups = useMemo(() => {
    const out: { brand: string; items: Product[] }[] = [];
    rows.slice(0, SHOW_LIMIT).forEach((p) => {
      const last = out[out.length - 1];
      if (last && last.brand === p.brand) last.items.push(p);
      else out.push({ brand: p.brand, items: [p] });
    });
    return out;
  }, [rows]);

  const toggle = (id: string) =>
    setPicked((s0) => {
      const n = new Set(s0);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const setMany = (ids: string[], on: boolean) =>
    setPicked((s0) => {
      const n = new Set(s0);
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
      return n;
    });

  function leavePicking() {
    setPicking(false);
    setPicked(new Set());
    setConfirmBulk(false);
  }

  // Categories come from the price list itself — one per imported worksheet.
  const categories = useMemo(() => {
    const used = categoriesOf(db.products.filter((p) => p.active));
    return used.length ? used : [...CATEGORIES];
  }, [db.products]);

  if (!session) return null;
  const user = db.users.find((u) => u.id === session.user_id)!;
  const canEdit = user.role !== "staff";

  if (printMode) {
    const grouped = categories.map((c) => ({ c, items: rows.filter((p) => p.category === c) })).filter((g) => g.items.length);
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
          {canEdit && (
            <button
              className={`!py-2 ${picking ? "btn-primary" : "btn-secondary"}`}
              onClick={() => (picking ? leavePicking() : setPicking(true))}
            >
              {picking ? "✕ Cancel select" : "☑️ Select"}
            </button>
          )}
          {canEdit && <Link href="/products/import" className="btn-secondary !py-2">📥 Import price list</Link>}
          {canEdit && (
            <button className="btn-primary !py-2" onClick={() => setEditing({ brand: "", category: "" })}>
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
          {focused && q.trim().length >= 2 && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-30 card max-h-72 overflow-y-auto">
              {suggestions.map((p) => (
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
              {rows.length > suggestions.length && (
                <div className="px-3 py-1.5 text-[11px] text-slate-400">
                  +{rows.length - suggestions.length} more — keep typing to narrow
                </div>
              )}
            </div>
          )}
        </div>
        <select className="input w-full" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {flash && (
        <button className="card w-full p-3 text-sm font-semibold text-orange-800 bg-orange-50 border-orange-200 text-left" onClick={() => setFlash("")}>
          {flash} <span className="text-slate-400 font-normal">— tap to dismiss</span>
        </button>
      )}

      {picking && (
        <div className="card p-3 space-y-2 border-orange-300">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold">{picked.size} selected</span>
            <button
              className="btn-secondary !py-1.5 !px-3 text-xs"
              onClick={() => setMany(rows.map((p) => p.id), picked.size < rows.length)}
            >
              {picked.size < rows.length ? `Select all ${rows.length} shown` : "Clear all"}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Search or pick a category first, then &ldquo;select all shown&rdquo; — that is the quickest way to clear out
            a whole category.
          </p>
        </div>
      )}

      <div className="text-xs text-slate-500 px-1">
        {rows.length} product{rows.length !== 1 ? "s" : ""}
        {rows.length > SHOW_LIMIT && ` — showing first ${SHOW_LIMIT}, search or filter to narrow`}
      </div>
      {/* Laid out like the price list itself: brand in bold, its types under it. */}
      <div className="card overflow-hidden">
        {groups.map(({ brand, items }) => (
          <div key={brand} className="border-b border-slate-200 last:border-0">
            <div className="px-4 py-1.5 bg-slate-100 flex justify-between items-center gap-2">
              {picking && (
                <input
                  type="checkbox"
                  className="w-5 h-5 shrink-0"
                  checked={items.every((p) => picked.has(p.id))}
                  onChange={(e) => setMany(items.map((p) => p.id), e.target.checked)}
                  title={`Select all of ${brand || "these"}`}
                />
              )}
              <span className="font-bold text-sm uppercase tracking-wide text-slate-800 truncate flex-1">{brand || "No brand"}</span>
              {canEdit && !picking && (
                <button
                  className="text-[11px] font-bold text-orange-700 shrink-0"
                  onClick={() => setEditing({ brand, category: items[0].category })}
                >
                  ✏️ Edit
                </button>
              )}
            </div>
            <div className="divide-y divide-slate-100">
              {items.map((p) => (
                <button
                  key={p.id}
                  className={`w-full text-left px-4 py-2 hover:bg-orange-50 ${picked.has(p.id) ? "bg-orange-100" : ""}`}
                  onClick={() => (picking ? toggle(p.id) : setViewing(p))}
                >
                  <div className="flex justify-between items-start gap-2">
                    {picking && (
                      <input
                        type="checkbox"
                        className="w-5 h-5 mt-0.5 shrink-0 pointer-events-none"
                        checked={picked.has(p.id)}
                        readOnly
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate">{p.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {p.category}
                        {p.size_variant && ` · ${p.size_variant}`}
                        {!isInternalBarcode(p.barcode) && ` · ${p.barcode}`}
                      </div>
                    </div>
                    <div className="text-right whitespace-nowrap text-xs">
                      <div className="font-bold text-sm tabular-nums">{peso(p.retail_price)}</div>
                      <div className="text-slate-500 tabular-nums">
                        WS {peso(p.wholesale_price)} · Last {p.suki_price ? peso(p.suki_price) : "—"}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-center text-sm text-slate-400 py-8">No products</p>}
      </div>

      {/* Bulk delete bar — sits above the bottom navigation. */}
      {picking && picked.size > 0 && (
        <div className="fixed left-0 right-0 bottom-16 lg:bottom-4 z-40 px-3">
          <div className="card p-3 shadow-lg border-red-300 max-w-lg mx-auto">
            {confirmBulk ? (
              <>
                <p className="text-sm font-semibold text-red-800">
                  Delete {picked.size} product{picked.size !== 1 ? "s" : ""}?
                </p>
                <p className="text-[11px] text-red-700 mt-0.5">
                  Ones with stock or past sales are hidden instead of erased, so old receipts still add up. Every branch
                  sees this.
                </p>
                <div className="flex gap-2 mt-2">
                  <button className="btn-ghost flex-1" onClick={() => setConfirmBulk(false)}>Keep them</button>
                  <button
                    className="btn-danger flex-1"
                    onClick={() => {
                      const { deleted, hidden } = deleteProducts([...picked], session.user_id);
                      setFlash(
                        `🗑 Removed ${deleted + hidden} product${deleted + hidden !== 1 ? "s" : ""}` +
                          (hidden ? ` (${hidden} kept in the records — stock or sales history)` : "")
                      );
                      leavePicking();
                    }}
                  >
                    Yes, delete
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold flex-1">{picked.size} selected</span>
                <button className="btn-ghost !py-2" onClick={leavePicking}>Cancel</button>
                <button className="btn-danger !py-2" onClick={() => setConfirmBulk(true)}>🗑 Delete</button>
              </div>
            )}
          </div>
        </div>
      )}

      {viewing && (
        <PriceDetail
          p={viewing}
          canEdit={canEdit}
          onClose={() => setViewing(null)}
          onEdit={() => { setEditing({ brand: viewing.brand, category: viewing.category }); setViewing(null); }}
        />
      )}

      {editing && (
        <BrandEditor
          brand={editing.brand}
          category={editing.category}
          items={db.products.filter(
            (p) => p.active && p.brand === editing.brand && p.category === editing.category
          )}
          onClose={() => setEditing(null)}
          onSaved={(msg, jumpTo) => { setFlash(msg); setEditing(null); setQ(jumpTo); setCat(""); }}
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
          <PriceBox label={perUnitLabel(p.category)} value={p.per_kilo ? peso(p.per_kilo) : "—"} />
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

// Edits a whole brand the way the price list reads: the brand on top, its types
// listed underneath, each type carrying its own prices and per-kilo figure.
function BrandEditor({
  brand,
  category,
  items,
  onClose,
  onSaved,
}: {
  brand: string;
  category: string;
  items: Product[];
  onClose: () => void;
  onSaved: (msg: string, jumpTo: string) => void;
}) {
  const db = useDB();
  const session = useSession();
  const categories = categoriesOf(db.products);
  const [brandInput, setBrandInput] = useState(brand);
  const [catInput, setCatInput] = useState(category);
  const [types, setTypes] = useState<Product[]>(() =>
    items.length ? items.map((p) => ({ ...p })) : [blankProduct(db.settings.low_stock_default)]
  );
  const [removed, setRemoved] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const setType = (i: number, patch: Partial<Product>) =>
    setTypes((ts) => ts.map((t, n) => (n === i ? { ...t, ...patch } : t)));

  function removeType(i: number) {
    const t = types[i];
    if (items.some((x) => x.id === t.id)) setRemoved((r) => [...r, t.id]);
    setTypes((ts) => ts.filter((_, n) => n !== i));
  }

  const NULLABLE = ["suki_price", "ord_ws_price", "per_kilo"] as const;
  type PriceKey = "retail_price" | "wholesale_price" | "suki_price" | "cost_price" | "ord_ws_price" | "per_kilo";
  const priceField = (i: number, label: string, key: PriceKey) => {
    const v = types[i][key];
    return (
      <div>
        <label className="label !text-[10px]">{label}</label>
        <input
          className="input !py-2"
          inputMode="decimal"
          defaultValue={v === null ? "" : (v / 100).toFixed(2)}
          onBlur={(e) =>
            setType(i, {
              [key]:
                (NULLABLE as readonly string[]).includes(key) && !e.target.value.trim()
                  ? null
                  : toCentavos(e.target.value),
            } as Partial<Product>)
          }
        />
      </div>
    );
  };

  const named = types.filter((t) => t.name.trim());
  const canSave = brandInput.trim() !== "" && catInput.trim() !== "" && named.length > 0;

  function save() {
    const payload = named.map((t) => ({
      ...t,
      brand: brandInput.trim(),
      category: catInput.trim(),
      name: t.name.trim(),
      active: true,
    }));
    // Types left blank were never filled in, so drop them rather than save them.
    const blanks = types.filter((t) => !t.name.trim() && items.some((x) => x.id === t.id)).map((t) => t.id);
    saveBrand(payload, [...removed, ...blanks], session!.user_id);
    // Jump the list to the brand just saved — the catalogue is long.
    onSaved(`✅ Saved ${brandInput.trim()} — ${payload.length} type${payload.length !== 1 ? "s" : ""}`, brandInput.trim());
  }

  function deleteBrand() {
    const ids = items.map((x) => x.id);
    const { deleted, hidden } = deleteProducts(ids, session!.user_id);
    onSaved(
      `🗑 Removed ${brand} — ${deleted + hidden} type${deleted + hidden !== 1 ? "s" : ""}` +
        (hidden ? ` (${hidden} kept in the records because ${hidden === 1 ? "it has" : "they have"} stock or sales history)` : ""),
      ""
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="card w-full max-w-lg max-h-[92vh] overflow-y-auto p-5 rounded-b-none sm:rounded-2xl space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-bold text-lg">{items.length ? "Edit brand" : "New brand"}</h3>

        <div>
          <label className="label">Brand name</label>
          <input
            className="input font-bold"
            placeholder="e.g. AOZI CAT"
            value={brandInput}
            onChange={(e) => setBrandInput(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="label">Category</label>
          <input className="input" list="category-options" placeholder="e.g. Cat Food Per Bag" value={catInput} onChange={(e) => setCatInput(e.target.value)} />
          <datalist id="category-options">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div className="pt-1">
          <div className="label">Types under this brand</div>
          <div className="space-y-2">
            {types.map((t, i) => (
              <div key={t.id} className="rounded-xl border border-slate-200 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    className="input font-semibold"
                    placeholder="e.g. Adult Small"
                    value={t.name}
                    onChange={(e) => setType(i, { name: e.target.value })}
                  />
                  <button
                    className="text-red-600 font-bold px-2 shrink-0"
                    title="Remove this type"
                    onClick={() => removeType(i)}
                  >
                    ✕
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {priceField(i, "Unit price", "cost_price")}
                  {priceField(i, "ORD/SUKI", "ord_ws_price")}
                  {priceField(i, "Wholesale", "wholesale_price")}
                  {priceField(i, "Last price", "suki_price")}
                  {priceField(i, "Selling price", "retail_price")}
                  {priceField(i, perUnitLabel(catInput), "per_kilo")}
                </div>
                <details>
                  <summary className="text-xs text-slate-500 cursor-pointer">More</summary>
                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <div>
                      <label className="label !text-[10px]">Barcode</label>
                      <input
                        className="input !py-2 font-mono"
                        placeholder="added later"
                        value={isInternalBarcode(t.barcode) ? "" : t.barcode}
                        onChange={(e) => setType(i, { barcode: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label !text-[10px]">Low-stock alert at</label>
                      <input
                        className="input !py-2"
                        type="number"
                        inputMode="numeric"
                        value={t.low_stock_threshold}
                        onChange={(e) => setType(i, { low_stock_threshold: parseInt(e.target.value) || 0 })}
                      />
                    </div>
                  </div>
                </details>
              </div>
            ))}
          </div>
          <button
            className="btn-secondary w-full mt-2"
            onClick={() => setTypes((ts) => [...ts, blankProduct(db.settings.low_stock_default)])}
          >
            + Add another type
          </button>
        </div>

        <div className="flex gap-2 pt-2">
          <button className="btn-ghost flex-1" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary flex-1" disabled={!canSave} onClick={save}>
            Save
          </button>
        </div>

        {items.length > 0 &&
          (confirmDelete ? (
            <div className="rounded-xl border-2 border-red-300 bg-red-50 p-3">
              <p className="text-sm font-semibold text-red-800">
                Delete {brand} and all {items.length} of its type{items.length !== 1 ? "s" : ""}?
              </p>
              <p className="text-xs text-red-700 mt-1">
                Types with stock or past sales are hidden instead of erased, so old receipts and the ledger still add up.
              </p>
              <div className="flex gap-2 mt-2">
                <button className="btn-ghost flex-1" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
                <button className="btn-danger flex-1" onClick={deleteBrand}>
                  Yes, delete
                </button>
              </div>
            </div>
          ) : (
            <button className="btn-danger w-full" onClick={() => setConfirmDelete(true)}>
              🗑 Delete this brand
            </button>
          ))}
      </div>
    </div>
  );
}
