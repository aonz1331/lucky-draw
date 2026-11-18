// Lucky Draw API — Netlify Functions (v2) + Netlify Blobs
// ตั้งค่า Environment variable ใน Netlify: ADMIN_PIN = รหัสผู้ดูแล
import { getStore } from "@netlify/blobs";

export const config = { path: "/api" };

const AVATAR_COUNT = 20;
const store = () => getStore({ name: "luckydraw", consistency: "strong" });

const json = (d, status = 200) =>
  new Response(JSON.stringify(d), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
class UserError extends Error {}
const fail = (m) => { throw new UserError(m); };

const b64 = (s) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s) => Buffer.from(s, "base64url").toString("utf8");
const mask = (p) => (p.length >= 9 ? p.slice(0, 3) + "-xxx-" + p.slice(-4) : p);

function checkPin(pin) {
  const real = process.env.ADMIN_PIN || "1234";
  if (String(pin ?? "") !== String(real)) fail("รหัสผู้ดูแลไม่ถูกต้อง");
}
const getEvent = (st) => st.get("event", { type: "json" });

/* รายชื่อเก็บไว้ในชื่อ key เพื่อให้ list() ครั้งเดียวได้ข้อมูลครบ:
   ord/<eventId>/<ts13>_<rand>_<avatar>_<p3>_<p4>_<base64url(name)> */
async function readList(st, ev) {
  if (!ev) return [];
  const prefix = `ord/${ev.id}/`;
  const { blobs } = await st.list({ prefix });
  const rows = blobs.map(({ key }) => {
    const parts = key.slice(prefix.length).split("_");
    return {
      key,
      ts: Number(parts[0]),
      rnd: parts[1],
      avatar: Number(parts[2]) || 0,
      phone: `${parts[3]}-xxx-${parts[4]}`,
      name: unb64(parts.slice(5).join("_")),
    };
  });
  rows.sort((a, b) => a.ts - b.ts || (a.rnd < b.rnd ? -1 : 1));
  rows.forEach((r, i) => (r.no = i + 1));
  return rows;
}
const pub = (r) => ({ no: r.no, name: r.name, phone: r.phone, avatar: r.avatar, ts: r.ts, round: r.round });

async function state(st) {
  const ev = await getEvent(st);
  const list = await readList(st, ev);
  const winners = ev ? (await st.get(`win/${ev.id}`, { type: "json" })) || [] : [];
  const byKey = Object.fromEntries(list.map((r) => [r.key, r]));
  return {
    now: Date.now(),
    event: ev,
    open: !!(ev && Date.now() < ev.endAt),
    list: list.map(pub),
    winners: winners.map((w) => {
      const r = byKey[w.key] || w;
      return { round: w.round, no: r.no, name: r.name, phone: r.phone, avatar: r.avatar };
    }),
  };
}

const actions = {
  ping: async () => ({ ok: true }),

  verifyPin: async (st, pin) => { checkPin(pin); return { ok: true }; },

  getState: (st) => state(st),

  // หน้ามือถือเรียกทุกไม่กี่วินาที: อ่านแค่ event + winners (ไม่ list รายชื่อ)
  getStatus: async (st, token) => {
    const ev = await getEvent(st);
    const now = Date.now();
    const open = !!(ev && now < ev.endAt);
    let winners = [], pending = false, me = null;
    if (ev && !open) {
      const all = (await st.get(`win/${ev.id}`, { type: "json" })) || [];
      const revealed = all.filter((w) => !w.revealAt || w.revealAt <= now); // ไม่ให้มือถือรู้ผลก่อนจอใหญ่
      pending = revealed.length < all.length;
      winners = revealed.map((w) => ({ round: w.round, name: w.name, avatar: w.avatar }));
      const mine = token ? revealed.find((w) => w.key === String(token)) : null;
      if (mine) me = { round: mine.round };
    }
    return { now, event: ev ? { id: ev.id, title: ev.title, endAt: ev.endAt } : null, open, pending, winners, me };
  },

  startEvent: async (st, pin, title, minutes) => {
    checkPin(pin);
    minutes = Math.max(0.5, Math.min(240, Number(minutes) || 5));
    const now = Date.now();
    await st.setJSON("event", {
      id: "E" + now,
      title: String(title || "ลงทะเบียนร่วมกิจกรรม").slice(0, 80),
      startAt: now,
      endAt: now + minutes * 60000,
    });
    return state(st);
  },

  addMinutes: async (st, pin, m) => {
    checkPin(pin);
    const ev = (await getEvent(st)) || fail("ยังไม่มีกิจกรรม");
    ev.endAt = Math.max(Date.now(), ev.endAt) + (Number(m) || 1) * 60000;
    await st.setJSON("event", ev);
    return state(st);
  },

  closeNow: async (st, pin) => {
    checkPin(pin);
    const ev = (await getEvent(st)) || fail("ยังไม่มีกิจกรรม");
    ev.endAt = Math.min(ev.endAt, Date.now());
    await st.setJSON("event", ev);
    return state(st);
  },

  resetEvent: async (st, pin) => {
    checkPin(pin);
    await st.delete("event");
    return state(st);
  },

  register: async (st, name, phone) => {
    name = String(name || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 50);
    phone = String(phone || "").replace(/\D/g, "");
    if (!name) fail("กรุณากรอกชื่อ");
    if (!/^0\d{8,9}$/.test(phone)) fail("เบอร์โทรไม่ถูกต้อง");

    const ev = (await getEvent(st)) || fail("ยังไม่เปิดลงทะเบียน");
    if (Date.now() >= ev.endAt) fail("หมดเวลาลงทะเบียนแล้ว");

    const ts = Date.now();
    const avatar = Math.floor(Math.random() * AVATAR_COUNT);
    const rnd = Math.random().toString(36).slice(2, 6);
    const ordKey = `ord/${ev.id}/${String(ts).padStart(13, "0")}_${rnd}_${avatar}_${phone.slice(0, 3)}_${phone.slice(-4)}_${b64(name)}`;
    const phoneKey = `phone/${ev.id}/${phone}`;

    // onlyIfNew = กันเบอร์ซ้ำแบบ atomic
    const { modified } = await st.setJSON(phoneKey, { name, phone, ts, avatar, ordKey }, { onlyIfNew: true });
    if (!modified) {
      const ex = await st.get(phoneKey, { type: "json" });
      const list = await readList(st, ev);
      const me = list.find((r) => r.key === ex?.ordKey);
      return { already: true, no: me?.no ?? "-", name: ex?.name ?? name, avatar: ex?.avatar ?? 0, eventId: ev.id, token: ex?.ordKey };
    }
    await st.set(ordKey, "1");
    const list = await readList(st, ev);
    const me = list.find((r) => r.key === ordKey);
    return { already: false, no: me ? me.no : list.length, name, avatar, eventId: ev.id, token: ordKey };
  },

  drawWinner: async (st, pin) => {
    checkPin(pin);
    const ev = (await getEvent(st)) || fail("ยังไม่มีกิจกรรม");
    if (Date.now() < ev.endAt) fail("ยังไม่หมดเวลาลงทะเบียน");
    const list = await readList(st, ev);
    const winners = (await st.get(`win/${ev.id}`, { type: "json" })) || [];
    const taken = new Set(winners.map((w) => w.key));
    const pool = list.filter((r) => !taken.has(r.key));
    if (!pool.length) fail("ไม่มีรายชื่อเหลือให้สุ่มแล้ว");
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const round = winners.length + 1;
    // revealAt: มือถือผู้โชคดีจะรู้ผลหลังจอใหญ่เฉลย (แอนิเมชันหมุนประมาณ 6 วินาที)
    winners.push({ round, key: pick.key, no: pick.no, name: pick.name, phone: pick.phone, avatar: pick.avatar, revealAt: Date.now() + 6500 });
    await st.setJSON(`win/${ev.id}`, winners);
    return { ...pub(pick), round };
  },

  // ดาวน์โหลดรายชื่อเต็ม (เบอร์ไม่ปิดบัง) สำหรับผู้ดูแล
  exportCsv: async (st, pin) => {
    checkPin(pin);
    const ev = (await getEvent(st)) || fail("ยังไม่มีกิจกรรม");
    const list = await readList(st, ev);
    const winners = (await st.get(`win/${ev.id}`, { type: "json" })) || [];
    const roundOf = Object.fromEntries(winners.map((w) => [w.key, w.round]));
    const { blobs } = await st.list({ prefix: `phone/${ev.id}/` });
    const phoneByOrd = {};
    for (let i = 0; i < blobs.length; i += 25) {
      const part = await Promise.all(blobs.slice(i, i + 25).map((b) => st.get(b.key, { type: "json" })));
      part.forEach((p) => p && (phoneByOrd[p.ordKey] = p.phone));
    }
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["ลำดับ", "ชื่อ", "เบอร์โทร", "เวลาลงทะเบียน", "ผู้โชคดีคนที่"].map(esc).join(",")];
    list.forEach((r) => lines.push([r.no, r.name, phoneByOrd[r.key] || r.phone,
      new Date(r.ts).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }), roundOf[r.key] || ""].map(esc).join(",")));
    return { filename: `luckydraw-${ev.id}.csv`, csv: "﻿" + lines.join("\r\n") };
  },
};

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const fn = actions[body?.fn];
  if (!fn) return json({ error: "unknown action" }, 404);
  try {
    const args = Array.isArray(body.args) ? body.args : [];
    return json(await fn(store(), ...args));
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: "ระบบขัดข้อง ลองใหม่อีกครั้ง" }, 500);
  }
};
