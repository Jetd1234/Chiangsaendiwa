/* ─────────────────────────────────────────────────────────────
   CONFIG — อ่านค่าจาก config.js 
   ───────────────────────────────────────────────────────────── */
const APP_CONFIG = Object.assign({
  googleScriptUrl: "",
  siteUrl: "",
  defaultTheme: "dark",
  requestTimeoutMs: 20000,
  tesseractCdn: "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"
}, (typeof window !== "undefined" && window.APP_CONFIG) || {});

const GOOGLE_SCRIPT_URL = String(APP_CONFIG.googleScriptUrl || "").trim();
const BACKEND_READY = /^https?:\/\//i.test(GOOGLE_SCRIPT_URL);
const DEFAULT_TIMEOUT_MS = Number(APP_CONFIG.requestTimeoutMs) > 0 ? Number(APP_CONFIG.requestTimeoutMs) : 20000;

const DRAFT_KEY = "cs69_draft_v1";
const THEME_KEY = "theme";
const SESSION_KEY = "cs69_admin_session";
const ADMIN_IDLE_MS = 30 * 60 * 1000;

// LocalStorage Wrapper (สำหรับ Safari Private Mode)
const storage = (() => {
  try {
    const probe = "__cs69_probe__";
    const ls = window["localStorage"];
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return ls;
  } catch (e) {
    const mem = new Map();
    return {
      getItem: k => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => { mem.set(k, String(v)); },
      removeItem: k => { mem.delete(k); },
      get length() { return mem.size; },
      key: i => (Array.from(mem.keys())[i] ?? null)
    };
  }
})();

// ─────────────── CUSTOM MODAL ───────────────
let customModalCallback = null;
function showCustomModal(title, text, isConfirm = false, type = "success", imageUrl = null) {
  $("customModalTitle").textContent = title;
  
  let imageHtml = "";
  if (imageUrl && imageUrl.startsWith("http")) {
    imageHtml = `<div style="margin-bottom: 16px; text-align: center;">
      <a href="${imageUrl}" target="_blank">
        <img src="${imageUrl}" alt="สลิปโอนเงิน" style="max-width: 100%; max-height: 250px; border-radius: 8px; border: 2px solid var(--border-color); object-fit: contain;">
      </a>
    </div>`;
  }
  
  $("customModalText").innerHTML = imageHtml + `<div style="margin-top: 10px;">${text}</div>`;
  
  const iconBox = $("customModalIcon");
  if (type === "success") {
    iconBox.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#28a745" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
  } else if (type === "warning") {
    iconBox.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#ffc107" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
  }

  if (isConfirm) {
    $("customModalCancelBtn").style.display = "block";
  } else {
    $("customModalCancelBtn").style.display = "none";
  }
  
  $("customModal").style.display = "flex";
  
  return new Promise((resolve) => {
    customModalCallback = resolve;
  });
}

function closeCustomModal() {
  $("customModal").style.display = "none";
  if (customModalCallback) {
    customModalCallback(false);
    customModalCallback = null;
  }
}

function handleCustomModalOk() {
  $("customModal").style.display = "none";
  if (customModalCallback) {
    customModalCallback(true);
    customModalCallback = null;
  }
}

// ─────────────── STATE & PRICING ───────────────
const PRICE_RULES = { surcharge: { "2XL": 10, "3XL": 10, "4XL": 10, "5XL": 10 } };
function computePrice(basePrice, size, allow2XL) {
  const base = +basePrice || 0;
  let extra = PRICE_RULES.surcharge[size] || 0;
  if (allow2XL === false && ["2XL", "3XL", "4XL", "5XL"].includes(size)) extra = 0;
  return { base, extra, total: base + extra };
}

const state = {
  style: "เสื้อสี", price: 289, basePrice: 289, surcharge: 0, size: "M", allow2XL: true,
  selectedTeamColor: "",
  slipFile: null, slipFilename: "", slipOCR: "", slipRef: "", slipAmount: null,
  slipAmountMatched: false, slipOCRDone: false,
  idempotencyKey: null, submitLocked: false,
  adminOrders: [], adminPage: 1, adminTotalPages: 1, adminStatusFilter: "",
  publicOrders: [], lastOrderId: null, adminName: "", trackToken: null,
  pendingTrackOrderId: null, otpCooldownTimer: null
};

const $ = id => document.getElementById(id);
const toast = (msg, type) => { const t = $("toast"); t.textContent = msg; t.className = "toast show " + (type || ""); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), 2600); };
const formatTHB = n => "฿" + Number(n || 0).toLocaleString("th-TH");
const escapeHTML = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const newIdempotencyKey = () => crypto.randomUUID ? crypto.randomUUID() : "idem-" + Date.now() + "-" + Math.random().toString(36).slice(2);
const debounce = (fn, ms) => { let t; return function () { clearTimeout(t); const a = arguments, ctx = this; t = setTimeout(() => fn.apply(ctx, a), ms); }; };

// ─────────────── FETCH HELPERS ───────────────
async function fetchWithTimeout(url, options = {}, ms = DEFAULT_TIMEOUT_MS) {
  if (!BACKEND_READY) throw new Error("ยังไม่ได้ตั้งค่า googleScriptUrl ใน config.js");
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { ...options, signal: c.signal }); if (!r.ok) throw new Error("HTTP " + r.status); return r; }
  finally { clearTimeout(t); }
}
async function fetchWithRetry(url, options = {}, { retries = 2, ms = 20000, backoff = 800 } = {}) {
  let last;
  for (let i = 0; i <= retries; i++) {
    try { return await fetchWithTimeout(url, options, ms); }
    catch (err) { last = err; if (i < retries) await new Promise(r => setTimeout(r, backoff * (i + 1))); }
  }
  throw last;
}
function fileToBase64_(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result || ""); const i = s.indexOf(","); resolve(i >= 0 ? s.slice(i + 1) : s); };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// ─────────────── THEME / MENU ───────────────
const savedTheme = storage.getItem(THEME_KEY) || APP_CONFIG.defaultTheme || "dark";
if (savedTheme === "light") {
  document.body.classList.remove("dark-mode");
  $("themeText").textContent = "Dark Mode";
  if ($("themeSwitch")) $("themeSwitch").checked = false;
} else {
  document.body.classList.add("dark-mode");
  $("themeText").textContent = "Light Mode";
  $("themeIcon").innerHTML = '<path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path>';
  if ($("themeSwitch")) $("themeSwitch").checked = true;
}
function toggleMenu() {
  const m = $("sideMenu"), o = $("menuOverlay");
  if (m.classList.contains("open")) { m.classList.remove("open"); o.style.display = "none"; }
  else { m.classList.add("open"); o.style.display = "block"; }
}
function toggleTheme() {
  const b = document.body, tt = $("themeText"), ti = $("themeIcon"), sw = $("themeSwitch");
  b.classList.toggle("dark-mode");
  if (b.classList.contains("dark-mode")) {
    tt.textContent = "Light Mode"; sw.checked = true;
    ti.innerHTML = '<path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path>';
    storage.setItem(THEME_KEY, "dark");
  } else {
    tt.textContent = "Dark Mode"; sw.checked = false;
    ti.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
    storage.setItem(THEME_KEY, "light");
  }
}
function closeModal(id) { $(id).style.display = "none"; }
function openTrackModal() {
  $("trackModal").style.display = "flex";
  $("trackPhoneConfirm").value = ""; $("otpInput").value = ""; $("trackPinInput").value = "";
  $("trackResult").className = "status-result"; $("trackResult").style.display = "none";
  $("trackStage1").style.display = "block"; $("trackStage2").style.display = "none";
  state.pendingTrackOrderId = null; state.trackToken = null;
  if (state.otpCooldownTimer) { clearInterval(state.otpCooldownTimer); state.otpCooldownTimer = null; }
}
function openSizeGuide() { $("sizeModal").style.display = "flex"; }

// เลือกคณะสีจากปุ่ม
function selectColor(colorName, btnElement) {
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.style.background = "var(--bg-input)";
    btn.style.borderColor = "var(--border-color)";
    btn.style.color = "var(--text-main)";
    btn.style.fontWeight = "normal";
    btn.setAttribute("aria-pressed", "false");
  });

  if (btnElement) {
    btnElement.style.background = "var(--brand-red)";
    btnElement.style.borderColor = "var(--brand-red)";
    btnElement.style.color = "#fff";
    btnElement.style.fontWeight = "bold";
    btnElement.setAttribute("aria-pressed", "true");
  }

  state.selectedTeamColor = colorName;
  const customWrapper = $("customColorWrapper");
  const customInput = $("customColorInput");

  if (colorName === "อื่นๆ") {
    customWrapper.style.display = "block";
    customInput.focus();
  } else {
    customWrapper.style.display = "none";
    customInput.value = "";
  }

  updateSummary();
  checkFormValid();
  saveDraft();
}
function goBackHome() { $("screen-success").style.display = "none"; $("screen-form").style.display = "block"; resetForm(); window.scrollTo(0, 0); }
function goBackFromHistory() { $("screen-history").style.display = "none"; $("screen-form").style.display = "block"; $("trackPhone").value = ""; window.scrollTo(0, 0); }

// ─────────────── DRAFT ───────────────
function saveDraft() {
  try { storage.setItem(DRAFT_KEY, JSON.stringify({
    backName: $("backName").value, backNumber: $("backNumber").value,
    firstName: $("firstName").value, lastName: $("lastName").value,
    customerEmail: $("customerEmail").value, phone: $("phone").value,
    customerPin: $("customerPin").value,
    selectedTeamColor: state.selectedTeamColor,
    customColor: $("customColorInput").value,
    classRoom: $("classRoom").value,
    style: state.style, size: state.size
  })); } catch (e) {}
}
function loadDraft() { try { const r = storage.getItem(DRAFT_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
function dismissDraft() { storage.removeItem(DRAFT_KEY); $("draftBanner").classList.remove("show"); }
function restoreDraft() {
  const d = loadDraft(); if (!d) return;
  $("backName").value = d.backName || ""; $("backNumber").value = d.backNumber || "";
  $("firstName").value = d.firstName || ""; $("lastName").value = d.lastName || "";
  $("customerEmail").value = d.customerEmail || ""; $("phone").value = d.phone || "";
  $("customerPin").value = d.customerPin || "";
  $("classRoom").value = d.classRoom || "";
  $("customColorInput").value = d.customColor || "";
  state.selectedTeamColor = d.selectedTeamColor || d.teamColor || "";
  if (state.selectedTeamColor) {
    const selectedBtn = Array.from(document.querySelectorAll(".color-btn"))
      .find(b => b.textContent.trim() === state.selectedTeamColor);
    if (selectedBtn) selectColor(state.selectedTeamColor, selectedBtn);
    else state.selectedTeamColor = "";
  }
  $("customColorWrapper").style.display = state.selectedTeamColor === "อื่นๆ" ? "block" : "none";
  
  if (d.style) {
    state.style = d.style;
    if (["เสื้อสี", "เสื้อฟุตบอล", "เสื้อฟุตบอลม.ต้น", "เสื้อประตูมัธยมศึกษาตอนต้น", "เสื้อประตูมัธยมศึกษาตอนปลาย"].includes(d.style)) state.basePrice = 289;
    else if (d.style.includes("กางเกง")) state.basePrice = 149;
    else state.basePrice = 279;
    state.allow2XL = !d.style.includes("กางเกง");
  }
  if (d.size) {
    document.querySelectorAll("#sizePicker .size-btn").forEach(b => b.classList.toggle("active", b.dataset.size === d.size));
    state.size = d.size;
  }
  const calc = computePrice(state.basePrice, state.size, state.allow2XL);
  state.surcharge = calc.extra; state.price = calc.total;
  $("draftBanner").classList.remove("show");
  updateSummary(); checkFormValid(); updateNumberPreview();
  toast("กู้คืนข้อมูลแล้ว", "success");
}
(function initDraftBanner() { const d = loadDraft(); if (d && (d.backName || d.firstName || d.phone)) $("draftBanner").classList.add("show"); })();

// ─────────────── PHONE CHECK ───────────────
let isPhoneDuplicate = false;
const checkPhoneLive = debounce(async function () {
  const phone = $("phone").value.trim();
  const wb = $("phoneWarning");
  if (phone.replace(/\D/g,"").length < 9) { if (wb) wb.style.display = "none"; isPhoneDuplicate = false; checkFormValid(); return; }
  try {
    const r = await (await fetchWithRetry(`${GOOGLE_SCRIPT_URL}?action=check_phone&phone=${encodeURIComponent(phone)}`)).json();
    if (r.status === "success" && r.duplicate) {
      isPhoneDuplicate = true;
      if (wb) { wb.textContent = "เบอร์โทรนี้เคยสั่งซื้อแล้ว (หากต้องการสั่งเพิ่มจริงๆ ให้กดปุ่มยืนยันด้านล่างได้เลย)"; wb.style.display = "block"; }
    } else { isPhoneDuplicate = false; if (wb) wb.style.display = "none"; }
  } catch (e) { console.warn("Phone check failed", e); }
  checkFormValid();
}, 700);

// ─────────────── OCR (AI อ่านสลิป) ───────────────
const SlipValidator = {
  normalizeDigits(t) { return String(t || "").replace(/[๐-๙]/g, d => "๐๑๒๓๔๕๖๗๘๙".indexOf(d)); },
  extractAllAmounts(t) {
    const n = this.normalizeDigits(t).replace(/,/g, "");
    const matches = n.match(/\b\d{1,5}\.\d{2}\b/g) || [];
    return matches.map(x => Math.floor(Number(x)));
  },
  extractReference(t) {
    const n = this.normalizeDigits(t).replace(/[^\d]/g, " ");
    const c = n.match(/\b\d{12,20}\b/g) || [];
    return c[0] || "";
  }
};

let tesseractLoaderPromise = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractLoaderPromise) return tesseractLoaderPromise;
  const src = String(APP_CONFIG.tesseractCdn || "").trim();
  tesseractLoaderPromise = new Promise((resolve, reject) => {
    if (!src) { reject(new Error("ยังไม่ได้ตั้งค่า tesseractCdn ใน config.js")); return; }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error("โหลด Tesseract ไม่สำเร็จ")));
    s.onerror = () => { tesseractLoaderPromise = null; reject(new Error("โหลดตัวอ่านสลิปจาก CDN ไม่สำเร็จ")); };
    document.head.appendChild(s);
  });
  return tesseractLoaderPromise;
}

async function analyzeSlip(file) {
  $("aiScannerBox").style.display = "block";
  $("aiStatusText").style.display = "block";
  $("aiStatusText").textContent = "กำลังอ่านข้อมูลจากสลิป...";
  state.slipOCRDone = false; state.slipAmountMatched = false;
  state.slipOCR = ""; state.slipRef = ""; state.slipAmount = null;
  checkFormValid();
  let worker;
  try {
    const TesseractLib = await loadTesseract();
    worker = await TesseractLib.createWorker("eng");
    const result = await worker.recognize(file);
    const text = result?.data?.text || "";
    state.slipOCR = text;
    state.slipRef = SlipValidator.extractReference(text);
    
    const expected = Math.floor(Number(state.price)); 
    const allAmounts = SlipValidator.extractAllAmounts(text);
    
    if (allAmounts.includes(expected)) {
      state.slipAmount = expected;
      state.slipAmountMatched = true;
      $("aiStatusText").innerHTML = `อ่านยอดได้ <strong>${formatTHB(expected)}</strong> ตรงกับยอดสั่งซื้อ`;
    } else if (allAmounts.length > 0) {
      state.slipAmount = allAmounts[0];
      $("aiStatusText").textContent = `อ่านยอดได้ ${formatTHB(state.slipAmount)} แต่ยอดสั่งซื้อ ${formatTHB(expected)} ไม่ตรงกัน`;
    } else {
      $("aiStatusText").textContent = "อ่านยอดเงินไม่สำเร็จ";
    }
    state.slipOCRDone = true;
  } catch (err) {
    state.slipOCRDone = true;
    $("aiStatusText").innerHTML = "AI อ่านไม่สำเร็จ <strong>(ไม่เป็นไร ส่งให้แอดมินตรวจได้เลย)</strong>";
  } finally {
    if (worker) try { await worker.terminate(); } catch (_) {}
    checkFormValid();
  }
}

async function handleSlipUpload(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) { toast("กรุณาอัปโหลดไฟล์รูปภาพ", "error"); e.target.value = ""; return; }
  if (file.size > 5 * 1024 * 1024) { toast("ไฟล์ใหญ่เกิน 5MB", "error"); e.target.value = ""; return; }
  state.slipFile = file; state.slipFilename = file.name;
  state.slipOCR = ""; state.slipRef = ""; state.slipAmount = null;
  state.slipOCRDone = false; state.slipAmountMatched = false;
  state.idempotencyKey = null;
  const preview = $("slipPreview");
  if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
  preview.dataset.objectUrl = URL.createObjectURL(file);
  preview.src = preview.dataset.objectUrl; preview.style.display = "block";
  $("slipText").textContent = "แนบแล้ว: " + file.name;
  $("slipDrop").classList.add("has-file");
  $("aiStatusText").textContent = ""; $("aiScannerBox").style.display = "none";
  checkFormValid(); saveDraft();
  if ($("aiToggle").checked) await analyzeSlip(file);
}
$("aiToggle").addEventListener("change", async () => {
  if (state.slipFile && $("aiToggle").checked) await analyzeSlip(state.slipFile);
  else { $("aiScannerBox").style.display = "none"; checkFormValid(); }
});

// ─────────────── PRODUCT & SUMMARY ───────────────
function updateNumberPreview() {
  const num = $("backNumber").value.trim();
  if (num.length > 0) {
    $("numberPreviewBox").style.display = "block"; $("numberPreviewText").textContent = num;
    $("numberPreviewText").style.transform = "scale(1.1)";
    setTimeout(() => $("numberPreviewText").style.transform = "scale(1)", 100);
  } else $("numberPreviewBox").style.display = "none";
  updateSummary(); checkFormValid(); saveDraft();
}
function randomLuckyNumber() {
  const lucky = ["01","02","03","05","06","07","08","09","10","11","12","13","15","16","17","18","19","20","21","22","23","24","25","26","27","28","29","30","31","32","33","35","36","37","38","39","40","41","42","43","45","46","47","48","49","50","51","52","53","55","56","57","58","59","60","61","62","63","65","66","67","68","69","70","71","72","73","75","76","77","78","79","80","81","82","83","85","86","87","88","89","90","91","92","93","95","96","97","98","99"];
  const r = lucky[Math.floor(Math.random() * lucky.length)];
  $("backNumber").value = r; updateNumberPreview(); toast("สุ่มได้เบอร์ " + r);
}
let selectedProductFromModal = null;
function openProductModal(name, price, imgSrc, desc, allow2XL) {
  selectedProductFromModal = name;
  $("modalProductTitle").textContent = name;
  $("modalProductPrice").textContent = price + " THB";
  $("modalProductImg").src = imgSrc;
  $("modalProductDesc").textContent = desc;
  const s2 = document.querySelector("#sizePicker .size-btn[data-size='2XL']");
  if (allow2XL === false) {
    s2.style.display = "none";
    if (state.size === "2XL") document.querySelector("#sizePicker .size-btn[data-size='M']").click();
  } else { s2.style.display = "block"; }
  $("productModal").style.display = "flex";
}
function selectProductFromModal() {
  if (!selectedProductFromModal) return;
  closeModal("productModal");
  state.style = selectedProductFromModal;
  if (["เสื้อสี", "เสื้อฟุตบอล", "เสื้อฟุตบอลม.ต้น", "เสื้อประตูมัธยมศึกษาตอนต้น", "เสื้อประตูมัธยมศึกษาตอนปลาย"].includes(selectedProductFromModal)) { 
    state.basePrice = 289; state.allow2XL = true; 
  }
  else if (selectedProductFromModal.includes("กางเกง")) { 
    state.basePrice = 149; state.allow2XL = false; 
  }
  else { 
    state.basePrice = 279; state.allow2XL = true; 
  }
  const calc = computePrice(state.basePrice, state.size, state.allow2XL);
  state.surcharge = calc.extra; state.price = calc.total;
  updateSummary(); checkFormValid(); saveDraft();
  window.scrollTo({ top: $("colorButtons").offsetTop - 100, behavior: 'smooth' });
  toast("เลือกแบบ " + selectedProductFromModal + " แล้ว", "success");
}

// 🆕 ระบบกางเกง 4 แบบ
function openPantsModal() { $("pantsModal").style.display = "flex"; }
function selectPants(name, price) {
  closeModal("pantsModal");
  state.style = name;
  state.basePrice = price;
  state.allow2XL = false; 
  const calc = computePrice(state.basePrice, state.size, state.allow2XL);
  state.surcharge = calc.extra; state.price = calc.total;
  updateSummary(); checkFormValid(); saveDraft();
  window.scrollTo({ top: $("colorButtons").offsetTop - 100, behavior: 'smooth' });
  toast("เลือกแบบ " + name + " แล้ว", "success");
}

function zoomImage(src) { $("lightboxImg").src = src; $("imageLightbox").style.display = "flex"; }
function closeLightbox() { $("imageLightbox").style.display = "none"; $("lightboxImg").src = ""; }
document.querySelectorAll("#sizePicker .size-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll("#sizePicker .size-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.size = btn.dataset.size;
    const calc = computePrice(state.basePrice, state.size, state.allow2XL);
    state.surcharge = calc.extra; state.price = calc.total;
    updateSummary(); checkFormValid(); saveDraft();
    if (state.slipFile && $("aiToggle").checked) await analyzeSlip(state.slipFile);
  });
});
function updateSummary() {
  $("sumStyle").textContent = state.style;
  $("sumSize").textContent = state.size;
  $("sumBack").textContent = $("backName").value.trim() || "—";
  $("sumNumber").textContent = $("backNumber").value.trim() || "—";

  let finalColor = state.selectedTeamColor;
  if (finalColor === "อื่นๆ") finalColor = $("customColorInput").value.trim() || "อื่นๆ";
  $("sumColor").textContent = finalColor || "—";
  $("sumClass").textContent = $("classRoom").value.trim() || "—";

  const el = $("sumTotal");
  if (state.surcharge > 0) el.innerHTML = `${formatTHB(state.price)} <small>(ฐาน ${formatTHB(state.basePrice)} + ไซส์ ${state.size} ${formatTHB(state.surcharge)})</small>`;
  else el.textContent = formatTHB(state.price);
  if ($("payAmountBank")) $("payAmountBank").textContent = formatTHB(state.price);
}

["backName", "firstName", "lastName", "phone", "customerEmail", "customerPin", "classRoom"].forEach(id => {
  $(id).addEventListener("input", () => { updateSummary(); checkFormValid(); saveDraft(); });
});
$("customColorInput").addEventListener("input", () => {
  updateSummary(); checkFormValid(); saveDraft();
});

function checkFormValid() {
  let ok = true, missing = [];
  if (!$("backName").value.trim()) { ok = false; missing.push("ชื่อสกรีน"); }
  if (!$("firstName").value.trim()) { ok = false; missing.push("ชื่อ"); }
  if (!$("lastName").value.trim()) { ok = false; missing.push("นามสกุล"); }
  if (!$("customerEmail").value.includes("@")) { ok = false; missing.push("อีเมล"); }
  if ($("phone").value.replace(/\D/g, "").length < 9) { ok = false; missing.push("เบอร์โทร"); }
  if (!state.selectedTeamColor) { ok = false; missing.push("คณะสี"); }
  if (state.selectedTeamColor === "อื่นๆ" && !$("customColorInput").value.trim()) { ok = false; missing.push("ระบุสีอื่นๆ"); }
  if (!$("classRoom").value.trim()) { ok = false; missing.push("ห้องเรียน/เลขที่"); }
  if (!state.slipFile) { ok = false; missing.push("สลิปโอนเงิน"); }
  if ($("customerPin").value.replace(/\D/g, "").length !== 4) { ok = false; missing.push("PIN 4 หลัก"); }

  const btn = $("submitBtn"), err = $("errorMsg");
  if (!BACKEND_READY) {
    err.innerHTML = "<span style='color:#dc3545;font-weight:bold;'>ระบบยังไม่ได้เชื่อมต่อ backend — กรุณาตั้งค่า googleScriptUrl ใน config.js</span>";
    btn.disabled = true;
    return;
  }
  if (isPhoneDuplicate) err.innerHTML = "<span style='color:#dc3545;font-weight:bold;'>เบอร์นี้เคยสั่งแล้ว! หากต้องการสั่งเพิ่มจริงๆ ให้กดปุ่มยืนยันด้านบน</span>";
  else err.textContent = ok ? "" : "กรุณาแก้ไข: " + missing.join(", ");
  btn.disabled = !ok || state.submitLocked;
}

// ─────────────── SUBMIT ORDER ───────────────
$("submitBtn").addEventListener("click", async () => {
  if ($("submitBtn").disabled || state.submitLocked) return;
  state.submitLocked = true;
  const btn = $("submitBtn");
  btn.classList.add("loading"); btn.disabled = true;
  $("uploadProgress").classList.add("show");
  try {
    if (!state.idempotencyKey) state.idempotencyKey = newIdempotencyKey();
    const slipBase64 = await fileToBase64_(state.slipFile);
    
    // 🆕 รวมสี และ ห้องเรียนเข้าด้วยกัน
    const finalColor = state.selectedTeamColor === "อื่นๆ"
      ? $("customColorInput").value.trim()
      : state.selectedTeamColor;
    const combinedClass = finalColor + " | " + $("classRoom").value.trim();

    const orderData = {
      idempotencyKey: state.idempotencyKey,
      fullName: $("firstName").value.trim() + " " + $("lastName").value.trim(),
      classRoom: combinedClass,
      phone: $("phone").value.trim(),
      customerPin: $("customerPin").value.trim(),
      style: state.style, size: state.size,
      backName: $("backName").value.trim(),
      backNumber: $("backNumber").value.trim(),
      slipBase64, slipFilename: state.slipFilename || "slip.jpg",
      slipRef: state.slipRef || "", slipAmount: state.slipAmount,
      expectedAmount: state.price, slipOCR: state.slipOCR || "",
      customerEmail: $("customerEmail").value.trim()
    };
    orderData.pin = orderData.customerPin; 
    
    const r = await (await fetchWithRetry(GOOGLE_SCRIPT_URL, {
      method: "POST", body: JSON.stringify(orderData),
      headers: { "Content-Type": "text/plain;charset=utf-8" }
    }, { retries: 1, ms: 60000 })).json();
    if (!r || r.status !== "success") throw new Error((r && r.message) || "บันทึกไม่สำเร็จ");
    storage.removeItem(DRAFT_KEY);
    $("screen-form").style.display = "none";
    $("screen-success").style.display = "block";
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const realId = r.orderId || "CS69-XXXX";
    await drawDigitalTicket(realId, orderData.fullName, orderData.backName, orderData.backNumber, combinedClass, orderData.style, orderData.size, state.price);
    state.lastOrderId = realId;
    $("shareRow").style.display = "flex";
  } catch (err) {
    toast(err.message, "error");
    btn.classList.remove("loading"); state.submitLocked = false; btn.disabled = false;
  } finally {
    $("uploadProgress").classList.remove("show");
    $("uploadProgressBar").style.width = "0%";
  }
});

async function drawDigitalTicket(orderId, name, backName, backNumber, classRoom, style, size, price) {
  if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
  const c = $("ticketCanvas"), ctx = c.getContext("2d");
  ctx.fillStyle = "#0a0a0a"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = "#333"; ctx.lineWidth = 2; ctx.strokeRect(20, 20, c.width - 40, c.height - 40);
  ctx.fillStyle = "rgba(255,255,255,0.03)"; ctx.font = "bold 150px 'Kanit'"; ctx.textAlign = "center"; ctx.fillText("CS69", c.width/2, c.height/2 + 50);
  ctx.fillStyle = "#d32f2f"; ctx.font = "bold 44px 'Kanit'"; ctx.fillText("CHIANGSAEN", c.width/2, 120);
  ctx.fillStyle = "#ffffff"; ctx.font = "24px 'Sarabun'"; ctx.fillText("OFFICIAL ORDER TICKET", c.width/2, 160);
  ctx.fillStyle = "#ffc107"; ctx.font = "bold 32px 'Kanit'"; ctx.fillText(orderId, c.width/2, 210);
  ctx.beginPath(); ctx.moveTo(60, 240); ctx.lineTo(c.width - 60, 240); ctx.strokeStyle = "#333"; ctx.stroke();
  ctx.textAlign = "left"; ctx.fillStyle = "#888"; ctx.font = "20px 'Sarabun'";
  ctx.fillText("NAME:", 60, 290); ctx.fillText("CLASS:", 60, 340); ctx.fillText("STYLE:", 60, 390); ctx.fillText("SIZE:", 60, 440); ctx.fillText("BACK NAME:", 60, 490); ctx.fillText("NUMBER:", 60, 540); ctx.fillText("PRICE:", 60, 590);
  ctx.fillStyle = "#ffffff"; ctx.font = "bold 24px 'Kanit'";
  ctx.fillText(name, 220, 290); ctx.fillText(classRoom, 220, 340); ctx.fillText(style, 220, 390); ctx.fillText(size, 220, 440); ctx.fillText(backName, 220, 490);
  ctx.fillStyle = "#d32f2f"; ctx.font = "bold 60px 'Kanit'"; ctx.fillText(backNumber, 220, 560);
  ctx.fillStyle = "#ffffff"; ctx.font = "bold 32px 'Kanit'"; ctx.fillText("฿" + price, 220, 610);
  ctx.beginPath(); ctx.arc(c.width - 120, 680, 60, 0, Math.PI * 2); ctx.strokeStyle = "#d32f2f"; ctx.lineWidth = 4; ctx.stroke();
  ctx.fillStyle = "#d32f2f"; ctx.textAlign = "center"; ctx.font = "bold 16px 'Kanit'"; ctx.fillText("VERIFIED", c.width - 120, 675); ctx.fillText("2026", c.width - 120, 695);
  $("downloadTicket").href = c.toDataURL("image/png");
}
async function shareTicket() {
  const c = $("ticketCanvas");
  c.toBlob(async blob => {
    const file = new File([blob], "chiangsaen_ticket.png", { type: "image/png" });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Chiangsaen Ticket", text: "ตั๋ว " + (state.lastOrderId || "") }); } catch (e) {}
    } else {
      const a = document.createElement("a"); a.href = c.toDataURL("image/png"); a.download = "chiangsaen_ticket.png"; a.click();
      toast("บันทึกตั๋วแล้ว", "success");
    }
  });
}
function buildShareUrl(search) {
  const base = String(APP_CONFIG.siteUrl || "").trim();
  let url;
  if (base) {
    url = new URL(base, window.location.href);
  } else {
    const path = window.location.pathname.replace(/index\.html?$/i, "") || "/";
    url = new URL(path, window.location.origin);
  }
  url.search = search;
  return url.toString();
}
function shareOrderLink(id) {
  const url = buildShareUrl("?order=" + encodeURIComponent(id));
  if (navigator.share) navigator.share({ title: "ติดตาม " + id, url }).catch(() => {});
  else copyToClipboard(url, "คัดลอกลิงก์แล้ว");
}
function copyOrderId() { if (state.lastOrderId) copyToClipboard(state.lastOrderId, "คัดลอกรหัสแล้ว"); }
async function copyToClipboard(t, msg) {
  try { await navigator.clipboard.writeText(t); toast(msg || "คัดลอกแล้ว", "success"); }
  catch (e) { const el = document.createElement("textarea"); el.value = t; document.body.appendChild(el); el.select(); document.execCommand("copy"); document.body.removeChild(el); toast(msg || "คัดลอกแล้ว", "success"); }
}
function resetForm() {
  $("screen-history").style.display = "none";
  ["backName", "backNumber", "firstName", "lastName", "phone", "classRoom", "customerEmail", "customerPin", "customColorInput"].forEach(id => $(id).value = "");
  state.selectedTeamColor = "";
  document.querySelectorAll(".color-btn").forEach(btn => {
    btn.style.background = "var(--bg-input)";
    btn.style.borderColor = "var(--border-color)";
    btn.style.color = "var(--text-main)";
    btn.style.fontWeight = "normal";
    btn.setAttribute("aria-pressed", "false");
  });
  $("customColorWrapper").style.display = "none";
  $("numberPreviewBox").style.display = "none"; $("aiScannerBox").style.display = "none";
  state.slipFile = null; state.slipFilename = ""; state.slipOCR = ""; state.slipRef = "";
  state.slipAmount = null; state.slipAmountMatched = false; state.slipOCRDone = false;
  state.lastOrderId = null; state.idempotencyKey = null; state.submitLocked = false;
  state.basePrice = 289; state.surcharge = 0; state.price = 289;
  $("slipPreview").style.display = "none"; $("slipPreview").src = "";
  if ($("slipPreview").dataset.objectUrl) { URL.revokeObjectURL($("slipPreview").dataset.objectUrl); delete $("slipPreview").dataset.objectUrl; }
  $("slipText").textContent = "แตะเพื่ออัปโหลดสลิป";
  $("slipDrop").classList.remove("has-file"); $("slipInput").value = "";
  $("submitBtn").classList.remove("loading"); $("submitBtn").textContent = "ยืนยันการสั่งซื้อ"; $("submitBtn").disabled = true;
  $("shareRow").style.display = "none";
  storage.removeItem(DRAFT_KEY);
  updateSummary(); checkFormValid(); window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─────────────── TRACKING / OTP / PIN ───────────────
function trackingFormatDate(v) { if (!v) return "ไม่ระบุเวลา"; const d = new Date(v); if (Number.isNaN(d.getTime())) return escapeHTML(v); return d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }); }
function trackingStatusClass(s) { if (s === "จัดส่งแล้ว") return "delivered"; if (s === "กำลังผลิต") return "producing"; if (s === "ยกเลิก" || s === "สลิปไม่ผ่าน") return "cancelled"; return "pending"; }
function buildStatusTimeline(status) {
  const stages = [
    { n: "รอตรวจสอบสลิป", d: "รอแอดมินตรวจสอบการชำระเงิน" },
    { n: "ยืนยันเงินแล้ว", d: "ได้รับชำระเงินแล้ว" },
    { n: "กำลังผลิต", d: "กำลังดำเนินการผลิตเสื้อ" },
    { n: "จัดส่งแล้ว", d: "คำสั่งซื้อถูกจัดส่งแล้ว" }
  ];
  if (status === "ยกเลิก") return `<div class="tracking-cancelled"><span class="tracking-step-icon">×</span><div><strong>คำสั่งซื้อถูกยกเลิก</strong><p>ติดต่อผู้ดูแลระบบหากต้องการสอบถาม</p></div></div>`;
  if (status === "สลิปไม่ผ่าน") return `<div class="tracking-cancelled"><span class="tracking-step-icon">×</span><div><strong>สลิปไม่ผ่านการตรวจสอบ</strong><p>กรุณาติดต่อผู้ดูแลระบบ</p></div></div>`;
  const idx = stages.findIndex(s => s.n === status);
  return `<div class="tracking-timeline">${stages.map((s, i) => `<div class="tracking-timeline-item ${idx >= i ? "completed" : ""} ${idx === i ? "active" : ""}"><div class="tracking-timeline-marker">${idx >= i ? "✓" : i + 1}</div><div class="tracking-timeline-copy"><strong>${s.n}${idx === i ? " · สถานะปัจจุบัน" : ""}</strong><p>${s.d}</p></div></div>`).join("")}</div>`;
}
async function loadOrderHistory(id) {
  const r = await (await fetchWithRetry(`${GOOGLE_SCRIPT_URL}?action=get_order_history&orderid=${encodeURIComponent(id)}`, {}, { retries: 2, ms: 15000 })).json();
  if (r.status !== "success" || !Array.isArray(r.data)) throw new Error(r.message || "อ่านประวัติไม่ได้");
  return r.data;
}
function renderOrderHistory(h) {
  if (!h.length) return `<div class="tracking-empty-history">ยังไม่มีประวัติ</div>`;
  return `<div class="tracking-history-list">${h.map(i => `<div class="tracking-history-item"><span class="tracking-history-dot"></span><div class="tracking-history-content"><strong>${escapeHTML(i.newStatus || "อัปเดต")}</strong><span>${escapeHTML(trackingFormatDate(i.changedAt))}</span>${i.changedBy ? `<small>ผู้ดำเนินการ: ${escapeHTML(i.changedBy)}</small>` : ""}</div></div>`).join("")}</div>`;
}

async function requestTrackOtp() {
  const id = $("trackPhone").value.trim().toUpperCase();
  const phone = $("trackPhoneConfirm").value.trim();
  const resDiv = $("trackResult"), btn = $("trackBtn");
  if (!/^CS69-\d{4}$/.test(id)) { resDiv.style.display = "block"; resDiv.className = "status-result error"; resDiv.textContent = "กรุณากรอกรหัสออเดอร์รูปแบบ CS69-1234"; return; }
  if (phone.replace(/\D/g,"").length < 9) { resDiv.style.display = "block"; resDiv.className = "status-result error"; resDiv.textContent = "กรุณากรอกเบอร์โทรที่ใช้สั่งซื้อ"; return; }
  
  const orig = btn.textContent; btn.textContent = "กำลังส่ง OTP..."; btn.disabled = true;
  resDiv.style.display = "block"; resDiv.className = "status-result loading"; resDiv.textContent = "กำลังส่ง OTP...";
  
  try {
    const r = await (await fetchWithRetry(`${GOOGLE_SCRIPT_URL}?action=request_otp&orderid=${encodeURIComponent(id)}&phone=${encodeURIComponent(phone)}`, {}, { retries: 1, ms: 20000 })).json();
    if (r.status !== "success") throw new Error(r.message || "ส่ง OTP ไม่สำเร็จ");
    
    state.pendingTrackOrderId = id;
    $("trackStage1").style.display = "none";
    $("trackStage2").style.display = "block";
    resDiv.className = "status-result success";
    resDiv.textContent = "ส่ง OTP ไปที่อีเมลของคำสั่งซื้อแล้ว (หมดอายุ 5 นาที)";
    startOtpCooldown(60);
  } catch (e) {
    resDiv.className = "status-result error";
    resDiv.innerHTML = "เกิดข้อผิดพลาด: " + e.message + "<br><br><a href='https://line.me/ti/p/qx4pTpyFEH' target='_blank' style='color:#0d6efd;text-decoration:underline;'>👉 กดที่นี่เพื่อติดต่อแอดมินทาง LINE</a>";
  } finally { btn.textContent = orig; btn.disabled = false; }
}
function startOtpCooldown(sec) {
  const btn = $("resendOtpBtn"), cd = $("resendCountdown");
  if (!btn || !cd) return;
  if (state.otpCooldownTimer) clearInterval(state.otpCooldownTimer);
  let left = sec;
  btn.disabled = true; cd.textContent = left;
  state.otpCooldownTimer = setInterval(() => {
    left--;
    if (left <= 0) {
      clearInterval(state.otpCooldownTimer); state.otpCooldownTimer = null;
      btn.disabled = false; cd.textContent = "0";
    } else cd.textContent = left;
  }, 1000);
}
async function verifyTrackOtp() {
  const otp = $("otpInput").value.trim();
  const id = state.pendingTrackOrderId;
  const resDiv = $("trackResult"), btn = $("otpVerifyBtn");
  if (!otp) { resDiv.style.display = "block"; resDiv.className = "status-result error"; resDiv.textContent = "กรุณากรอก OTP"; return; }
  const orig = btn.textContent; btn.textContent = "กำลังตรวจสอบ..."; btn.disabled = true;
  try {
    const r = await (await fetchWithRetry(`${GOOGLE_SCRIPT_URL}?action=verify_otp&orderid=${encodeURIComponent(id)}&otp=${encodeURIComponent(otp)}`, {}, { retries: 1, ms: 20000 })).json();
    if (r.status !== "success" || !r.trackToken) throw new Error(r.message || "OTP ไม่ถูกต้อง");
    state.trackToken = r.trackToken;
    await showOrderDetail(id);
  } catch (e) {
    resDiv.style.display = "block"; resDiv.className = "status-result error";
    resDiv.textContent = "OTP ไม่ถูกต้องหรือหมดอายุ (" + e.message + ")";
  } finally { btn.textContent = orig; btn.disabled = false; }
}
async function verifyTrackPin() {
  const id = $("trackPhone").value.trim().toUpperCase();
  const phone = $("trackPhoneConfirm").value.trim();
  const pin = $("trackPinInput").value.trim();
  const resDiv = $("trackResult"), btn = $("trackPinBtn");
  
  if (!/^CS69-\d{4}$/.test(id)) { resDiv.style.display = "block"; resDiv.className = "status-result error"; resDiv.textContent = "กรุณากรอกรหัสออเดอร์รูปแบบ CS69-1234"; return; }
  if (phone.replace(/\D/g,"").length < 9) { resDiv.style.display = "block"; resDiv.className = "status-result error"; resDiv.textContent = "กรุณากรอกเบอร์โทรที่ใช้สั่งซื้อ"; return; }
  if (!/^\d{4}$/.test(pin)) { resDiv.style.display = "block"; resDiv.className = "status-result error"; resDiv.textContent = "กรุณากรอก PIN 4 หลัก"; return; }

  const orig = btn.textContent; btn.textContent = "กำลังตรวจสอบ..."; btn.disabled = true;
  resDiv.style.display = "block"; resDiv.className = "status-result loading"; resDiv.textContent = "กำลังตรวจสอบ...";
  
  try {
    const r = await (await fetchWithRetry(`${GOOGLE_SCRIPT_URL}?action=verify_pin&orderid=${encodeURIComponent(id)}&phone=${encodeURIComponent(phone)}&pin=${encodeURIComponent(pin)}`, {}, { retries: 1, ms: 20000 })).json();
    if (r.status !== "success" || !r.trackToken) throw new Error(r.message || "PIN ไม่ถูกต้อง");
    
    state.trackToken = r.trackToken;
    await showOrderDetail(id);
  } catch (e) {
    resDiv.className = "status-result error";
    resDiv.textContent = "ตรวจสอบไม่สำเร็จ: " + e.message;
  } finally { btn.textContent = orig; btn.disabled = false; }
}
async function showOrderDetail(id) {
  const resDiv = $("trackResult");
  resDiv.style.display = "block"; resDiv.className = "status-result loading"; resDiv.textContent = "กำลังโหลดข้อมูล...";
  const r = await (await fetchWithRetry(`${GOOGLE_SCRIPT_URL}?action=track&orderid=${encodeURIComponent(id)}`, {}, { retries: 2, ms: 15000 })).json();
  if (r.status === "not_found") { resDiv.className = "status-result error"; resDiv.textContent = `ไม่พบคำสั่งซื้อรหัส ${id}`; return; }
  if (r.status !== "success" || !r.data) throw new Error(r.message || "ข้อมูลไม่ถูกต้อง");
  const o = r.data;
  let history = [], historyMsg = "";
  try { history = await loadOrderHistory(id); } catch (e) { historyMsg = "ขณะนี้ยังโหลดประวัติย้อนหลังไม่ได้"; }
  const status = o.status || "รอตรวจสอบสลิป";
  const cls = trackingStatusClass(status);
  const priceLine = o.price ? `<div class="tracking-detail-row"><span>ยอดชำระ</span><strong style="color:var(--brand-red);">${formatTHB(o.price)}</strong></div>` : "";
  $("historyPageContent").innerHTML = `
    <section class="tracking-order-heading">
      <div class="tracking-eyebrow">CHIANG SAEN GEAR · ORDER TRACKING</div>
      <div class="tracking-order-id">${escapeHTML(o.orderId || id)}</div>
      <div class="tracking-customer-name">คุณ ${escapeHTML(o.name || "ลูกค้า")}</div>
      <div class="tracking-order-date">สั่งซื้อเมื่อ ${escapeHTML(trackingFormatDate(o.date))}</div>
    </section>
    <section class="tracking-detail-card">
      <h3>รายละเอียดคำสั่งซื้อ</h3>
      <div class="tracking-detail-row"><span>รูปแบบเสื้อ</span><strong>${escapeHTML(o.style || "—")}</strong></div>
      <div class="tracking-detail-row"><span>ไซส์</span><strong>${escapeHTML(o.size || "—")}</strong></div>
      <div class="tracking-detail-row"><span>ชื่อสกรีน</span><strong>${escapeHTML(o.backName || "—")}</strong></div>
      <div class="tracking-detail-row"><span>เบอร์หลังเสื้อ</span><strong>${escapeHTML(o.backNumber || "—")}</strong></div>
      ${priceLine}
    </section>
    <section class="tracking-current-card ${cls}">
      <div class="tracking-current-label">สถานะปัจจุบัน</div>
      <div class="tracking-current-status">${escapeHTML(status)}</div>
    </section>
    <section class="tracking-section"><h3>ความคืบหน้า</h3>${buildStatusTimeline(status)}</section>
    <section class="tracking-section"><h3>ประวัติการอัปเดต</h3>${historyMsg ? `<p class="tracking-history-warning">${escapeHTML(historyMsg)}</p>` : ""}${renderOrderHistory(history)}</section>
    <button type="button" class="btn btn-primary" style="margin-top:16px;" onclick="trackOrderAgain('${escapeHTML(id)}')">ตรวจสอบอีกครั้ง</button>`;
  closeModal("trackModal");
  $("screen-form").style.display = "none";
  $("screen-history").style.display = "block";
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function trackOrderAgain(id) {
  $("screen-history").style.display = "none"; $("screen-form").style.display = "block";
  $("trackPhone").value = id; $("trackModal").style.display = "flex";
  $("trackResult").style.display = "none";
  $("trackStage1").style.display = "block"; $("trackStage2").style.display = "none";
  state.pendingTrackOrderId = null; state.trackToken = null;
}

// ─────────────── ADMIN ───────────────
let adminIdleTimer = null;
function resetAdminIdle() {
  if (adminIdleTimer) clearTimeout(adminIdleTimer);
  adminIdleTimer = setTimeout(() => {
    if ($("adminModal").style.display === "flex" && $("adminOrderBox").style.display === "block") {
      logoutAdmin(); toast("Session หมดอายุ (ไม่มีการใช้งาน)", "error");
    }
  }, ADMIN_IDLE_MS);
}
["mousemove", "keydown", "click"].forEach(evt => document.addEventListener(evt, () => {
  if ($("adminModal").style.display === "flex" && $("adminOrderBox").style.display === "block") resetAdminIdle();
}));
$("logoSlot").addEventListener("dblclick", async () => {
  $("adminModal").style.display = "flex"; $("adminPass").value = "";
  const session = storage.getItem(SESSION_KEY);
  if (!session) { showAdminLogin(); return; }
  const ok = await verifySession(session);
  if (ok) showAdminPanel(); else { storage.removeItem(SESSION_KEY); showAdminLogin(); }
});
function showAdminLogin() {
  $("adminLoginBox").style.display = "block"; $("adminOrderBox").style.display = "none";
  if (adminIdleTimer) { clearTimeout(adminIdleTimer); adminIdleTimer = null; }
}
function showAdminPanel() {
  $("adminLoginBox").style.display = "none"; $("adminOrderBox").style.display = "block";
  resetAdminIdle(); switchAdminTab("orders"); loadAdminOrders(1);
}
function logoutAdmin() {
  storage.removeItem(SESSION_KEY);
  state.adminOrders = []; state.adminName = "";
  showAdminLogin(); toast("ออกจากระบบแล้ว", "success");
}
async function verifySession(session) {
  try {
    const r = await (await fetchWithTimeout(`${GOOGLE_SCRIPT_URL}?action=verify_session&token=${encodeURIComponent(session)}`, {}, 10000)).json();
    if (r.status === "success" && r.valid === true) { if (r.admin) state.adminName = r.admin; return true; }
    return false;
  } catch (_) { return false; }
}
function switchAdminTab(tab) {
  const isO = tab === "orders";
  $("adminTabOrders").style.display = isO ? "block" : "none";
  $("adminTabDashboard").style.display = isO ? "none" : "block";
  $("tabBtnOrders").style.background = isO ? "var(--brand-red)" : "var(--bg-input)";
  $("tabBtnOrders").style.color = isO ? "#fff" : "var(--text-main)";
  $("tabBtnDash").style.background = isO ? "var(--bg-input)" : "var(--brand-red)";
  $("tabBtnDash").style.color = isO ? "var(--text-main)" : "#fff";
  if (!isO) renderDashboard();
  resetAdminIdle();
}
async function loginAdmin() {
  const name = $("adminName").value.trim();
  const pass = $("adminPass").value;
  const btn = $("loginBtn");
  const orig = btn.textContent;
  btn.textContent = "กำลังตรวจสอบ..."; btn.disabled = true;
  try {
    const r = await (await fetchWithRetry(GOOGLE_SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({ action: "admin_login", password: pass, adminName: name || "admin" }),
      headers: { "Content-Type": "text/plain;charset=utf-8" }
    }, { retries: 1, ms: 15000 })).json();
    if (r.status === "success" && r.sessionToken) {
      storage.setItem(SESSION_KEY, r.sessionToken);
      state.adminName = name || "admin";
      showAdminPanel();
    } else toast(r.message || "รหัสผ่านไม่ถูกต้อง", "error");
  } catch (e) { toast("การเชื่อมต่อล้มเหลว: " + e.message, "error"); }
  finally { btn.textContent = orig; btn.disabled = false; }
}
async function loadAdminOrders(page) {
  const session = storage.getItem(SESSION_KEY);
  if (!session) { showAdminLogin(); return; }
  state.adminPage = page || 1;
  $("adminOrderList").innerHTML = "<p style='text-align:center;color:#888;'>กำลังโหลด...</p>";
  try {
    const url = `${GOOGLE_SCRIPT_URL}?action=get_all_orders&token=${encodeURIComponent(session)}&page=${state.adminPage}&pageSize=40&status=${encodeURIComponent(state.adminStatusFilter)}`;
    const r = await (await fetchWithRetry(url, {}, { retries: 2, ms: 20000 })).json();
    if (r.status === "success") {
      state.adminOrders = r.data || [];
      state.adminTotalPages = r.totalPages || 1;
      renderAdminOrders(); renderPagination();
      if ($("adminTabDashboard").style.display === "block") renderDashboard();
    } else if (r.code === "UNAUTHORIZED") {
      storage.removeItem(SESSION_KEY); showAdminLogin(); toast("Session หมดอายุ", "error");
    } else $("adminOrderList").innerHTML = "<p style='text-align:center;color:#dc3545;'>โหลดไม่สำเร็จ: " + escapeHTML(r.message || "") + "</p>";
  } catch (e) { $("adminOrderList").innerHTML = "<p style='text-align:center;color:#dc3545;'>เชื่อมต่อไม่ได้: " + escapeHTML(e.message) + "</p>"; }
  resetAdminIdle();
}
function renderPagination() {
  const box = $("adminPagination");
  if (!box) return;
  if (state.adminTotalPages <= 1) { box.innerHTML = ""; return; }
  box.innerHTML = `<button ${state.adminPage <= 1 ? "disabled" : ""} onclick="loadAdminOrders(${state.adminPage - 1})">« ก่อนหน้า</button><span>หน้า ${state.adminPage} / ${state.adminTotalPages}</span><button ${state.adminPage >= state.adminTotalPages ? "disabled" : ""} onclick="loadAdminOrders(${state.adminPage + 1})">ถัดไป »</button>`;
}
function renderDashboard() {
  const orders = state.adminOrders.filter(o => o.status !== "ยกเลิก");
  const total = orders.length;
  const totalRev = orders.reduce((s, o) => s + (o.price || 0), 0);
  const received = orders.filter(o => ["ยืนยันเงินแล้ว","กำลังผลิต","จัดส่งแล้ว"].includes(o.status)).reduce((s, o) => s + (o.price || 0), 0);
  const pending = totalRev - received;
  $("dashTotalOrders").textContent = total;
  $("dashTotalRevenue").textContent = formatTHB(totalRev);
  $("dashExpectedRevenue").textContent = formatTHB(totalRev);
  $("dashReceivedRevenue").textContent = formatTHB(received);
  if (pending > 0) { $("dashPendingRevenue").textContent = formatTHB(pending) + " (รอตรวจสลิป)"; $("dashPendingRevenue").style.color = "#dc3545"; }
  else { $("dashPendingRevenue").textContent = "ไม่มีเงินค้าง"; $("dashPendingRevenue").style.color = "#198754"; }

  const sc = {};
  orders.forEach(o => { sc[o.status] = (sc[o.status] || 0) + 1; });
  const sColor = { "รอตรวจสอบสลิป":"#ffc107","ยืนยันเงินแล้ว":"#17a2b8","กำลังผลิต":"#0d6efd","จัดส่งแล้ว":"#198754","สลิปไม่ผ่าน":"#dc3545" };
  $("dashStatusList").innerHTML = Object.keys(sc).map(st => {
    const c = sColor[st] || "#888";
    const p = total > 0 ? (sc[st] / total) * 100 : 0;
    return `<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;"><span style="color:${c};font-weight:600;">${escapeHTML(st)}</span><span>${sc[st]}</span></div><div style="height:6px;background:var(--border-color);border-radius:3px;overflow:hidden;margin-bottom:10px;"><div style="height:100%;width:${p}%;background:${c};"></div></div>`;
  }).join("") || "<p style='color:#888;font-size:13px;'>ไม่มีข้อมูล</p>";

  const sz = {};
  orders.forEach(o => { sz[o.size || "—"] = (sz[o.size || "—"] || 0) + 1; });
  const order = { "S":1,"M":2,"L":3,"XL":4,"2XL":5 };
  $("dashSizeList").innerHTML = Object.keys(sz).sort((a,b) => (order[a]||99) - (order[b]||99)).map(s => `<div style="display:flex;justify-content:space-between;padding:8px 12px;background:var(--bg-input);border-radius:6px;font-size:13px;margin-bottom:6px;"><span>ไซส์ ${escapeHTML(s)}</span><span style="font-weight:600;">${sz[s]} ตัว</span></div>`).join("") || "<p style='color:#888;font-size:13px;'>ไม่มีข้อมูล</p>";

  const cl = {};
  orders.forEach(o => { cl[o.classRoom || "—"] = (cl[o.classRoom || "—"] || 0) + 1; });
  $("dashClassList").innerHTML = Object.keys(cl).sort((a,b) => cl[b] - cl[a]).slice(0,5).map(c => `<div style="display:flex;justify-content:space-between;padding:8px 12px;background:var(--bg-input);border-radius:6px;font-size:13px;margin-bottom:6px;"><span>${escapeHTML(c)}</span><span style="font-weight:600;">${cl[c]} คน</span></div>`).join("") || "<p style='color:#888;font-size:13px;'>ไม่มีข้อมูล</p>";
}
const filterAdminOrders = debounce(function () { renderAdminOrders(); }, 300);
function renderAdminOrders() {
  const list = $("adminOrderList");
  const q = ($("adminFilter").value || "").trim().toLowerCase();
  const filtered = state.adminOrders.filter(o => !q ||
    String(o.name || "").toLowerCase().includes(q) ||
    String(o.orderId || "").toLowerCase().includes(q) ||
    String(o.classRoom || "").toLowerCase().includes(q) ||
    String(o.status || "").toLowerCase().includes(q) ||
    String(o.phone || "").toLowerCase().includes(q) ||
    String(o.email || "").toLowerCase().includes(q) ||
    String(o.backName || "").toLowerCase().includes(q) ||
    String(o.backNumber || "").toLowerCase().includes(q));
  if (!filtered.length) { list.innerHTML = "<p style='text-align:center;color:#888;'>ไม่มีรายการ</p>"; return; }
  list.innerHTML = "";
  filtered.forEach(o => {
    let sc = "#888";
    if (o.status === "รอตรวจสอบสลิป") sc = "#ffc107";
    else if (o.status === "ยืนยันเงินแล้ว") sc = "#17a2b8";
    else if (o.status === "กำลังผลิต") sc = "#0d6efd";
    else if (o.status === "จัดส่งแล้ว") sc = "#198754";
    else if (o.status === "ยกเลิก" || o.status === "สลิปไม่ผ่าน") sc = "#dc3545";
    
    const canV = o.status === "รอตรวจสอบสลิป"; 
    const canP = o.status === "ยืนยันเงินแล้ว" || o.status === "กำลังผลิต"; 
    const canCancel = o.status !== "จัดส่งแล้ว" && o.status !== "ยกเลิก"; 

    let img = `<div style="width:60px;height:60px;background:var(--bg-card);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--text-muted);border:1px solid var(--border-color);">ไม่มีรูป</div>`;
    if (o.slipLink && o.slipLink.startsWith("http")) img = `<a href="${escapeHTML(o.slipLink)}" target="_blank" rel="noopener"><img src="${escapeHTML(o.slipLink)}" style="width:60px;height:60px;object-fit:cover;border-radius:6px;border:1px solid var(--border-color);"></a>`;
    else if (o.slipLink === "เงินสด") img = `<div style="width:60px;height:60px;background:var(--bg-card);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#d97706;border:1px solid var(--border-color);">เงินสด</div>`;
    
    const item = document.createElement("div");
    item.style.cssText = "background:var(--bg-input);border:1px solid var(--border-color);border-radius:8px;padding:12px;display:flex;gap:12px;";
    
    const encodedSlipLink = encodeURIComponent(o.slipLink || "");

    item.innerHTML = `${img}<div style="flex:1;font-size:13px;color:var(--text-main);">
      <div style="font-weight:600;color:var(--brand-red);font-size:14px;margin-bottom:2px;">รหัส: ${escapeHTML(o.orderId || 'N/A')}</div>
      <div style="font-weight:600;">${escapeHTML(o.name || '—')} <span style="color:var(--text-muted);font-weight:400;">(${escapeHTML(o.classRoom || '-')})</span>${o.price ? ` <span style="color:var(--brand-red);font-weight:700;">฿${Number(o.price).toLocaleString("th-TH")}</span>` : ""}</div>
      <div style="color:var(--text-muted);">โทร: ${escapeHTML(o.phone || '-')}</div>
      <div style="color:var(--text-muted);font-size:12px;">อีเมล: ${escapeHTML(o.email || '—')}</div>
      <div style="margin-top:4px;">เสื้อ: ${escapeHTML(o.style || '-')} / ไซส์ ${escapeHTML(o.size || '-')} / สกรีน: ${escapeHTML(o.backName || '-')} (${escapeHTML(o.backNumber || '-')})</div>
      <div style="margin-top:6px;font-weight:600;color:${sc};">สถานะ: ${escapeHTML(o.status)}</div>
      <div style="margin-top:6px;padding:8px;border-radius:6px;background:var(--bg-card);font-size:12px;">
        <div style="font-weight:700;margin-bottom:3px;">ผลตรวจสลิป (OCR)</div>
        <div style="color:${String(o.slipReview || "").includes("X ") ? "#dc3545" : "#198754"};">${escapeHTML(o.slipReview || "ไม่มีข้อมูล")}</div>
        <div style="color:var(--text-muted);margin-top:3px;">OCR ไม่ใช่หลักฐานยืนยันเงินเข้า ต้องกด "ยืนยันเงิน" ก่อนเริ่มผลิต</div>
      </div></div>
      <div style="display:flex;flex-direction:column;gap:4px;justify-content:center;">
        
        ${canV ? `
          <button style="background:#17a2b8;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer;" onclick="verifyPayment(${o.rowIndex}, '${escapeHTML(o.orderId)}', '${encodedSlipLink}')">ยืนยันเงิน</button>
          <button style="background:#dc3545;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer;" onclick="rejectPayment(${o.rowIndex}, '${escapeHTML(o.orderId)}')">สลิปไม่ผ่าน</button>
        ` : ""}
        
        <button ${canP ? "" : "disabled"} style="background:${canP ? "#0d6efd" : "#6c757d"};color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:500;cursor:${canP ? "pointer" : "not-allowed"};" onclick="updateStatus(${o.rowIndex}, 'กำลังผลิต', '${escapeHTML(o.name || "")}')">เริ่มผลิต</button>
        
        <button ${canP ? "" : "disabled"} style="background:${canP ? "#198754" : "#6c757d"};color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:500;cursor:${canP ? "pointer" : "not-allowed"};" onclick="updateStatus(${o.rowIndex}, 'จัดส่งแล้ว', '${escapeHTML(o.name || "")}')">จัดส่งแล้ว</button>
        
        <button ${canCancel ? "" : "disabled"} style="background:${canCancel ? "#dc3545" : "#6c757d"};color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:500;cursor:${canCancel ? "pointer" : "not-allowed"};" onclick="updateStatus(${o.rowIndex}, 'ยกเลิก', '${escapeHTML(o.name || "")}')">ยกเลิก</button>
      </div>`;
    list.appendChild(item);
  });
}
async function verifyPayment(rowIndex, orderId, encodedSlipLink) {
  const session = storage.getItem(SESSION_KEY);
  if (!session) { toast("Session หมดอายุ", "error"); showAdminLogin(); return; }
  
  const slipLink = decodeURIComponent(encodedSlipLink || "");

  const isConfirmed = await showCustomModal("ยืนยันการรับเงิน", `ยืนยันว่าเงินของออเดอร์ <b>${orderId}</b> เข้าบัญชีแล้วใช่มั้ย`, true, "warning", slipLink);
  if (!isConfirmed) return;
  
  try {
    const r = await (await fetchWithRetry(GOOGLE_SCRIPT_URL, { method: "POST", body: JSON.stringify({ action: "verify_payment", sessionToken: session, rowIndex }), headers: { "Content-Type": "text/plain;charset=utf-8" } }, { retries: 1, ms: 30000 })).json();
    if (r.status === "success") { toast("ยืนยันเงินแล้ว", "success"); loadAdminOrders(state.adminPage); }
    else toast(r.message || "ไม่สำเร็จ", "error");
  } catch (e) { toast("เชื่อมต่อล้มเหลว", "error"); }
}
async function rejectPayment(rowIndex, orderId) {
  const session = storage.getItem(SESSION_KEY);
  if (!session) { toast("Session หมดอายุ", "error"); showAdminLogin(); return; }
  
  const reason = prompt("เหตุผลที่สลิปไม่ผ่าน (เช่น ยอดไม่ตรง, สลิปซ้ำ):", "");
  if (reason === null) return;
  
  try {
    const r = await (await fetchWithRetry(GOOGLE_SCRIPT_URL, { method: "POST", body: JSON.stringify({ action: "reject_payment", sessionToken: session, rowIndex, reason: reason.trim() }), headers: { "Content-Type": "text/plain;charset=utf-8" } }, { retries: 1, ms: 30000 })).json();
    if (r.status === "success") { toast("ปฏิเสธสลิปแล้ว", "success"); loadAdminOrders(state.adminPage); }
    else toast(r.message || "ไม่สำเร็จ", "error");
  } catch (e) { toast("เชื่อมต่อล้มเหลว", "error"); }
}
async function updateStatus(rowIndex, newStatus, customerName) {
  const session = storage.getItem(SESSION_KEY);
  if (!session) { toast("Session หมดอายุ", "error"); showAdminLogin(); return; }
  
  const isConfirmed = await showCustomModal("เปลี่ยนสถานะ", `ต้องการเปลี่ยนสถานะเป็น <b>"${newStatus}"</b> ใช่มั้ย`, true, "warning");
  if (!isConfirmed) return;
  
  toast("กำลังบันทึกสถานะ...", "loading");
  try {
    const r = await (await fetchWithRetry(GOOGLE_SCRIPT_URL, { method: "POST", body: JSON.stringify({ action: "update_status", sessionToken: session, rowIndex, newStatus, customerName, adminName: state.adminName || "admin" }), headers: { "Content-Type": "text/plain;charset=utf-8" } }, { retries: 1, ms: 30000 })).json();
    if (r.status === "error") {
      if (r.code === "UNAUTHORIZED") { storage.removeItem(SESSION_KEY); toast("Session หมดอายุ", "error"); showAdminLogin(); }
      else toast(r.message, "error");
      return;
    }
    toast("อัปเดตสถานะแล้ว" + (r.customerNotified ? " (แจ้งเมลลูกค้า)" : ""), "success");
    loadAdminOrders(state.adminPage);
    resetAdminIdle();
  } catch (e) { toast("การเชื่อมต่อล้มเหลว: " + e.message, "error"); }
}
async function generateManualOtp() {
  const session = storage.getItem(SESSION_KEY);
  if (!session) return toast("Session หมดอายุ", "error");

  const orderId = prompt("กรุณากรอกรหัสออเดอร์ (เช่น CS69-1234):");
  if (!orderId) return;

  try {
    const r = await (await fetchWithRetry(`${GOOGLE_SCRIPT_URL}?action=admin_gen_otp&token=${encodeURIComponent(session)}&orderid=${encodeURIComponent(orderId)}`, {}, { retries: 1 })).json();
    
    if (r.status === "success") {
      showCustomModal("สร้าง OTP สำเร็จ!", `รหัส OTP ของ <b>${orderId}</b> คือ:<br><br><span style="font-size:24px;font-family:monospace;color:var(--brand-red);letter-spacing:4px;">${r.otp}</span><br><br><small>กรุณาแจ้งลูกค้าทางแชท</small>`, false, "success");
    } else {
      toast(r.message || "ไม่สำเร็จ", "error");
    }
  } catch (e) { toast("เชื่อมต่อล้มเหลว", "error"); }
}
function exportCSV() {
  if (!state.adminOrders.length) { toast("ไม่มีข้อมูล", "error"); return; }
  const headers = ["Order ID","วันที่","ชื่อ","ห้อง","โทร","อีเมล","รูปแบบ","ไซส์","ชื่อสกรีน","เบอร์","ราคา","สถานะ","ผลตรวจสลิป","สลิป"];
  const rows = state.adminOrders.map(o => [o.orderId||"",o.date?new Date(o.date).toLocaleString("th-TH"):"",o.name||"",o.classRoom||"",o.phone||"",o.email||"",o.style||"",o.size||"",o.backName||"",o.backNumber||"",o.price||"",o.status||"",o.slipReview||"",o.slipLink||""]);
  const csv = "\uFEFF" + [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "chiangsaen_orders_" + new Date().toISOString().slice(0,10) + ".csv"; a.click();
  URL.revokeObjectURL(url); toast("ดาวน์โหลด CSV แล้ว", "success");
}
async function generateStatsLink() {
  const session = storage.getItem(SESSION_KEY);
  if (!session) { toast("Session หมดอายุ", "error"); return; }
  try {
    const r = await (await fetchWithRetry(`${GOOGLE_SCRIPT_URL}?action=generate_stats_token&token=${encodeURIComponent(session)}`, {}, { retries: 1, ms: 15000 })).json();
    if (r.status !== "success" || !r.token) { toast("สร้างลิงก์ไม่สำเร็จ: " + (r.message || ""), "error"); return; }
    const url = buildShareUrl("?stats=" + encodeURIComponent(r.token));
    await copyToClipboard(url, "คัดลอกลิงก์ (สำหรับแชร์ให้ครูได้)");
  } catch (e) { toast("การเชื่อมต่อล้มเหลว: " + e.message, "error"); }
}

// ─────────────── PUBLIC LIST & STATS ───────────────
async function openPublicList() {
  $("publicListModal").style.display = "flex";
  $("publicListContent").innerHTML = "<p style='text-align:center;color:#888;'>กำลังโหลด...</p>";
  $("publicSearch").value = "";
  try {
    const r = await (await fetchWithRetry(`${GOOGLE_SCRIPT_URL}?action=get_public_list`, {}, { retries: 1, ms: 20000 })).json();
    if (r.status === "success" && Array.isArray(r.data)) { state.publicOrders = r.data; filterPublicList(); }
    else $("publicListContent").innerHTML = "<p style='text-align:center;color:#dc3545;'>โหลดไม่สำเร็จ: " + escapeHTML(r.message || "") + "</p>";
  } catch (e) { $("publicListContent").innerHTML = "<p style='text-align:center;color:#dc3545;'>เชื่อมต่อล้มเหลว: " + escapeHTML(e.message) + "</p>"; }
}
function filterPublicList() {
  const q = ($("publicSearch").value || "").trim().toLowerCase();
  const list = (state.publicOrders || []).filter(o => !q || String(o.maskedName || "").toLowerCase().includes(q) || String(o.classRoom || "").toLowerCase().includes(q));
  if (!list.length) { $("publicListContent").innerHTML = "<p style='text-align:center;color:#888;'>ไม่พบรายการ</p>"; return; }
  $("publicListContent").innerHTML = list.map(o => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-color);"><span>${escapeHTML(o.maskedName)} · ${escapeHTML(o.classRoom || "")}</span></div>`).join("");
}
(async function () {
  const p = new URLSearchParams(window.location.search);
  const id = p.get("order");
  if (id && /^CS69-\d{4}$/i.test(id)) { $("trackPhone").value = id.toUpperCase(); $("trackModal").style.display = "flex"; }
  const stats = p.get("stats");
  if (stats) await loadPublicStats(stats);
})();
async function loadPublicStats(token) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay"; overlay.id = "publicStatsModal"; overlay.style.display = "flex";
  overlay.innerHTML = `<div class="modal-content" style="max-width:500px;"><h3 style="color:var(--brand-red);">สรุปยอดคณะเชียงแสน</h3><div id="publicStatsBody"><p style="text-align:center;color:#888;">กำลังโหลด...</p></div><button style="background:transparent;border:none;color:var(--text-muted);width:100%;margin-top:16px;cursor:pointer;text-decoration:underline;" onclick="this.closest('.modal-overlay').remove()">ปิดหน้าต่าง</button></div>`;
  document.body.appendChild(overlay);
  try {
    const r = await (await fetchWithRetry(`${GOOGLE_SCRIPT_URL}?action=get_stats&token=${encodeURIComponent(token)}`, {}, { retries: 1, ms: 15000 })).json();
    if (r.status !== "success" || !r.data) throw new Error("โหลดไม่สำเร็จ");
    const s = r.data;
    const statusRows = Object.keys(s.byStatus).map(k => `<div style="display:flex;justify-content:space-between;padding:6px 0;"><span>${escapeHTML(k)}</span><span style="font-weight:600;">${s.byStatus[k]}</span></div>`).join("");
    const sizeRows = Object.keys(s.bySize).map(k => `<div style="display:flex;justify-content:space-between;padding:6px 0;"><span>ไซส์ ${escapeHTML(k)}</span><span style="font-weight:600;">${s.bySize[k]} ตัว</span></div>`).join("");
    const classRows = Object.keys(s.byClass).sort((a,b) => s.byClass[b]-s.byClass[a]).slice(0,5).map(k => `<div style="display:flex;justify-content:space-between;padding:6px 0;"><span>${escapeHTML(k)}</span><span style="font-weight:600;">${s.byClass[k]} คน</span></div>`).join("");
    $("publicStatsBody").innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;"><div style="background:var(--bg-input);padding:12px;border-radius:8px;text-align:center;"><div style="font-size:12px;color:var(--text-muted);">ออเดอร์</div><div style="font-size:24px;font-weight:700;">${s.total}</div></div><div style="background:var(--bg-input);padding:12px;border-radius:8px;text-align:center;"><div style="font-size:12px;color:var(--text-muted);">ยอดเงิน</div><div style="font-size:24px;font-weight:700;color:#28a745;">${formatTHB(s.revenue)}</div></div></div><h4 style="font-size:14px;margin:12px 0 6px;">ตามสถานะ</h4>${statusRows}<h4 style="font-size:14px;margin:12px 0 6px;">ตามไซส์</h4>${sizeRows}<h4 style="font-size:14px;margin:12px 0 6px;">Top 5 ห้องเรียน</h4>${classRows}`;
  } catch (e) { $("publicStatsBody").innerHTML = "<p style='text-align:center;color:#dc3545;'>ลิงก์หมดอายุหรือไม่ถูกต้อง</p>"; }
}
const targetPresale = new Date(2026, 10, 14, 0, 0, 0).getTime();
const targetSports  = new Date(2026, 11, 21, 8, 0, 0).getTime();
function updateCountdowns() {
  const now = Date.now();
  const dp = targetPresale - now;
  if (dp < 0) { $("cdPresale").textContent = "เปิดแล้ว"; $("cdPresale").style.color = "#198754"; }
  else { const d = Math.floor(dp/86400000), h = Math.floor((dp%86400000)/3600000), m = Math.floor((dp%3600000)/60000), s = Math.floor((dp%60000)/1000); $("cdPresale").textContent = `${d} วัน ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }
  const ds = targetSports - now;
  if (ds < 0) { $("cdSports").textContent = "ถึงวันแล้ว"; $("cdSports").style.color = "#198754"; }
  else { const d = Math.floor(ds/86400000), h = Math.floor((ds%86400000)/3600000), m = Math.floor((ds%3600000)/60000), s = Math.floor((ds%60000)/1000); $("cdSports").textContent = `${d} วัน ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }
}
setInterval(updateCountdowns, 1000); updateCountdowns();
updateSummary(); checkFormValid();

// แจ้งเตือนถ้ายังไม่ได้ตั้งค่า backend
if (!BACKEND_READY) {
  console.warn("[Chiangsaen] ยังไม่ได้ตั้งค่า googleScriptUrl ใน config.js — จะบันทึกออเดอร์ไม่ได้");
  setTimeout(() => toast("ยังไม่ได้ตั้งค่า config.js (googleScriptUrl)", "error"), 800);
}