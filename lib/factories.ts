// Blank-record factories so every screen creates fully-formed rows.
import { Customer, Expense, PayrollRecord, PDCCheck, Product, User } from "./types";
import { uid, manilaDateKey } from "./util";

export function blankUser(branch_id: string | null): User {
  return {
    id: uid(), name: "", role: "staff", branch_id, pin: "0000", active: true,
    contact_number: "", address: "", sss_id: "", philhealth_id: "", pagibig_id: "",
    birthday: "", hired_date: manilaDateKey(),
    salary_rate: 0, daily_rate: 0, hourly_rate: 0,
  };
}

export function blankCustomer(branch_id = ""): Customer {
  return {
    id: uid(), branch_id, name: "", phone: "", cp_number: "", type: "retail", address: "", notes: "",
    active: true, payment_terms: "cash", pdc_terms: "none",
  };
}

// A product a record still points at but the price list no longer has —
// deleted, or cleared out with the demo data. Records outlive products, so
// every screen has to be able to draw one; without this they threw and took the
// whole page down with them.
export function missingProduct(id: string): Product {
  return {
    id,
    sku: "",
    barcode: "",
    name: "Removed from the price list",
    brand: "",
    category: "",
    unit: "",
    size_variant: "",
    cost_price: 0,
    ord_ws_price: null,
    wholesale_price: 0,
    suki_price: null,
    retail_price: 0,
    per_kilo: null,
    low_stock_threshold: 0,
    image_url: null,
    active: false,
  };
}

export function blankProduct(lowStockDefault: number): Product {
  return {
    id: uid(), sku: "", barcode: "", name: "", brand: "", category: "dry food",
    unit: "pc", size_variant: "",
    cost_price: 0, ord_ws_price: null, wholesale_price: 0, suki_price: null,
    retail_price: 0, per_kilo: null,
    low_stock_threshold: lowStockDefault, image_url: null, active: true,
  };
}

export function blankExpense(branch_id: string, recorded_by: string): Expense {
  return {
    id: uid(), branch_id, category: "daily expenses", amount: 0, note: "",
    date: manilaDateKey(), recorded_by, created_at: new Date().toISOString(),
  };
}

export function blankPDC(branch_id: string): PDCCheck {
  return {
    id: uid(), direction: "payable", party_name: "", customer_id: null, delivery_id: null,
    branch_id, check_number: "", bank: "", amount: 0,
    date_issued: manilaDateKey(), due_date: manilaDateKey(),
    status: "pending", note: "", created_at: new Date().toISOString(),
  };
}

export function blankPayroll(user_id: string, branch_id: string, created_by: string): PayrollRecord {
  return {
    id: uid(), user_id, branch_id,
    period_start: manilaDateKey(), period_end: manilaDateKey(),
    daily_rate: 0, hourly_rate: 0,
    days_worked: 0, days_absent: 0,
    days_late: 0, late_minutes: 0, days_off: 0,
    sss_contribution: 0, philhealth_contribution: 0, pagibig_contribution: 0,
    sss_loan: 0, advance_salary: 0, total_pay: 0, note: "", created_by,
    created_at: new Date().toISOString(),
  };
}
