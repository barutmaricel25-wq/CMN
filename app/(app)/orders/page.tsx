"use client";
// Online order board: kanban matching the status flow. Cross-tab sync in demo
// mode via the storage event (stand-in for Supabase Realtime).
import { useRef, useState } from "react";
import Link from "next/link";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import { setOrderStatus, attachOrderPhoto } from "@/lib/actions";
import { peso, fmtDateTime, compressImage } from "@/lib/util";
import { OnlineOrder, OrderStatus } from "@/lib/types";
import PinModal from "@/components/PinModal";
import CameraCapture from "@/components/CameraCapture";

const FLOW: OrderStatus[] = ["received", "preparing", "ready_awaiting_payment", "payment_review", "paid", "packed", "picked_up"];
const LABEL: Record<OrderStatus, string> = {
  received: "📥 Received",
  preparing: "🧺 Preparing",
  ready_awaiting_payment: "⏳ Ready — awaiting payment",
  payment_review: "🔍 Payment review",
  paid: "✅ Paid",
  packed: "📦 Packed",
  picked_up: "🛵 Picked up",
  cancelled: "✖ Cancelled",
};

export default function OrdersPage() {
  const db = useDB();
  const session = useSession();
  const [openOrder, setOpenOrder] = useState<string | null>(null);

  if (!session) return null;
  const branchId = session.branch_id;

  const orders = db.online_orders
    .filter((o) => o.branch_id === branchId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const open = openOrder ? orders.find((o) => o.id === openOrder) : null;

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h1 className="font-bold text-lg">📦 Online Orders</h1>
        <Link href="/orders/new" className="btn-primary !py-2">+ New order</Link>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4">
        {FLOW.map((status) => {
          const col = orders.filter((o) => o.status === status);
          return (
            <div key={status} className="w-60 shrink-0">
              <div className="text-xs font-bold uppercase text-slate-500 mb-1.5">
                {LABEL[status]} <span className="text-slate-400">({col.length})</span>
              </div>
              <div className="space-y-2 min-h-16">
                {col.map((o) => {
                  const cust = db.customers.find((c) => c.id === o.customer_id);
                  return (
                    <button key={o.id} className="card w-full text-left p-3 hover:border-orange-500" onClick={() => setOpenOrder(o.id)}>
                      <div className="font-semibold text-sm truncate">{cust?.name ?? "Customer"}</div>
                      <div className="text-xs text-slate-500">{o.items.length} items · {peso(o.total)}</div>
                      <div className="text-[10px] text-slate-400 mt-1">{o.source} · {fmtDateTime(o.created_at)}</div>
                      {o.payment_proof_url && status === "payment_review" && <div className="text-[10px] text-amber-700 font-bold mt-1">📎 proof attached</div>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {open && <OrderSheet order={open} onClose={() => setOpenOrder(null)} />}
    </div>
  );
}

function OrderSheet({ order, onClose }: { order: OnlineOrder; onClose: () => void }) {
  const db = useDB();
  const session = useSession()!;
  const [verifyPin, setVerifyPin] = useState(false);
  const [camera, setCamera] = useState(false);
  const [copied, setCopied] = useState("");
  const proofInput = useRef<HTMLInputElement>(null);

  const cust = db.customers.find((c) => c.id === order.customer_id);
  const idx = FLOW.indexOf(order.status);
  const next = idx >= 0 && idx < FLOW.length - 1 ? FLOW[idx + 1] : null;
  const me = session.user_id;

  // Copyable reply templates — solves slow replies without chat API integration.
  const itemLines = order.items
    .map((i) => {
      const p = db.products.find((pp) => pp.id === i.product_id);
      return `• ${i.qty}x ${p?.name} ${p?.size_variant} — ${peso(i.unit_price * i.qty)}`;
    })
    .join("\n");
  const templates: Record<string, string> = {
    "Order confirmation": `Hi ${cust?.name}! Confirmed po ang order niyo:\n${itemLines}\nTOTAL: ${peso(order.total)}\nSalamat po! — CMN Trading Corporation`,
    "Ready for payment": `Hi ${cust?.name}! Ready na po ang order niyo (${peso(order.total)}).\nSend po ng screenshot pag nakabayad na. Salamat!`,
    "Paid — book courier": `Payment received po, salamat! ${peso(order.total)} ✅\nPacked na po ang order niyo — pwede na po mag-book ng courier (Lalamove/Grab) papunta sa store. Ingat po!`,
  };

  function copy(name: string) {
    navigator.clipboard?.writeText(templates[name]).then(() => {
      setCopied(name);
      setTimeout(() => setCopied(""), 1500);
    });
  }

  function advance(status: OrderStatus) {
    // paid needs manager verification (PIN); packed needs a photo first.
    if (status === "paid") { setVerifyPin(true); return; }
    if (status === "packed" && !order.packed_photo_url) { setCamera(true); return; }
    setOrderStatus(order.id, status, me);
  }

  async function onProofFile(f: File | null) {
    if (!f) return;
    const dataUrl = await compressImage(f, 480, 0.6);
    attachOrderPhoto(order.id, "payment_proof_url", dataUrl);
    if (order.status === "ready_awaiting_payment") setOrderStatus(order.id, "payment_review", me);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 rounded-b-none sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-2">
          <div>
            <h3 className="font-bold text-lg">{cust?.name}</h3>
            <div className="text-xs text-slate-500">{cust?.phone} · via {order.source} · {fmtDateTime(order.created_at)}</div>
          </div>
          <span className="badge bg-orange-100 text-orange-800">{LABEL[order.status]}</span>
        </div>

        <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl mb-3">
          {order.items.map((i, k) => {
            const p = db.products.find((pp) => pp.id === i.product_id);
            return (
              <div key={k} className="px-3 py-2 flex justify-between text-sm">
                <span className="truncate mr-2">{i.qty} × {p?.name} {p?.size_variant}</span>
                <span className="font-semibold tabular-nums">{peso(i.unit_price * i.qty)}</span>
              </div>
            );
          })}
          <div className="px-3 py-2 flex justify-between font-bold">
            <span>Total ({order.payment_method.replace("_", " ")})</span>
            <span className="tabular-nums">{peso(order.total)}</span>
          </div>
        </div>

        {order.courier_note && <p className="text-xs text-slate-500 mb-2">🛵 {order.courier_note}</p>}

        {/* Payment proof */}
        <div className="mb-3">
          <div className="label">Payment proof</div>
          {order.payment_proof_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={order.payment_proof_url} alt="payment proof" className="rounded-xl max-h-48 border border-slate-200" />
          ) : (
            <button className="btn-secondary w-full" onClick={() => proofInput.current?.click()}>📎 Attach transfer screenshot</button>
          )}
          <input ref={proofInput} type="file" accept="image/*" hidden onChange={(e) => onProofFile(e.target.files?.[0] ?? null)} />
        </div>

        {/* Packed photo */}
        {(order.status === "paid" || order.packed_photo_url) && (
          <div className="mb-3">
            <div className="label">Packed photo (required before “packed”)</div>
            {order.packed_photo_url ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={order.packed_photo_url} alt="packed order" className="rounded-xl max-h-48 border border-slate-200" />
            ) : (
              <button className="btn-secondary w-full" onClick={() => setCamera(true)}>📷 Take packed photo</button>
            )}
          </div>
        )}

        {/* Message templates */}
        <div className="label">Copy reply (paste into Messenger/Viber/SMS)</div>
        <div className="grid grid-cols-1 gap-1.5 mb-4">
          {Object.keys(templates).map((name) => (
            <button key={name} className="btn-secondary !py-2 justify-between text-xs" onClick={() => copy(name)}>
              <span>💬 {name}</span>
              <span className="text-orange-700 font-bold">{copied === name ? "Copied!" : "Copy"}</span>
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          {order.status !== "picked_up" && order.status !== "cancelled" && (
            <button className="btn-ghost text-red-600" onClick={() => { if (window.confirm("Cancel this order?")) { setOrderStatus(order.id, "cancelled", me); onClose(); } }}>
              Cancel order
            </button>
          )}
          <div className="flex-1" />
          {next && (
            <button className="btn-primary" onClick={() => advance(next)}>
              {next === "paid" ? "✅ Verify payment → Paid" : `→ ${LABEL[next]}`}
            </button>
          )}
        </div>

        {verifyPin && (
          <PinModal
            title="Manager PIN — verify payment"
            subtitle="Marks paid, decrements stock, creates the sale"
            managerOnly
            branch_id={order.branch_id}
            onCancel={() => setVerifyPin(false)}
            onSuccess={(mgr) => { setOrderStatus(order.id, "paid", mgr.id); setVerifyPin(false); }}
          />
        )}

        {camera && (
          <CameraCapture
            title="Packed order photo"
            facing="environment"
            onCancel={() => setCamera(false)}
            onCapture={(dataUrl) => {
              attachOrderPhoto(order.id, "packed_photo_url", dataUrl);
              setOrderStatus(order.id, "packed", me);
              setCamera(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
