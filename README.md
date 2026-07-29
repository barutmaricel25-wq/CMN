# CMN Pet Supply — Multi-Branch Management System (MVP)

Wholesale + retail pet supply management for **CMN Trading Corporation** (6 branches, ground-floor store + 2F stockroom each). Replaces the handwritten daily sales book, the Excel price list, untracked stockroom pulls, manual payment verification, and buddy-punched timesheets.

Built with **Next.js (App Router) + TypeScript + Tailwind CSS**, mobile-first, installable as a **PWA** on Android tablets.

---

## 🚀 Demo mode — usable right now

**This MVP ships in demo mode: no backend setup required.** All data (6 branches, 66 products, users, customers, 14 days of sales history) is seeded automatically on first load and persisted in the browser's localStorage. Every flow works end-to-end on a single device.

```bash
npm install
npm run dev        # http://localhost:3000
# production:
npm run build && npm start
```

**Sign in:** the login screen lists every demo user with their PIN visible (owner `9999`; each branch has a manager and 2 staff). Pick a person, enter the PIN.

**Reset demo data:** Admin & Settings → *Reset demo data*.

### Demo mode vs. production (Supabase)

The data layer is a single swap point (`lib/store.ts` + `lib/actions.ts`, mirrored 1:1 by the SQL schema). The complete PostgreSQL schema **with RLS policies, the movements-ledger trigger, and per-branch receipt counters** is in [`supabase/migrations/0001_schema.sql`](supabase/migrations/0001_schema.sql). To go to production:

1. Create a Supabase project; run the migration (`supabase db push` or SQL editor).
2. Create private Storage buckets: `selfies`, `payment-proofs`, `packed-photos` (signed URLs).
3. Enable Realtime on `online_orders` (uncomment the last line of the migration).
4. Create auth accounts (email/password) for the owner, managers, and one shared account per branch tablet; link them via `users.auth_user_id`, and store staff PINs as hashes in `users.pin_hash`.
5. Replace the localStorage adapter with `@supabase/supabase-js` calls + TanStack Query (the demo's action signatures — `pullDown`, `postDelivery`, `completeSale`, `setOrderStatus`, … — are designed to map 1:1 to RPC/queries).

Env vars for that step: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

> **Known demo-mode deviations from the spec** (all removed by the Supabase step): auth is a demo user picker with visible PINs; "Realtime" order-board sync works across tabs of the same browser via storage events; photos are stored as compressed data-URLs in localStorage instead of Supabase Storage; React Query is not wired since there is no network layer yet.

---

## What's implemented (all 4 phases)

| Phase | Modules |
|---|---|
| **1 — Foundation + Inventory** | Roles/branches · product catalog + 3 price tiers · Excel (.xlsx) / CSV import with per-sheet column mapping · printable price list · **two-location inventory (2F stockroom / store floor)** · **Pull-Down scan flow** · Receive Delivery (draft → post) · movements ledger (every unit traceable) · adjustments (manager PIN + reason) · stock count mode · low-stock alerts · auto seed |
| **2 — POS + Sales** | Barcode scan → cart · tier pricing from attached customer · price override + void with manager PIN · cash change calculator, GCash, bank · per-branch sequential receipts, printed via `window.print()` (58/80mm toggle) · daily sales dashboard · end-of-day report (incl. cash-in-drawer) · date-range CSV |
| **3 — Online Orders + Customers** | Kanban order board (received → … → picked up) · ≤1-minute order encoding + quick-add customer · copyable Taglish reply templates (uses your bank/GCash settings) · payment-proof upload + manager verification (marks paid ⇒ stock out + sale) · packed photo via live camera · customer profiles, history, metrics, **Repeat last order** |
| **4 — Attendance + Owner + Transfers** | Clock in/out with **forced live selfie** (getUserMedia, no gallery) + GPS geofence check (out-of-radius flagged, never rejected) · manager review + timesheet CSV · owner multi-branch dashboard (today/week/month, branch chart, top products) · branch transfers with two-sided qty confirmation + discrepancy flags · reorder suggestions (threshold × 2 − current) with PO print/CSV · audit log viewer |

## Hardware setup (tablets)

**Install as app (PWA):** open the site in Chrome on the tablet → ⋮ menu → *Add to Home screen / Install app*. Launches full-screen.

**Barcode scanner (USB/Bluetooth):** pair the scanner in **HID keyboard-wedge mode** (factory default on most units — it "types" the code + Enter). All barcode fields in the app auto-focus, submit on Enter, and refocus after each scan. Test: focus the POS scan box, scan any product — it should appear instantly.

**Receipt printer (Bluetooth thermal, 58/80mm ESC/POS):**
- *MVP path:* print via the browser dialog (`window.print()` — receipt is a print-optimized template; set paper width in Admin & Settings).
- *Android + RawBT:* install the RawBT print service app, pair the printer in RawBT, then choose RawBT as the printer in Chrome's print dialog. This gives direct ESC/POS output with proper paper cuts.

## Repository layout

```
app/                # Next.js App Router screens (all client components in demo mode)
components/         # BarcodeInput, PinModal, Receipt (print), CameraCapture, Shell
lib/                # types (data model), seed, store (demo adapter), actions (domain logic)
supabase/migrations # full PostgreSQL schema + RLS + triggers
docs/               # 1-page user guides per role
public/price-list-template.csv   # CSV import template
lib/xlsx.ts                      # dependency-free .xlsx reader (ZIP + DecompressionStream)
lib/cloud.ts                     # shared-database sync (Supabase): load, push diffs, live updates
docs/SHARED-DATABASE-SETUP.md    # how to connect all six branches to one database
```

## Roadmap (out of scope for MVP)

Customer-facing e-commerce storefront · Messenger/Viber API automation · automatic bank feed reconciliation · payroll computation · supplier portal · offline-first sync · BIR-accredited receipting.
