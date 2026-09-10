"use client";
// POS: scan → cart (optimistic, instant), tier pricing from attached customer,
// cash change calculator, PIN identifies cashier per sale, receipt via window.print().
// Cart survives refresh (localStorage).
import { useEffect, useMemo, useState } from "react";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import { completeSale, priceFor, voidSale, CartLine } from "@/lib/actions";
import { peso, toCentavos, fmtQty, packKg, sellableByKilo, matchesSearch, searchScore, compareByBrand } from "@/lib/util";
import { CustomerType, PaymentMethod, Product, Sale, User } from "@/lib/types";
import BarcodeInput from "@/components/BarcodeInput";
import CustomerPicker from "@/components/CustomerPicker";
import PinModal from "@/components/PinModal";
import Receipt from "@/components/Receipt";
import { missingProduct } from "@/lib/factories";

const CART_KEY = "cmn-pos-cart-v1";

// Loose out of an opened sack: the line is kilos at the per-kilo price, and
// what comes off the shelf is the fraction of a sack that weight amounts to.
// Where the price list doesn't say what a sack weighs, nothing is deducted —
// better an honest gap for the stock count than an invented number.
function kiloLine(p: Product, kilos: number, tier: CustomerType): CartLine {
  const pack = packKg(p);
  const qty = Math.round(kilos * 1000) / 1000;
  return {
    product_id: p.id,
    qty,
    unit_price: p.per_kilo ?? 0,
    tier,
    by_kilo: true,
    stock_qty: pack ? Math.round((qty / pack) * 1000) / 1000 : null,
  };
}

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
  const [kiloFor, setKiloFor] = useState<{ product: Product; idx: number } | null>(null);

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
      // The same sack can be on the cart twice: two whole ones and 3 kg loose.
      // Adding a pack must never land on the loose line, or a sack becomes 1 kg.
      const idx = c.lines.findIndex((l) => l.product_id === p.id && !l.by_kilo);
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
        const p = db.products.find((pp) => pp.id === l.product_id) ?? missingProduct(l.product_id);
        // A kilo price is the same for everyone — it is not one of the tiers.
        return { ...l, unit_price: l.by_kilo ? l.unit_price : priceFor(p, t), tier: t };
      }),
    }));
  }

  const subtotal = cart.lines.reduce((s, l) => s + l.unit_price * l.qty, 0);

  const results =
    search.trim().length >= 2
      ? db.products
          .filter((p) => p.active && matchesSearch(p, search))
          // Closest match first, not whatever sorts earliest.
          .sort((a, b) => searchScore(a, search) - searchScore(b, search) || compareByBrand(a, b))
          .slice(0, 8)
      : [];

  // Changing the amount on a line keeps the shelf figure in step with it.
  function reQty(l: CartLine, p: Product, qty: number): CartLine {
    const q = Math.round(qty * 1000) / 1000;
    if (!l.by_kilo) return { ...l, qty: q };
    const pack = packKg(p);
    return { ...l, qty: q, stock_qty: pack ? Math.round((q / pack) * 1000) / 1000 : null };
  }

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
        <BarcodeInput onScan={onScan} placeholder="Type barcode / SKU, then Enter" />
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
                <span className="text-sm min-w-0">
                  {p.name} <span className="text-slate-400">{p.size_variant}</span>
                  <span className={`ml-2 text-xs ${ (storefrontQty.get(p.id) ?? 0) <= 0 ? "text-red-600 font-bold" : "text-slate-400"}`}>
                    SF: {fmtQty(storefrontQty.get(p.id) ?? 0)}
                  </span>
                </span>
                <span className="font-bold text-sm whitespace-nowrap ml-2">{peso(priceFor(p, tier))}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Customer / tier */}
      <div className="card p-3 flex items-center gap-2">
        <span className="text-xl">👤</span>
        <CustomerPicker
          branchId={branchId ?? ""}
          value={cart.customer_id}
          onPick={attachCustomer}
          walkInLabel="Walk-in (retail price)"
        />
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
            const p = db.products.find((pp) => pp.id === l.product_id) ?? missingProduct(l.product_id);
            const sf = storefrontQty.get(p.id) ?? 0;
            // A kilo line takes a fraction of a sack off the floor, so that is
            // what has to be checked against — not the kilos.
            const needs = l.by_kilo ? l.stock_qty ?? 0 : l.qty;
            const step = l.by_kilo ? 0.5 : 1;
            return (
              <div key={`${l.product_id}${l.by_kilo ? "-kg" : ""}`} className="py-2">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">
                      {p.name}
                      {l.by_kilo && <span className="badge ml-2 bg-orange-100 text-orange-800">per kilo</span>}
                    </div>
                    <div className="text-xs text-slate-500">
                      {l.by_kilo
                        ? `${peso(l.unit_price)} / kg${l.stock_qty === null ? " · stock unchanged" : ` · ${fmtQty(l.stock_qty ?? 0)} of a ${p.size_variant || "sack"}`}`
                        : `${p.size_variant} · ${peso(l.unit_price)} (${l.tier})`}
                      {needs > sf && <span className="text-red-600 font-bold ml-1">⚠ only {fmtQty(sf)} on floor</span>}
                    </div>
                  </div>
                  <button className="text-slate-400 px-2" onClick={() => setCart((c) => ({ ...c, lines: c.lines.filter((_, i) => i !== idx) }))}>✕</button>
                </div>
                {/* On a narrow phone the words push the line total off the
                    screen, so below sm the buttons are their icons alone. */}
                <div className="flex items-center justify-between gap-2 mt-1">
                  <div className="flex items-center gap-1 min-w-0">
                    <button className="btn-secondary !px-4 !py-1.5" onClick={() => setCart((c) => ({ ...c, lines: c.lines.map((x, i) => i === idx ? reQty(x, p, Math.max(step, x.qty - step)) : x) }))}>−</button>
                    <button
                      className="w-16 text-center font-bold tabular-nums"
                      onClick={() => { if (l.by_kilo) setKiloFor({ product: p, idx }); }}
                    >
                      {fmtQty(l.qty)}{l.by_kilo ? " kg" : ""}
                    </button>
                    <button className="btn-secondary !px-4 !py-1.5" onClick={() => setCart((c) => ({ ...c, lines: c.lines.map((x, i) => i === idx ? reQty(x, p, x.qty + step) : x) }))}>+</button>
                    <button className="btn-ghost !py-1.5 !px-2 text-xs" onClick={() => setOverridePin({ idx })}>✏️<span className="hidden sm:inline"> price</span></button>
                    {/* Sold loose out of an opened sack. Decided on the line,
                        where the cashier is already looking, not back in the
                        search results. */}
                    {sellableByKilo(p) &&
                      (l.by_kilo ? (
                        <button
                          className="btn-ghost !py-1.5 !px-2 text-xs"
                          onClick={() =>
                            setCart((c) => ({
                              ...c,
                              lines: c.lines.map((x, i) =>
                                i === idx
                                  ? { product_id: x.product_id, qty: 1, unit_price: priceFor(p, tier), tier }
                                  : x
                              ),
                            }))
                          }
                        >
                          📦<span className="hidden sm:inline"> whole</span>
                        </button>
                      ) : (
                        <button className="btn-ghost !py-1.5 !px-2 text-xs" onClick={() => setKiloFor({ product: p, idx })}>
                          ⚖️<span className="hidden sm:inline"> kilo</span>
                        </button>
                      ))}
                  </div>
                  <div className="font-bold tabular-nums shrink-0">{peso(Math.round(l.unit_price * l.qty))}</div>
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

      {kiloFor && (
        <KiloSheet
          product={kiloFor.product}
          already={cart.lines[kiloFor.idx]?.by_kilo ? cart.lines[kiloFor.idx].qty : 0}
          onCancel={() => setKiloFor(null)}
          onSet={(kilos) => {
            setCart((c) => ({
              ...c,
              lines: c.lines.map((x, i) =>
                i === kiloFor.idx ? kiloLine(kiloFor.product, kilos, tier) : x
              ),
            }));
            setKiloFor(null);
          }}
        />
      )}

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
            const p = db.products.find((pp) => pp.id === l.product_id) ?? missingProduct(l.product_id);
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

// How much the − and + move by. Half a kilo is the smallest amount anyone
// scoops; anything else is typed straight in.
const STEP = 0.5;

// How many kilos? Typed, or dialled up and down.
function KiloSheet({
  product,
  already,
  onSet,
  onCancel,
}: {
  product: Product;
  already: number;
  onSet: (kilos: number) => void;
  onCancel: () => void;
}) {
  const [kg, setKg] = useState(already ? String(already) : "");
  const kilos = parseFloat(kg.replace(/[^0-9.]/g, ""));
  const ok = Number.isFinite(kilos) && kilos > 0;
  const price = product.per_kilo ?? 0;
  const pack = packKg(product);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">⚖️ Sell by the kilo</h3>
        <p className="text-sm text-slate-500 mb-3">
          {product.name} {product.size_variant} — {peso(price)} per kilo
        </p>
        <label className="label">Kilos</label>
        {/* Any weight, typed or dialled. Fixed amounts were no use — a customer
            asks for what their dog eats, not for a round number. */}
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary !px-5 !py-3 text-xl"
            onClick={() => setKg(String(Math.max(0, Math.round(((ok ? kilos : 0) - STEP) * 100) / 100)))}
          >
            −
          </button>
          <input
            className="input text-2xl font-bold text-center"
            type="number"
            inputMode="decimal"
            step={STEP}
            min="0"
            placeholder="0.0"
            value={kg}
            onChange={(e) => setKg(e.target.value)}
            autoFocus
          />
          <button
            className="btn-secondary !px-5 !py-3 text-xl"
            onClick={() => setKg(String(Math.round(((ok ? kilos : 0) + STEP) * 100) / 100))}
          >
            +
          </button>
        </div>
        <div className="mt-3 text-lg font-bold tabular-nums text-orange-700">
          {ok ? `${fmtQty(kilos)} kg = ${peso(Math.round(price * kilos))}` : "—"}
        </div>
        <p className="text-xs text-slate-500 mt-1">
          {pack
            ? `Comes off the floor as ${ok ? fmtQty(Math.round((kilos / pack) * 1000) / 1000) : "part"} of a ${pack} kg sack.`
            : "The sack weight isn't on the price list, so the stock count won't change — put it right at the next count."}
        </p>
        <div className="flex gap-2 mt-4">
          <button className="btn-ghost flex-1" onClick={onCancel}>Cancel</button>
          <button className="btn-primary flex-1" disabled={!ok} onClick={() => onSet(kilos)}>
            {already ? "Set" : "Add to cart"}
          </button>
        </div>
      </div>
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
      <div className="card w-full max-w-md p-5 rounded-b-none sm:rounded-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
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
