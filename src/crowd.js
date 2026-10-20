// Talking to the crowd-data backend (backend/Code.gs). Everything here is optional: with no API_URL the app
// works exactly as before. What's sent: the spot, the answer, and a random code for this phone (so one person
// can't report the same spot over and over). Never your location.
import { API_URL } from "./config.js";

const local = ["localhost", "127.0.0.1"].includes(location.hostname);
// On localhost, ?api=http://localhost:8787 points the app at scripts/mock-backend.mjs.
const api = () => (local && new URLSearchParams(location.search).get("api")) || API_URL;
export const crowdEnabled = () => !!api();

export function deviceId() {
  try {
    let id = localStorage.getItem("device-v1");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("device-v1", id); }
    return id;
  } catch {
    return (deviceId.fallback ||= crypto.randomUUID()); // private mode: a new code each visit
  }
}

export async function fetchBusy() {
  const r = await fetch(`${api()}?action=busy`);
  if (!r.ok) throw new Error(`busy ${r.status}`);
  return r.json();
}

// text/plain keeps the request "simple", so the browser doesn't send a CORS preflight, which Apps Script can't answer.
async function post(body) {
  const r = await fetch(api(), { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ ...body, device: deviceId() }) });
  return r.json();
}

export const sendReport = (spot, level, source, people) => post({ type: "report", spot, level, source, people });
export const sendEvent = (event, spot, detail) => post({ type: "event", event, spot, detail }).catch(() => null);
export const sendPhoto = (spot, data, caption, credit) => post({ type: "photo", spot, data, caption, credit, license: "CC BY 4.0", consent: true });

// Shrink to fit 800 × 600 (the app's photo size) and re-encode as JPEG. Drawing to a canvas keeps only the pixels,
// so GPS position, camera model and time never leave the phone. The orientation tag is applied first.
export async function preparePhoto(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, 800 / bmp.width, 600 / bmp.height);
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", 0.84));
  const data = await new Promise((ok, bad) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(",")[1]);
    fr.onerror = bad;
    fr.readAsDataURL(blob);
  });
  return { data, width: w, height: h, preview: URL.createObjectURL(blob) };
}
