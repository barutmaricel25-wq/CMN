"use client";
// Demo session: which user + branch this device is signed in as.
// Real deployment: Supabase Auth session + branch account; PIN identifies staff.
import { useSyncExternalStore } from "react";
import { getDB } from "./store";
import { User } from "./types";

const KEY = "cmn-session-v1";
export interface Session {
  user_id: string;
  branch_id: string | null; // owner may be "all branches"
}

let cached: Session | null | undefined;
const listeners = new Set<() => void>();

function load(): Session | null {
  if (cached !== undefined) return cached;
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    cached = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function setSession(s: Session | null) {
  cached = s;
  if (typeof window !== "undefined") {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, load, () => null);
}

export function currentUser(): User | null {
  const s = load();
  if (!s) return null;
  return getDB().users.find((u) => u.id === s.user_id) ?? null;
}

// Verify a PIN belongs to a user with at least the given role at this branch.
// Returns the matching user or null. Used for privileged actions.
export function verifyPin(pin: string, opts: { managerOnly?: boolean; branch_id?: string | null } = {}): User | null {
  const db = getDB();
  const match = db.users.find((u) => {
    if (!u.active || u.pin !== pin) return false;
    if (opts.managerOnly && u.role === "staff") return false;
    if (
      opts.branch_id &&
      u.role !== "owner" &&
      u.branch_id !== opts.branch_id
    )
      return false;
    return true;
  });
  return match ?? null;
}
