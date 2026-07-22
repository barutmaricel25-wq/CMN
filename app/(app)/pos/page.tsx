"use client";
// POS: scan → cart (optimistic, instant), tier pricing from attached customer,
// cash change calculator, PIN identifies cashier per sale, receipt via window.print().
// Cart survives refresh (localStorage).
import { useEffect, useMemo, useState } from "react";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import { completeSale, priceFor, voidSale, CartLine } from "@/lib/actions";
import { peso, toCentavos } from "@/lib/util";
import { CustomerType, PaymentMethod, Product, Sale, User } from "@/lib/types";
import BarcodeInput from "@/components/BarcodeInput";
import PinModal from "@/components/PinModal";
import Receipt from "@/components/Receipt";

const CART_KEY = "cmn-pos-cart-v1";

interface CartState {
  lines: CartLine[];
  customer_id: string | null;
}

export default function POSPage() {
  const db = useDB();
  const session = useSession();
  const [cart, setCart] = useState<CartState>({ lines: [], customer_id: null });
  const [search, setSearch] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [pinStage, setPinStage] = useState<null | { method: PaymentMethod; cash: number }>(null);
  const [overridePin, setOverridePin] = useState<null | { idx: number }>(null);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [notFound, setNotFound] = useState("");
  const [voidPin, setVoidPin] = useState(false);

  // Cart persistence across refreshes
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (raw) setCart(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }, [cart]);

  const branchId = session?.branch_id ?? null;
  const customer = cart.customer_id ? db.customers.find((c) => c.id === cart.customer_id) : null;
  const tier: CustomerType = customer?.type ?? "retail";

  const storefrontQty = useMemo(() => {
    const m = new Map<string, number>();
    db.inventory
      .filter((i) => i.branch_id === branchId && i.location === "storefront")
      .forEach((i) => m.set(i.product_id, i.qty));
    return m;
  }, [db.inventory, branchId]);

  if (!session) return null;

  function addProduct(p: Product) {
    setNotFound("");
    setCart((c) => {
      const idx = c.lines.findIndex((l) => l.product_id === p.id);
      if (idx >= 0) {
        const lines = [...c.lines];
        lines[idx] = { ...lines[idx], qty: lines[idx].qty + 1 };
        return { ...c, lines };
      }
      return { ...c, lines: [...c.lines, { product_id: p.id, qty: 1, unit_price: priceFor(p, tier), tier }] };
    });
  }

  function onScan(code: string) {
    const p = db.products.find((x) => x.active && (x.barcode === code || x.sku.toLowerCase() === code.toLowerCase()));
    if (p) addProduct(p);
    else setNotFound(code);
  }

  // Re-price cart when customer/tier changes
  function attachCustomer(id: string | null) {
    const cust = id ? db.customers.find((c) => c.id === id) : null;
    const t: CustomerType = cust?.type ?? "retail";
    setCart((c) => ({
      customer_id: id,
      lines: c.lines.map((l) => {
        const p = db.products.find((pp) => pp.id === l.product_id)!;
        return { ...l, unit_price: priceFor(p, t), tier: t };
      }),
    }));
  }

  const subtotal = cart.lines.reduce((s, l) => s + l.unit_price * l.qty, 0);

  const results =
    search.trim().length >= 2
      ? db.products
          .filter(
            (p) =>
              p.active &&
              (p.name.toLowerCase().includes(search.toLowerCase()) ||
                p.brand.toLowerCase().includes(search.toLowerCase()) ||
                p.sku.toLowerCase().includes(search.toLowerCase()))
          )
          .slice(0, 8)
      : [];

  function finishSale(cashier: User, method: PaymentMethod) {
    const sale = completeSale({
      branch_id: branchId!,
      channel: "onsite",
      customer_id: cart.customer_id,
      cashier_id: cashier.id,
      lines: cart.lines,
      discount: 0,
      payment_method: method,
    });
    setLastSale(sale);
    setCart({ lines: [], customer_id: null });
    setPayOpen(false);
    setPinStage(null);
  }

  return (
    <div className="space-y-3">
      {/* Scan + search */}
      <div className="card p-3 space-y-2">
        <BarcodeInput onScan={onScan} />
        {notFound && (
          <p className="text-sm text-red-600 font-semibold">No product with barcode “{notFound}”.</p>
        )}
        <input
          className="input"
          placeholder="Or search by name / brand / SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {results.length > 0 && (
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
            {results.map((p) => (
              <button
                key={p.id}
                className="w-full text-left px-3 py-2.5 hover:bg-orange-50 flex justify-between items-center"
                onClick={() => { addProduct(p); setSearch(""); }}
              >
                <span className="text-sm">
                  {p.name} <span className="text-slate-400">{p.size_variant}</span>
                  <span className={`ml-2 text-xs ${ (storefrontQty.get(p.id) ?? 0) <= 0 ? "text-red-600 font-bold" : "text-slate-400"}`}>
                    SF: {storefrontQty.get(p.id) ?? 0}
                  </span>
                </span>
                <span className="font-bold text-sm">{peso(priceFor(p, tier))}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Customer / tier */}
      <div className="card p-3 flex items-center gap-2">
        <span className="text-xl">👤</span>
        <select
          className="input flex-1"
          value={cart.customer_id ?? ""}
          onChange={(e) => attachCustomer(e.target.value || null)}
        >
          <option value="">Walk-in (retail price)</option>
          {db.customers.filter((c) => c.active).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} — {c.type}
            </option>
          ))}
        </select>
        <span className={`badge ${tier === "retail" ? "bg-slate-200 text-slate-700" : tier === "suki" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}>
          {tier}
        </span>
      </div>

      {/* Cart */}
      <div className="card p-3">
        <h2 className="font-bold mb-2">Cart ({cart.lines.length})</h2>
        {cart.lines.length === 0 && <p className="text-sm text-slate-400 py-6 text-center">Scan an item to start a sale</p>}
        <div className="divide-y divide-slate-100">
          {cart.lines.map((l, idx) => {
            const p = db.products.find((pp) => pp.id === l.product_id)!;
            const sf = storefrontQty.get(p.id) ?? 0;
            return (
              <div key={l.product_id} className="py-2">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{p.name}</div>
                    <div className="text-xs text-slate-500">
                      {p.size_variant} · {peso(l.unit_price)} ({l.tier})
                      {l.qty > sf && <span className="text-red-600 font-bold ml-1">⚠ only {sf} on floor</span>}
                    </div>
                  </div>
                  <button className="text-slate-400 px-2" onClick={() => setCart((c) => ({ ...c, lines: c.lines.filter((_, i) => i !== idx) }))}>✕</button>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <div className="flex items-center gap-1">
                    <button className="btn-secondary !px-4 !py-1.5" onClick={() => setCart((c) => ({ ...c, lines: c.lines.map((x, i) => i === idx ? { ...x, qty: Math.max(1, x.qty - 1) } : x) }))}>−</button>
                    <span className="w-10 text-center font-bold tabular-nums">{l.qty}</span>
                    <button className="btn-secondary !px-4 !py-1.5" onClick={() => setCart((c) => ({ ...c, lines: c.lines.map((x, i) => i === idx ? { ...x, qty: x.qty + 1 } : x) }))}>+</button>
                    <button className="btn-ghost !py-1.5 text-xs" onClick={() => setOverridePin({ idx })}>✏️ price</button>
                  </div>
                  <div className="font-bold tabular-nums">{peso(l.unit_price * l.qty)}</div>
                </div>
              </div>
            );
          })}
        </div>
        {cart.lines.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-200 flex items-center justify-between">
            <span className="text-lg font-bold">Total</span>
            <span className="text-2xl font-extrabold text-orange-700 tabular-nums">{peso(subtotal)}</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button className="btn-secondary" disabled={cart.lines.length === 0} onClick={() => setCart({ lines: [], customer_id: null })}>
            Clear
          </button>
          <button className="btn-primary text-base" disabled={cart.lines.length === 0} onClick={() => setPayOpen(true)}>
            💳 Charge {peso(subtotal)}
          </button>
        </div>
      </div>

      {/* Last sale: reprint + void */}
      {lastSale && (
        <div className="card p-3 flex items-center justify-between bg-orange-50 border-orange-200">
          <div>
            <div className="font-bold text-sm">✅ Sale #{String(lastSale.receipt_no).padStart(6, "0")} — {peso(lastSale.total)}</div>
            <div className="text-xs text-slate-500">{lastSale.status === "voided" ? "VOIDED" : "Completed"}</div>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary !py-2" onClick={() => window.print()}>🖨️ Print</button>
            {lastSale.status === "completed" && (
              <button className="btn-danger !py-2" onClick={() => setVoidPin(true)}>Void</button>
            )}
          </div>
        </div>
      )}
      {lastSale && <Receipt db={db} sale={db.sales.find((s) => s.id === lastSale.id) ?? lastSale} />}

      {payOpen && (
        <PaymentSheet
          total={subtotal}
          onCancel={() => setPayOpen(false)}
          onPick={(method, cash) => setPinStage({ method, cash })}
        />
      )}

      {pinStage && (
        <PinModal
          title="Cashier PIN"
          subtitle="Identify who is completing this sale"
          branch_id={branchId}
          onCancel={() => setPinStage(null)}
          onSuccess={(u) => finishSale(u, pinStage.method)}
        />
      )}

      {voidPin && lastSale && (
        <PinModal
          title="Manager PIN required"
          subtitle="Void sale — stock will be returned"
          managerOnly
          branch_id={branchId}
          onCancel={() => setVoidPin(false)}
          onSuccess={(mgr) => {
            const reason = window.prompt("Reason for void?") || "no reason given";
            voidSale(lastSale.id, mgr.id, reason);
            setLastSale({ ...lastSale, status: "voided" });
            setVoidPin(false);
          }}
        />
      )}

      {overridePin !== null && (
        <PinModal
          title="Manager PIN required"
          subtitle="Price override"
          managerOnly
          branch_id={branchId}
          onCancel={() => setOverridePin(null)}
          onSuccess={() => {
            const l = cart.lines[overridePin.idx];
            const p = db.products.find((pp) => pp.id === l.product_id)!;
            const v = window.prompt(`New price for ${p.name} (current ${peso(l.unit_price)}):`);
            if (v) {
              const cents = toCentavos(v);
              if (cents > 0)
                setCart((c) => ({ ...c, lines: c.lines.map((x, i) => (i === overridePin.idx ? { ...x, unit_price: cents } : x)) }));
            }
            setOverridePin(null);
          }}
        />
      )}
    </div>
  );
}

function PaymentSheet({
  total,
  onPick,
  onCancel,
}: {
  total: number;
  onPick: (method: PaymentMethod, cashGiven: number) => void;
  onCancel: () => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [cash, setCash] = useState("");
  const cashC = toCentavos(cash || "0");
  const change = cashC - total;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-1">Payment</h3>
        <div className="text-3xl font-extrabold text-orange-700 mb-4 tabular-nums">{peso(total)}</div>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {(["cash", "gcash", "bank_transfer"] as PaymentMethod[]).map((m) => (
            <button
              key={m}
              className={`btn ${method === m ? "bg-orange-700 text-white" : "bg-white border border-slate-300"}`}
              onClick={() => setMethod(m)}
            >
              {m === "cash" ? "💵 Cash" : m === "gcash" ? "📱 GCash" : "🏦 Bank"}
            </button>
          ))}
        </div>
        {method === "cash" && (
          <div className="mb-4">
            <label className="label">Cash received</label>
            <input
              className="input text-xl font-bold"
              type="number"
              inputMode="decimal"
              placeholder="0.00"
              value={cash}
              onChange={(e) => setCash(e.target.value)}
              autoFocus
            />
            <div className="grid grid-cols-4 gap-2 mt-2">
              {[20, 50, 100, 200, 500, 1000].map((b) => (
                <button key={b} className="btn-secondary !py-2 text-xs" onClick={() => setCash(String((cashC / 100 || 0) + b))}>
                  +₱{b}
                </button>
              ))}
              <button className="btn-secondary !py-2 text-xs col-span-2" onClick={() => setCash(String(total / 100))}>
                Exact
              </button>
            </div>
            <div className={`mt-3 text-lg font-bold tabular-nums ${change < 0 ? "text-red-600" : "text-orange-700"}`}>
              Change: {peso(Math.max(0, change))}
              {change < 0 && <span className="text-sm font-semibold"> (short {peso(-change)})</span>}
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={onCancel}>Cancel</button>
          <button
            className="btn-primary flex-1"
            disabled={method === "cash" && change < 0}
            onClick={() => onPick(method, cashC)}
          >
            Complete sale →
          </button>
        </div>
      </div>
    </div>
  );
}
