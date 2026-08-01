"use client";
// Encode an online order in under a minute: pick/quick-add customer,
// scan/search items, tier price auto-applied.
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useDB, tx } from "@/lib/store";
import { useSession } from "@/lib/session";
import { createOnlineOrder, priceFor } from "@/lib/actions";
import { peso, uid } from "@/lib/util";
import { blankCustomer } from "@/lib/factories";
import { CustomerType, OnlineOrderItem, OrderSource, PaymentMethod } from "@/lib/types";
import BarcodeInput from "@/components/BarcodeInput";
import CustomerPicker from "@/components/CustomerPicker";

function NewOrderInner() {
  const db = useDB();
  const session = useSession();
  const router = useRouter();
  const params = useSearchParams();

  const [customerId, setCustomerId] = useState(params.get("customer") ?? "");
  const [source, setSource] = useState<OrderSource>("messenger");
  const [payment, setPayment] = useState<PaymentMethod>("gcash");
  const [items, setItems] = useState<OnlineOrderItem[]>(() => {
    // "Repeat last order" prefill from customer profile
    const repeat = params.get("repeat");
    if (!repeat) return [];
    try { return JSON.parse(decodeURIComponent(repeat)) as OnlineOrderItem[]; } catch { return []; }
  });
  const [search, setSearch] = useState("");
  const [courierNote, setCourierNote] = useState("");
  const [quickAdd, setQuickAdd] = useState(false);
  const [qaName, setQaName] = useState("");
  const [qaPhone, setQaPhone] = useState("");
  const [qaType, setQaType] = useState<CustomerType>("retail");

  if (!session) return null;
  const branchId = session.branch_id!;
  const customer = db.customers.find((c) => c.id === customerId);
  const tier: CustomerType = customer?.type ?? "retail";

  function addItem(pid: string) {
    const p = db.products.find((x) => x.id === pid)!;
    setItems((list) => {
      const i = list.findIndex((x) => x.product_id === pid);
      if (i >= 0) return list.map((x, k) => (k === i ? { ...x, qty: x.qty + 1 } : x));
      return [...list, { product_id: pid, qty: 1, unit_price: priceFor(p, tier) }];
    });
    setSearch("");
  }

  function onScan(code: string) {
    const p = db.products.find((x) => x.active && (x.barcode === code || x.sku.toLowerCase() === code.toLowerCase()));
    if (p) addItem(p.id);
  }

  // Re-price when customer changes
  function pickCustomer(id: string) {
    setCustomerId(id);
    const c = db.customers.find((x) => x.id === id);
    const t: CustomerType = c?.type ?? "retail";
    setItems((list) =>
      list.map((x) => ({ ...x, unit_price: priceFor(db.products.find((p) => p.id === x.product_id)!, t) }))
    );
  }

  const total = items.reduce((s, i) => s + i.unit_price * i.qty, 0);
  const results = search.trim().length >= 2
    ? db.products.filter((p) => p.active && (p.name.toLowerCase().includes(search.toLowerCase()) || p.brand.toLowerCase().includes(search.toLowerCase()))).slice(0, 6)
    : [];

  return (
    <div className="space-y-3">
      <h1 className="font-bold text-lg">📝 New Online Order</h1>

      <div className="card p-3 space-y-2">
        <div className="flex gap-2">
          <CustomerPicker branchId={branchId} value={customerId || null} onPick={(id) => pickCustomer(id ?? "")} />
          <button className="btn-secondary" onClick={() => setQuickAdd(!quickAdd)}>+ New</button>
        </div>
        {quickAdd && (
          <div className="border border-slate-200 rounded-xl p-3 space-y-2">
            <input className="input" placeholder="Customer name" value={qaName} onChange={(e) => setQaName(e.target.value)} />
            <div className="flex gap-2">
              <div className="flex-1">
                <input className="input" placeholder="Phone" value={qaPhone} onChange={(e) => setQaPhone(e.target.value)} />
              </div>
              <div className="w-36">
                <select className="input" value={qaType} onChange={(e) => setQaType(e.target.value as CustomerType)}>
                  <option value="retail">Online Reseller</option>
                  <option value="suki">Suki</option>
                  <option value="wholesaler">Wholesaler</option>
                </select>
              </div>
            </div>
            <button
              className="btn-primary w-full !py-2"
              disabled={!qaName.trim()}
              onClick={() => {
                const id = uid();
                tx((d) => d.customers.push({ ...blankCustomer(branchId), id, name: qaName.trim(), phone: qaPhone.trim(), type: qaType }));
                pickCustomer(id);
                setQuickAdd(false); setQaName(""); setQaPhone("");
              }}
            >
              Save customer
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <select className="input" value={source} onChange={(e) => setSource(e.target.value as OrderSource)}>
            {(["messenger", "viber", "sms", "call", "order_form"] as OrderSource[]).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input" value={payment} onChange={(e) => setPayment(e.target.value as PaymentMethod)}>
            <option value="gcash">GCash</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="cash">Cash on pickup</option>
          </select>
          <span className={`badge self-center ${tier === "retail" ? "bg-slate-200 text-slate-700" : tier === "suki" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}>{tier}</span>
        </div>
      </div>

      <div className="card p-3 space-y-2">
        <BarcodeInput onScan={onScan} placeholder="Type barcode / SKU, then Enter" />
        <input className="input" placeholder="Search items…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {results.map((p) => (
          <button key={p.id} className="btn-secondary w-full justify-between" onClick={() => addItem(p.id)}>
            <span className="text-sm truncate">{p.name} {p.size_variant}</span>
            <span className="font-bold text-sm">{peso(priceFor(p, tier))}</span>
          </button>
        ))}
        <div className="divide-y divide-slate-100">
          {items.map((i, k) => {
            const p = db.products.find((pp) => pp.id === i.product_id)!;
            return (
              <div key={k} className="py-2 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{p.name} {p.size_variant}</div>
                  <div className="text-xs text-slate-500">{peso(i.unit_price)} each</div>
                </div>
                <button className="btn-secondary !px-3 !py-1" onClick={() => setItems((l) => l.map((x, j) => j === k ? { ...x, qty: Math.max(1, x.qty - 1) } : x))}>−</button>
                <span className="w-8 text-center font-bold tabular-nums">{i.qty}</span>
                <button className="btn-secondary !px-3 !py-1" onClick={() => setItems((l) => l.map((x, j) => j === k ? { ...x, qty: x.qty + 1 } : x))}>+</button>
                <button className="text-slate-400 px-1" onClick={() => setItems((l) => l.filter((_, j) => j !== k))}>✕</button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card p-3 space-y-2">
        <input className="input" placeholder="Courier note (optional) — e.g. Lalamove 3pm" value={courierNote} onChange={(e) => setCourierNote(e.target.value)} />
        <div className="flex justify-between items-center">
          <span className="font-bold">Total</span>
          <span className="text-xl font-extrabold text-orange-700 tabular-nums">{peso(total)}</span>
        </div>
        <button
          className="btn-primary w-full text-base"
          disabled={!customerId || items.length === 0}
          onClick={() => {
            createOnlineOrder({ branch_id: branchId, customer_id: customerId, source, items, payment_method: payment, courier_note: courierNote, by: session.user_id });
            router.push("/orders");
          }}
        >
          Create order → board
        </button>
      </div>
    </div>
  );
}

export default function NewOrderPage() {
  return (
    <Suspense fallback={null}>
      <NewOrderInner />
    </Suspense>
  );
}
