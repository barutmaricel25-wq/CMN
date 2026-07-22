"use client";
// Print-optimized receipt rendered into #receipt-print (see globals.css @media print).
// Works with 58mm/80mm thermal printers via browser print or RawBT on Android.
import { DB, Sale } from "@/lib/types";
import { peso, fmtDateTime } from "@/lib/util";

export default function Receipt({ db, sale }: { db: DB; sale: Sale }) {
  const branch = db.branches.find((b) => b.id === sale.branch_id);
  const cashier = db.users.find((u) => u.id === sale.cashier_id);
  const customer = sale.customer_id ? db.customers.find((c) => c.id === sale.customer_id) : null;
  const items = db.sale_items.filter((i) => i.sale_id === sale.id);
  const w = db.settings.paper_width === "80mm" ? "w80" : "w58";

  return (
    <div id="receipt-print" className={w}>
      <div style={{ textAlign: "center", fontWeight: "bold" }}>{db.settings.receipt_header}</div>
      <div style={{ textAlign: "center" }}>{branch?.name}</div>
      <div style={{ textAlign: "center" }}>{branch?.address}</div>
      <div>--------------------------------</div>
      <div>Receipt #: {String(sale.receipt_no).padStart(6, "0")}</div>
      <div>{fmtDateTime(sale.created_at)}</div>
      <div>Cashier: {cashier?.name}</div>
      {customer && <div>Customer: {customer.name} ({customer.type})</div>}
      <div>--------------------------------</div>
      {items.map((i) => {
        const p = db.products.find((pp) => pp.id === i.product_id);
        return (
          <div key={i.id}>
            <div>{p?.name} {p?.size_variant}</div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>
                {i.qty} x {peso(i.unit_price)}
              </span>
              <span>{peso(i.qty * i.unit_price)}</span>
            </div>
          </div>
        );
      })}
      <div>--------------------------------</div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Subtotal</span>
        <span>{peso(sale.subtotal)}</span>
      </div>
      {sale.discount > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Discount</span>
          <span>-{peso(sale.discount)}</span>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold" }}>
        <span>TOTAL ({db.settings.tax_label})</span>
        <span>{peso(sale.total)}</span>
      </div>
      <div>Payment: {sale.payment_method.replace("_", " ").toUpperCase()}</div>
      {sale.status === "voided" && <div style={{ fontWeight: "bold" }}>*** VOIDED ***</div>}
      <div>--------------------------------</div>
      {db.settings.receipt_footer.split("\n").map((line, i) => (
        <div key={i} style={{ textAlign: "center" }}>{line}</div>
      ))}
      <div>&nbsp;</div>
    </div>
  );
}
