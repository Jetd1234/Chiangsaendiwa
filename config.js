/**
 * ─────────────────────────────────────────────────────────────
 *  Chiangsaen Team — Runtime Configuration
 * ─────────────────────────────────────────────────────────────
 *  ไฟล์นี้ถูกโหลดก่อน script.js จึงแก้ค่าระบบได้โดยไม่ต้องแตะโค้ดหลัก
 *  และทำให้ deploy ขึ้น Vercel ได้โดยไม่ต้องมีขั้นตอน build
 *
 *  วิธีใช้:
 *    1) ตั้งค่า googleScriptUrl ให้เป็น URL ของ Apps Script Web App (ลงท้าย /exec)
 *    2) ตั้ง siteUrl เฉพาะกรณีที่ต้องการล็อกโดเมนจริง (เช่น "https://chiangsaen.vercel.app")
 *       ถ้าเว้นว่าง ระบบจะใช้โดเมนของหน้าที่เปิดอยู่ (window.location.origin)
 * ─────────────────────────────────────────────────────────────
 */
window.APP_CONFIG = {
  // Google Apps Script Web App (/exec) — ต้อง deploy แบบ "Anyone" (ดู README.md)
  googleScriptUrl: "https://script.google.com/macros/s/AKfycbz551qUkD2rAeqrZYkRHpCgBMybERo6xHVs8rT5hs67gl25zFIIGJYhbpcApnwLxVfl/exec",

  // ใช้สร้างลิงก์แชร์ (?order= / ?stats=) — เว้นว่าง = ใช้โดเมนปัจจุบันอัตโนมัติ
  siteUrl: "",

  // ธีมเริ่มต้นเมื่อผู้ใช้ยังไม่เคยเลือก: "dark" | "light"
  defaultTheme: "dark",

  // หมดเวลา (ms) ของคำขอปกติไปยัง backend
  requestTimeoutMs: 20000,

  // CDN ของ Tesseract.js (ใช้ตอนอ่านสลิปด้วย OCR เท่านั้น — โหลดแบบ lazy)
  tesseractCdn: "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"
};
