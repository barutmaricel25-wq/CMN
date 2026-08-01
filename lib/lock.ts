"use client";
// The shop password: one password for the whole business, asked once per device
// before the sign-in screen.
//
// What it is for: the app lives at a public web address, so anyone handed the
// link can reach it. This stops them at the door. It is not a substitute for
// per-person accounts — the Supabase keys still sit inside the page — and the
// setup notes say so plainly.
//
// The password itself is never stored, here or in the shared database. What is
// stored is a PBKDF2-SHA256 derivation of it with a random salt, so a copy of
// the settings does not hand anyone the password.

const ITERATIONS = 100_000;
const UNLOCK_KEY = "cmn-shop-unlock-v1";

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function subtle(): SubtleCrypto {
  const c = typeof crypto !== "undefined" ? crypto.subtle : undefined;
  if (!c) {
    // Browsers only offer this over https (or localhost). The app is served
    // over https, so this is a "something is very wrong" case, not a normal one.
    throw new Error("This browser cannot check the password. Open the app over https.");
  }
  return c;
}

async function derive(password: string, salt: Uint8Array): Promise<string> {
  const key = await subtle().importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle().deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    key,
    256
  );
  return b64(bits);
}

// Stored form: "v1:<iterations>:<salt>:<derived>" — self-describing, so the
// work factor can be raised later without stranding passwords already set.
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt);
  return `v1:${ITERATIONS}:${b64(salt.buffer)}:${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = (stored || "").split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const salt = unb64(parts[2]);
  const key = await subtle().importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle().deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: Number(parts[1]) || ITERATIONS, hash: "SHA-256" },
    key,
    256
  );
  return b64(bits) === parts[3];
}

// ---------- Which devices have been let in ----------
// A device remembers the exact stored value it was let in against. Change the
// password and every device stops matching, which is what makes "change it" the
// way to shut someone out.

export function isUnlocked(stored: string): boolean {
  if (typeof window === "undefined") return false;
  if (!stored) return true; // no password set — nothing to unlock
  try {
    return localStorage.getItem(UNLOCK_KEY) === stored;
  } catch {
    return false;
  }
}

export function markUnlocked(stored: string) {
  try {
    localStorage.setItem(UNLOCK_KEY, stored);
  } catch {
    /* private browsing — they will be asked again next time */
  }
}

export function forgetUnlock() {
  try {
    localStorage.removeItem(UNLOCK_KEY);
  } catch {
    /* nothing to do */
  }
}
