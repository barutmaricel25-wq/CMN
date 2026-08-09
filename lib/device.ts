"use client";
// Which phone or computer is this? Given a shared password, the only way to cut
// off one device without changing it for everyone is for each device to say who
// it is — so each one keeps a random id of its own and the shop keeps a list.
//
// The id says nothing about the person holding it. It is a random string made on
// the device and kept there; nothing is read out of the phone.
import { uid } from "./util";

const ID_KEY = "cmn-device-id-v1";

export function deviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = uid();
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

// A name the owner will recognise in a list — "Android phone · Chrome". Rough on
// purpose: it only has to be enough to tell one device from another, and it can
// be renamed to whatever the shop calls it.
export function describeDevice(): string {
  if (typeof navigator === "undefined") return "Unknown device";
  const ua = navigator.userAgent;
  const kind = /iPad/i.test(ua)
    ? "iPad"
    : /iPhone/i.test(ua)
      ? "iPhone"
      : /Android/i.test(ua)
        ? /Mobile/i.test(ua) ? "Android phone" : "Android tablet"
        : /Windows/i.test(ua)
          ? "Windows PC"
          : /Macintosh/i.test(ua)
            ? "Mac"
            : /Linux/i.test(ua)
              ? "Linux PC"
              : "Computer";
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /SamsungBrowser/i.test(ua)
      ? "Samsung Internet"
      : /OPR\//i.test(ua)
        ? "Opera"
        : /Chrome\//i.test(ua)
          ? "Chrome"
          : /Firefox\//i.test(ua)
            ? "Firefox"
            : /Safari\//i.test(ua)
              ? "Safari"
              : "browser";
  return `${kind} · ${browser}`;
}
