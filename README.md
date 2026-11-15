# Chiangsaen Team — Order Site (Deploy บน Vercel)

เว็บสั่งซื้อเสื้อคณะเชียงแสน Class of 69 เป็น **static site ล้วน** (HTML/CSS/JS ไม่มี build step)
ข้อมูลออเดอร์ทั้งหมดวิ่งไปที่ **Google Apps Script Web App** ผ่าน `config.js`
จึง deploy ขึ้น Vercel ได้ทันทีโดยไม่ต้องมี Node runtime หรือ server ใด ๆ

---

## 1) โครงสร้างไฟล์

| ไฟล์ | หน้าที่ |
| --- | --- |
| `index.html` | หน้าเว็บหลัก (ฟอร์มสั่งซื้อ / ติดตามสถานะ / โมดัลทั้งหมด) |
| `style.css` | ธีมและเลย์เอาต์ทั้งหมด |
| `script.js` | ลอจิกหน้าบ้าน + แอดมิน (อ่านค่าจาก `config.js`) |
| `config.js` | **ค่าตั้งต้นของระบบ** — Google Apps Script URL, โดเมน, ธีม, CDN ของ OCR |
| `vercel.json` | สิทธิ์การ deploy: clean URLs, security headers, cache headers |
| `404.html` | หน้า not found (ธีมเดียวกับหน้าเว็บ) |
| `favicon.svg` | ไอคอนเว็บ |
| `assets/placeholder.svg` | รูปสำรองเมื่อสินค้ายังไม่มีรูป (แทน `via.placeholder.com` ที่ปิดบริการแล้ว) |
| `robots.txt` | บอก search engine ว่าไม่ต้องเก็บหน้า `?order=` / `?stats=` |
| `.vercelignore` | ไฟล์ที่ไม่ต้องอัปโหลดขึ้น Vercel |

---

## 2) สิ่งที่ต้องตั้งค่าก่อน deploy (สำคัญ)

### 2.1 แก้ `config.js`

```js
window.APP_CONFIG = {
  googleScriptUrl: "https://script.google.com/macros/s/XXXXXXXX/exec", // URL ของ Apps Script
  siteUrl: "",        // เว้นว่าง = ใช้โดเมนที่ deploy อัตโนมัติ
  defaultTheme: "dark"
};
```

> ถ้าเว้น `googleScriptUrl` ว่างไว้ หน้าเว็บจะขึ้นเตือน “ยังไม่ได้ตั้งค่า config.js” และปุ่มยืนยันการสั่งซื้อจะถูกปิด (กันออเดอร์หลุด)

### 2.2 ตั้งค่า Google Apps Script ให้ถูก

1. เปิดโปรเจกต์ Apps Script → **Deploy → New deployment → Web app**
2. **Execute as:** `Me`
3. **Who has access:** `Anyone` (ถ้าเลือก “Anyone with Google account” เว็บจะเรียกไม่ได้)
4. กด Deploy แล้วคัดลอก URL ที่ลงท้ายด้วย **`/exec`** ไปใส่ใน `config.js`
5. ทุกครั้งที่แก้โค้ด Apps Script ต้อง **Deploy version ใหม่** ไม่งั้นเว็บจะยังเรียกโค้ดเก่า

หมายเหตุ: สลิปและข้อมูลออเดอร์ถูกเก็บที่ฝั่ง Google (Drive/Sheet) ไม่ได้ผ่าน Vercel
ดังนั้นจึงไม่ติดลิมิต request body 4.5 MB ของ Vercel (เว็บจำกัดไฟล์สลิปไว้ 5 MB อยู่แล้ว)

---

## 3) วิธี deploy

### วิธีที่ 1 — Vercel CLI (เร็วและชัดเจนที่สุด)

```powershell
npm i -g vercel
cd "E:\website chiangsaen"
vercel login
vercel          # สร้าง Preview URL ไว้ทดสอบ
vercel --prod   # ขึ้น production
```

คำตอบที่แนะนำตอนตั้งค่า:

| คำถาม | ตอบ |
| --- | --- |
| Set up and deploy? | `Y` |
| Which scope? | เลือก account ของคุณ |
| Link to existing project? | `N` |
| What's your project's name? | เช่น `chiangsaen` |
| In which directory is your code located? | `./` |
| Want to modify these settings? | `N` (ไม่ต้องมี build command / output dir) |

### วิธีที่ 2 — ผ่าน GitHub (auto deploy ทุกครั้งที่ push)

```powershell
cd "E:\website chiangsaen"
git init
git add .
git commit -m "Chiangsaen order site for Vercel"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

จากนั้นใน Vercel: **Add New… → Project → Import Git Repository** แล้วตั้งค่า

- **Framework Preset:** `Other`
- **Build Command:** เว้นว่าง
- **Output Directory:** เว้นว่าง (ให้ใช้ root ของ repo)
- **Install Command:** เว้นว่าง

กด **Deploy** — ครั้งต่อไปแค่ `git push` เว็บก็อัปเดตเอง

### โดเมนของตัวเอง

Vercel → Project → **Settings → Domains → Add** แล้วตั้ง DNS ตามที่ Vercel บอก
ถ้าอยากให้ลิงก์แชร์ (`?order=` / `?stats=`) ชี้โดเมนจริงเสมอ ให้ใส่ `siteUrl: "https://your-domain.com"` ใน `config.js`

---

## 4) สิ่งที่แก้ในโค้ดเพื่อให้รองรับ Vercel

1. **แยก config ออกจากโค้ดหลัก** — `config.js` ถูกโหลดก่อน `script.js` ทำให้เปลี่ยน backend URL ได้โดยไม่ต้องแก้ `script.js` และไม่ต้องพึ่ง build/env ขั้นสูง
2. **กัน `localStorage` ที่ถูกบล็อก** — Safari โหมดส่วนตัว/เบราว์เซอร์ที่ปิด storage เดิมทำให้สคริปต์ล้มตั้งแต่บรรทัดแรก (หน้าเว็บขาว) ตอนนี้มี fallback เป็น memory storage
3. **โหลด Tesseract.js (OCR อ่านสลิป) แบบ lazy** — เดิมเป็น `<script>` blocking ใน `<head>` ทำให้หน้าแรกค้างถ้า CDN ช้า ตอนนี้โหลดเฉพาะตอนแนบสลิป และถ้า CDN ล่มก็ยังกดยืนยันออเดอร์ได้
4. **ลิงก์แชร์สร้างจากโดเมนจริง** — ตัด `index.html` ออกให้เข้ากับ `cleanUrls` และใช้ `siteUrl` ได้ถ้าตั้งไว้
5. **`vercel.json`** — เปิด `cleanUrls`, ใส่ security headers (nosniff / frame / referrer / permissions / HSTS) และบังคับ `Cache-Control: must-revalidate` เพื่อไม่ให้ผู้ใช้ค้างไฟล์เก่าหลัง deploy
6. **`404.html` + `favicon.svg` + `robots.txt`** — Vercel เสิร์ฟอัตโนมัติ
7. **แทน `via.placeholder.com`** ที่ปิดบริการแล้วด้วย `assets/placeholder.svg` (เดิมรูป fallback พังเป็น broken image)
8. **แจ้งเตือนเมื่อยังไม่ตั้งค่า backend** — กันการกดสั่งซื้อตอนลืมแก้ `config.js`

---

## 5) ทดสอบในเครื่องก่อน deploy

อย่าเปิดด้วย `file://` (จะโดน CORS/worker/clipboard พัง) ให้เปิดผ่าน HTTP server:

```powershell
cd "E:\website chiangsaen"
python -m http.server 8080
```

แล้วเปิด <http://localhost:8080>

---

## 6) หมายเหตุ / ตัวเลือกเพิ่มเติม

- **Cache:** ทุกไฟล์ถูกตั้ง `max-age=0, must-revalidate` เพราะไม่มี hashed filename
  ถ้าอนาคตย้ายไปใช้ระบบ build ที่มี hash ในชื่อไฟล์ ค่อยเปลี่ยนไฟล์ใน `assets` เป็น `immutable`
- **CSP (ไม่บังคับ):** ถ้าต้องการเพิ่ม Content-Security-Policy ให้ใส่ใน `vercel.json`
  โดยต้องอนุญาต `https://cdn.jsdelivr.net`, `https://script.google.com`, `https://script.googleusercontent.com`,
  `https://tessdata.projectnaptha.com`, `https://fonts.googleapis.com`, `https://fonts.gstatic.com`
  และ `'unsafe-inline'` (เพราะหน้านี้ใช้ `onclick` ใน HTML) — แนะนำทดสอบ OCR และหน้าแอดมินให้ครบก่อนใช้จริง
- **Deployment Protection:** ถ้าโปรเจกต์ Vercel เปิด Vercel Authentication ไว้ ผู้ใช้ทั่วไปจะเข้าเว็บไม่ได้
  ให้ปิดใน **Settings → Deployment Protection** (เฉพาะProduction)
- **Search engine:** `robots.txt` บล็อก URL ที่มี query string ไว้แล้ว แต่หน้าแรกยัง index ได้ตามปกติ
