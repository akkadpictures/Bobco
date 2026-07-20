// ============ Bob & Co — admin ============
let SETTINGS = {}, BARBERS = [], EXPCATS = [], PRICES = [], SERVICES = [], COFFEE = [], ENTRIES = [];

const RENT_ACC = "مؤونة الأجار";
const BARBER_TYPES = ["حلاقة", "خدمة", "منتج"];
const CUT_PRICES = () => ({
  "شعر": +SETTINGS.price_cut_hair || 60000,
  "دقن": +SETTINGS.price_cut_beard || 40000,
  "كامل": +SETTINGS.price_cut_full || 90000,
  "طفل": +SETTINGS.price_cut_kid || 50000
});
const svcPrice = name => { const s = SERVICES.find(x => x.name === name); return s ? +s.price : 0; };
const drinkPrice = name => { const c = COFFEE.find(x => x.name === name); return c ? +c.price : 0; };

const gate = document.getElementById("gate"), panel = document.getElementById("panel");
async function tryPin(){
  const v = document.getElementById("pin").value.trim();
  const { data } = await db.from("settings").select("value").eq("key", "admin_pin").single();
  if (data && v === data.value) {
    sessionStorage.setItem("bobco_admin", "1");
    openPanel();
  } else {
    document.getElementById("gateErr").textContent = "الرمز غلط — جرّب كمان مرة";
    document.getElementById("pin").value = "";
  }
}
document.getElementById("gateBtn").addEventListener("click", tryPin);
document.getElementById("pin").addEventListener("keydown", e => { if (e.key === "Enter") tryPin(); });
if (sessionStorage.getItem("bobco_admin")) openPanel();

document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("on", x === t));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + t.dataset.v));
}));

async function openPanel(){
  gate.style.display = "none";
  panel.style.display = "block";
  await loadAll();
  renderDash(); renderLogForm(); renderLog(); renderDay(); renderBookings(); renderSettings();
}

async function loadAll(){
  const [st, b, ec, pp, sv, cf, en] = await Promise.all([
    db.from("settings").select("*"),
    db.from("barbers").select("*").order("sort"),
    db.from("expense_categories").select("*").order("sort"),
    db.from("price_periods").select("*").order("from_date"),
    db.from("services").select("*").order("sort"),
    db.from("coffee_items").select("*").order("sort"),
    db.from("entries").select("*").order("entry_date", { ascending: false }).order("created_at", { ascending: false }),
  ]);
  SETTINGS = {}; (st.data || []).forEach(r => SETTINGS[r.key] = r.value);
  BARBERS = b.data || []; EXPCATS = ec.data || []; PRICES = pp.data || [];
  SERVICES = sv.data || []; COFFEE = cf.data || []; ENTRIES = en.data || [];
}

function priceAt(dateStr){
  let p = 0;
  for (const r of PRICES) if (r.from_date <= dateStr) p = +r.price;
  return p;
}
function commissionOf(name, dateStr){
  const b = BARBERS.find(x => x.name === name);
  if (!b) return 0;
  if (name === "علاء" && dateStr && dateStr >= "2026-08-01") return 0.5;
  return +b.commission;
}
function calc(e){
  if (e.type === "حلاقة") {
    const unit = e.sub === "آخر" ? 0 : (e.sub && CUT_PRICES()[e.sub] != null ? CUT_PRICES()[e.sub] : priceAt(e.entry_date));
    const rev = (+e.count || 0) * unit + (+e.amount || 0);
    const comm = Math.round(rev * commissionOf(e.detail, e.entry_date));
    return { rev, comm, net: rev - comm, usd: 0 };
  }
  if (e.type === "خدمة") {
    const rev = +e.amount || 0;
    const comm = commissionOf(e.detail) > 0 ? Math.round(rev * (+SETTINGS.services_commission || .5)) : 0;
    return { rev, comm, net: rev - comm, usd: 0 };
  }
  if (e.type === "منتج") {
    const rev = +e.amount || 0;
    return { rev, comm: 0, net: rev, usd: 0 };
  }
  if (e.type === "كوفي")  return { rev: +e.amount || 0, comm: 0, net: +e.amount || 0, usd: 0 };
  if (e.type === "مصروف") return { rev: +e.amount || 0, comm: 0, net: -(+e.amount || 0), usd: 0 };
  if (e.type === "دولار") return { rev: 0, comm: 0, net: 0, usd: e.rate ? (+e.amount || 0) / +e.rate : 0 };
  return { rev: 0, comm: 0, net: 0, usd: 0 };
}
function totals(list){
  const t = { hRev: 0, hComm: 0, hNet: 0, coffee: 0, exp: 0, profit: 0 };
  list.forEach(e => {
    const c = calc(e);
    if (BARBER_TYPES.includes(e.type)) { t.hRev += c.rev; t.hComm += c.comm; t.hNet += c.net; }
    if (e.type === "كوفي")  t.coffee += c.rev;
    if (e.type === "مصروف") t.exp += c.rev;
  });
  t.profit = t.hNet + t.coffee - t.exp;
  return t;
}
const inMonth = (e, ym) => e.entry_date.startsWith(ym);
const kpi = (l, v, neg, hero) => `<div class="kpi ${hero ? "hero" : ""}"><div class="l">${l}</div><div class="v ${neg && v ? "neg" : ""}">${fmtSYP(v)}</div></div>`;

const dashMonth = document.getElementById("dashMonth");
dashMonth.value = new Date().toISOString().slice(0, 7);
dashMonth.addEventListener("change", renderDash);

function renderDash(){
  const ym = dashMonth.value;
  const mE = ENTRIES.filter(e => inMonth(e, ym));
  const m = totals(mE);
  const share = k => +(SETTINGS[k] || .5);
  const pn = SETTINGS.partner_name || "الشريك";

  document.getElementById("kpis").innerHTML = `
    ${kpi("إيراد الحلاقة والخدمات", m.hRev)}
    ${kpi("عمولات الحلاقين", m.hComm)}
    ${kpi("صافي الحلاقة", m.hNet)}
    ${kpi("إيراد الكوفي", m.coffee)}
    ${kpi("المصاريف", m.exp, true)}
    ${kpi("✨ صافي الربح", m.profit, false, true)}
    ${kpi("حصتك (" + Math.round(share("owner_share") * 100) + "%)", m.profit * share("owner_share"))}
    ${kpi("حصة " + pn + " (" + Math.round(share("partner_share") * 100) + "%)", m.profit * share("partner_share"))}
  `;

  const rows = BARBERS.map(b => {
    const list = mE.filter(e => BARBER_TYPES.includes(e.type) && e.detail === b.name);
    let cnt = 0, rev = 0, comm = 0;
    list.forEach(e => { const c = calc(e); cnt += +e.count || 0; rev += c.rev; comm += c.comm; });
    return `<tr><td><strong>${b.name}</strong></td><td>${cnt}</td><td>${fmt(rev)}</td><td>${fmt(comm)}</td><td>${fmt(rev - comm)}</td></tr>`;
  }).join("");
  document.getElementById("barberStats").innerHTML =
    `<table><tr><th>الحلاق</th><th>عدد</th><th>الإيراد</th><th>العمولة</th><th>صافي للمحل</th></tr>${rows}</table>`;

  const exRows = EXPCATS.map(c => {
    const mv = mE.filter(e => e.type === "مصروف" && e.detail === c.name).reduce((s, e) => s + (+e.amount || 0), 0);
    const av = ENTRIES.filter(e => e.type === "مصروف" && e.detail === c.name).reduce((s, e) => s + (+e.amount || 0), 0);
    return av || mv ? `<tr><td>${c.name}</td><td>${fmt(mv)}</td><td>${fmt(av)}</td></tr>` : "";
  }).join("");
  document.getElementById("expStats").innerHTML = exRows
    ? `<table><tr><th>البند</th><th>هذا الشهر</th><th>الإجمالي</th></tr>${exRows}</table>`
    : `<div class="empty">ما في مصاريف مسجلة بعد</div>`;

  const dE = ENTRIES.filter(e => e.type === "دولار");
  const syp = dE.reduce((s, e) => s + (+e.amount || 0), 0);
  const usdBy = acc => dE.filter(e => e.detail === acc).reduce((s, e) => s + calc(e).usd, 0);
  const usdAll = dE.reduce((s, e) => s + calc(e).usd, 0);
  document.getElementById("usdStats").innerHTML = `<table>
    <tr><td>ليرة انقلبت لدولار</td><td>${fmtSYP(syp)}</td></tr>
    <tr><td>إجمالي الدولار</td><td><strong>${usdAll.toFixed(2)} $</strong></td></tr>
    <tr><td>منه للمحل</td><td>${usdBy("المحل").toFixed(2)} $</td></tr>
    <tr><td>منه حصتك</td><td>${usdBy("حصتي").toFixed(2)} $</td></tr>
    <tr><td>منه حصة ${pn}</td><td>${usdBy("حصة " + pn).toFixed(2)} $</td></tr>
    <tr><td>منه ${RENT_ACC}</td><td>${usdBy(RENT_ACC).toFixed(2)} $</td></tr>
  </table>`;

  const months = [...new Set(ENTRIES.map(e => e.entry_date.slice(0, 7)))].sort().reverse();
  document.getElementById("monthsStats").innerHTML = months.length
    ? `<table><tr><th>الشهر</th><th>حلاقة</th><th>كوفي</th><th>مصاريف</th><th>✨ الربح</th></tr>` +
      months.map(mm => { const t = totals(ENTRIES.filter(e => inMonth(e, mm)));
        return `<tr><td>${mm}</td><td>${fmt(t.hNet)}</td><td>${fmt(t.coffee)}</td><td class="neg">${fmt(t.exp)}</td><td><strong>${fmt(t.profit)}</strong></td></tr>`; }).join("") + `</table>`
    : `<div class="empty">لسا ما في بيانات</div>`;

  renderRent(usdBy(RENT_ACC));
  renderCash();
}

function renderCash(){
  let sypIn = 0, exp = 0, toUsd = 0, usd = 0, comm = 0;
  ENTRIES.forEach(e => {
    const c = calc(e);
    if (BARBER_TYPES.includes(e.type)) { sypIn += c.rev; comm += c.comm; }
    if (e.type === "كوفي") sypIn += c.rev;
    if (e.type === "مصروف") exp += (+e.amount || 0);
    if (e.type === "دولار") { toUsd += (+e.amount || 0); usd += c.usd; }
  });
  const syp = sypIn - comm - exp - toUsd;
  document.getElementById("cashStats").innerHTML = `<table>
    <tr><td>دخل ليرة (حلاقة + خدمات + منتجات + مشاريب)</td><td class="pos">${fmtSYP(sypIn)}</td></tr>
    <tr><td>عمولات مدفوعة للحلاقين (بتندفع بنهاية الدوام)</td><td class="neg">−${fmtSYP(comm)}</td></tr>
    <tr><td>مصاريف فعلية (كهربا وغيرها)</td><td class="neg">−${fmtSYP(exp)}</td></tr>
    <tr><td>ليرة انقلبت لدولار</td><td class="neg">−${fmtSYP(toUsd)}</td></tr>
    <tr><td><strong>رصيد الليرة بالصندوق (صافي المحل)</strong></td><td class="pos"><strong>${fmtSYP(syp)}</strong></td></tr>
    <tr><td><strong>رصيد الدولار</strong></td><td class="pos"><strong>${usd.toFixed(2)} $</strong></td></tr>
  </table>`;
}

function renderRent(collected){
  const yearly = +(SETTINGS.rent_usd_yearly || 11000);
  const paidUntilStr = SETTINGS.rent_paid_until || "2027-02-20";
  const paidUntil = new Date(paidUntilStr + "T00:00:00");
  const leaseStart = new Date(paidUntil); leaseStart.setFullYear(leaseStart.getFullYear() - 1);
  const now = new Date();

  const monthly = yearly / 12;
  let elapsed = (now.getFullYear() - leaseStart.getFullYear()) * 12 + (now.getMonth() - leaseStart.getMonth());
  if (now.getDate() >= leaseStart.getDate()) elapsed += 1;
  elapsed = Math.min(12, Math.max(0, elapsed));

  const shouldHave = elapsed * monthly;
  const gap = shouldHave - collected;
  const daysLeft = Math.max(0, Math.ceil((paidUntil - now) / 86400000));
  const pct = Math.min(100, Math.round((collected / yearly) * 100));
  const [Y, M, D] = paidUntilStr.split("-");
  const dueTxt = `${+D}/${+M}/${Y}`;

  document.getElementById("rentStats").innerHTML = `
    <table>
      <tr><td>الأجار السنوي</td><td><strong>${yearly.toFixed(0)} $</strong> — مدفوع لغاية ${dueTxt}</td></tr>
      <tr><td>المطلوب تحطوه عالجنب كل شهر</td><td><strong>${monthly.toFixed(2)} $</strong></td></tr>
      <tr><td>المفروض مجمّع لهلق (${elapsed} شهر من 12)</td><td>${shouldHave.toFixed(2)} $</td></tr>
      <tr><td>المجمّع فعلياً (حركات الدولار على حساب “${RENT_ACC}”)</td><td><strong>${collected.toFixed(2)} $</strong></td></tr>
      <tr><td>${gap > 0 ? "ناقصكن لتمشو عالجدول" : "زيادة عن الجدول 👌"}</td><td class="${gap > 0 ? "neg" : "pos"}"><strong>${Math.abs(gap).toFixed(2)} $</strong></td></tr>
      <tr><td>باقي عالدفعة الجاية</td><td>${daysLeft} يوم</td></tr>
    </table>
    <div class="rent-bar"><i style="width:${pct}%"></i></div>
    <div style="font-size:.82rem;opacity:.6">جاهزين ${pct}% من دفعة السنة الجاية — سجّلوا التحويلات من السجل اليومي ← دولار ← حساب “${RENT_ACC}”</div>`;
}

/* ---------- daily summary ---------- */
const dayPick = document.getElementById("dayPick");
dayPick.value = new Date().toISOString().slice(0, 10);
dayPick.addEventListener("change", renderDay);

function renderDay(){
  const d = dayPick.value;
  const list = ENTRIES.filter(e => e.entry_date === d);
  const t = totals(list);
  const total = t.hRev + t.coffee;

  document.getElementById("dayKpis").innerHTML = `
    ${kpi("إجمالي اليوم", total, false, true)}
    ${kpi("حصة الحلاقين", t.hComm)}
    ${kpi("مصاريف اليوم", t.exp, true)}
    ${kpi("حصة المحل", total - t.hComm - t.exp)}
  `;

  const rows = BARBERS.map(b => {
    const bl = list.filter(e => BARBER_TYPES.includes(e.type) && e.detail === b.name);
    if (!bl.length) return "";
    let cnt = 0, rev = 0, comm = 0;
    bl.forEach(e => { const c = calc(e); cnt += +e.count || 0; rev += c.rev; comm += c.comm; });
    return `<tr><td><strong>${b.name}</strong></td><td>${cnt}</td><td>${fmt(rev)}</td><td>${fmt(comm)}</td><td>${fmt(rev - comm)}</td></tr>`;
  }).join("");
  document.getElementById("dayBarbers").innerHTML = rows
    ? `<table><tr><th>الحلاق</th><th>عدد الحلاقات</th><th>المبيعات</th><th>حصة الحلاق</th><th>صافي للمحل</th></tr>${rows}</table>`
    : `<div class="empty">ما في حركات حلاقين بهاليوم بعد</div>`;
}

function renderLogForm(){
  document.getElementById("eDate").value = new Date().toISOString().slice(0, 10);
  syncLogForm();
  document.getElementById("eType").addEventListener("change", syncLogForm);
  document.getElementById("eSub").addEventListener("change", syncSubUI);
  ["eDetail", "eCount", "eAmount", "eDate"].forEach(id => {
    document.getElementById(id).addEventListener("input", commPreview);
    document.getElementById(id).addEventListener("change", commPreview);
  });
  document.getElementById("eAdd").addEventListener("click", addEntry);
  document.getElementById("eCancel").addEventListener("click", cancelEdit);
}
function syncLogForm(){
  const t = document.getElementById("eType").value;
  const dSel = document.getElementById("eDetail");
  const sSel = document.getElementById("eSub");
  const show = (id, on) => document.getElementById(id).style.display = on ? "" : "none";
  show("fDetail", t !== "كوفي");
  show("fSub", t === "حلاقة" || t === "خدمة" || t === "كوفي");
  show("fProdName", t === "منتج");
  show("fCount", t === "حلاقة" || t === "خدمة" || t === "كوفي");
  show("fRate", t === "دولار");
  document.getElementById("lAmount").textContent =
    t === "حلاقة" ? "خدمات إضافية (ل.س)" : t === "منتج" ? "سعر المنتج (ل.س)" : t === "كوفي" ? "المبلغ (ل.س) — تلقائي مع المشروب" : "المبلغ (ل.س)";
  document.querySelector("#fCount label").textContent = t === "حلاقة" ? "عدد الحلاقات" : "العدد";
  const lD = document.getElementById("lDetail");
  const lS = document.getElementById("lSub");
  const activeBarbers = BARBERS.filter(b => b.active !== false);
  if (t === "حلاقة" || t === "خدمة") { lD.textContent = "الحلاق"; dSel.innerHTML = activeBarbers.map(b => `<option>${b.name}</option>`).join(""); }
  if (t === "منتج") { lD.textContent = "البائع"; dSel.innerHTML = `<option value="المحل">🏪 المحل (بدون حلاق)</option>` + activeBarbers.map(b => `<option>${b.name}</option>`).join(""); }
  if (t === "حلاقة") { lS.textContent = "نوع الحلاقة"; sSel.innerHTML = Object.entries(CUT_PRICES()).map(([n, p]) => `<option value="${n}">${n} — ${fmt(p)}</option>`).join("") + `<option value="آخر">آخر — سعر يدوي</option>`; }
  if (t === "خدمة") { lS.textContent = "الخدمة"; sSel.innerHTML = SERVICES.filter(s => s.active !== false && ["حمام زيت", "تنضيف بشرة", "عناية وجه", "سشوار"].includes(s.name)).map(s => `<option value="${s.name}">${s.name} — ${fmt(s.price)}</option>`).join("") + `<option value="آخر">آخر — سعر يدوي</option>`; }
  if (t === "كوفي") { lS.textContent = "المشروب"; sSel.innerHTML = `<option value="">— مبلغ يدوي —</option>` + COFFEE.filter(c => c.active !== false).map(c => `<option value="${c.name}">${c.name} — ${fmt(c.price)}</option>`).join(""); }
  if (t === "مصروف") { lD.textContent = "البند"; dSel.innerHTML = EXPCATS.map(c => `<option>${c.name}</option>`).join(""); }
  if (t === "دولار") { lD.textContent = "من حساب مين"; dSel.innerHTML = ["المحل", "حصتي", "حصة " + (SETTINGS.partner_name || "الشريك"), RENT_ACC].map(x => `<option>${x}</option>`).join(""); }
  syncSubUI();
}
function syncSubUI(){
  const t = document.getElementById("eType").value;
  const sub = document.getElementById("eSub").value;
  const custom = t === "خدمة" && sub === "آخر";
  document.getElementById("fAmount").style.display = (t === "خدمة" && !custom) ? "none" : "";
  if (custom) document.getElementById("lAmount").textContent = "سعر الخدمة (ل.س)";
  if (t === "حلاقة" && sub === "آخر") document.getElementById("lAmount").textContent = "سعر الحلاقة (ل.س)";
  commPreview();
}
function commPreview(){
  const box = document.getElementById("commPrev");
  const t = document.getElementById("eType").value;
  if (!BARBER_TYPES.includes(t)) { box.innerHTML = ""; return; }
  const subVal = document.getElementById("eSub").value;
  const cnt = +document.getElementById("eCount").value || 0;
  let amount = +document.getElementById("eAmount").value || 0;
  let sub = null;
  if (t === "حلاقة") sub = subVal || "كامل";
  if (t === "خدمة") { sub = subVal; if (subVal !== "آخر") amount = svcPrice(subVal) * Math.max(1, cnt); }
  const e = { type: t, detail: document.getElementById("eDetail").value, entry_date: document.getElementById("eDate").value,
    count: t === "حلاقة" ? cnt : null, amount, sub };
  const c = calc(e);
  if (!c.rev) { box.innerHTML = ""; return; }
  const who = e.detail === "المحل" ? "المحل" : e.detail || "";
  box.innerHTML = `
    <span class="tag t-حلاقة">الإجمالي: ${fmt(c.rev)} ل.س</span>
    <span class="tag t-مصروف">عمولة ${who}: ${fmt(c.comm)} ل.س</span>
    <span class="tag t-دولار">صافي للمحل: ${fmt(c.net)} ل.س</span>`;
}
let EDIT_ID = null;
window.editEntry = id => {
  const e = ENTRIES.find(x => String(x.id) === String(id));
  if (!e) return;
  document.getElementById("eType").value = e.type;
  syncLogForm();
  document.getElementById("eDate").value = e.entry_date;
  if (e.type !== "كوفي" && e.detail) document.getElementById("eDetail").value = e.detail;
  if (e.type === "حلاقة" || e.type === "خدمة" || e.type === "كوفي") document.getElementById("eSub").value = e.sub || "";
  if (e.type === "منتج") document.getElementById("eProdName").value = e.sub || "";
  document.getElementById("eCount").value = e.count ?? "";
  document.getElementById("eAmount").value = e.amount ?? "";
  document.getElementById("eRate").value = e.rate ?? "";
  document.getElementById("eNote").value = e.note || "";
  syncSubUI();
  EDIT_ID = e.id;
  document.getElementById("eAdd").textContent = "حفظ التعديل";
  document.getElementById("eCancel").style.display = "";
  document.getElementById("eDate").scrollIntoView({ behavior: "smooth", block: "center" });
};
function cancelEdit(){
  EDIT_ID = null;
  document.getElementById("eAdd").textContent = "إضافة";
  document.getElementById("eCancel").style.display = "none";
  ["eCount", "eAmount", "eRate", "eNote", "eProdName"].forEach(i => document.getElementById(i).value = "");
  commPreview();
}
async function addEntry(){
  const t = document.getElementById("eType").value;
  const subVal = document.getElementById("eSub").value;
  const cnt = +document.getElementById("eCount").value || 0;
  let amount = +document.getElementById("eAmount").value || 0;
  let sub = null;
  if (t === "حلاقة") sub = subVal || "كامل";
  if (t === "خدمة") { sub = subVal; if (subVal !== "آخر") amount = svcPrice(subVal) * Math.max(1, cnt); }
  if (t === "منتج") sub = document.getElementById("eProdName").value.trim();
  if (t === "كوفي" && subVal) { sub = subVal; amount = drinkPrice(subVal) * Math.max(1, cnt); }
  const e = {
    entry_date: document.getElementById("eDate").value,
    type: t,
    detail: t === "كوفي" ? null : document.getElementById("eDetail").value,
    count: (t === "حلاقة" || t === "خدمة" || (t === "كوفي" && subVal)) ? Math.max(t === "حلاقة" ? 0 : 1, cnt) : null,
    amount: amount,
    rate: t === "دولار" ? +document.getElementById("eRate").value || null : null,
    sub: sub,
    note: document.getElementById("eNote").value.trim() || null,
  };
  if (!e.entry_date) return toast("اختار التاريخ");
  if (t === "حلاقة" && !e.count && !e.amount) return toast("اكتب عدد الحلاقات");
  if (t === "حلاقة" && e.sub === "آخر" && !e.amount) return toast("اكتب سعر الحلاقة");
  if (t === "خدمة" && !e.sub) return toast("اختار الخدمة");
  if (t === "خدمة" && e.sub === "آخر" && !e.amount) return toast("اكتب سعر الخدمة");
  if (t === "خدمة" && !e.count) e.count = 1;
  if (t === "منتج" && !e.sub) return toast("اكتب اسم المنتج");
  if (t !== "حلاقة" && t !== "خدمة" && !e.amount) return toast("اكتب المبلغ");
  if (t === "دولار" && !e.rate) return toast("اكتب سعر الصرف");
  const { error } = EDIT_ID
    ? await db.from("entries").update(e).eq("id", EDIT_ID)
    : await db.from("entries").insert(e);
  if (error) return toast("صار خطأ بالحفظ");
  toast(EDIT_ID ? "اتعدلت ✓" : "انحفظت ✓");
  if (EDIT_ID) cancelEdit();
  document.getElementById("eCount").value = ""; document.getElementById("eAmount").value = "";
  document.getElementById("eRate").value = ""; document.getElementById("eNote").value = "";
  document.getElementById("eProdName").value = "";
  await loadAll(); renderLog(); renderDay(); renderDash();
}
let LOG_SHOWN = 40;
function renderLog(){
  const rows = ENTRIES.slice(0, LOG_SHOWN).map(e => {
    const c = calc(e);
    const val = e.type === "دولار" ? c.usd.toFixed(2) + " $" : fmtSYP(Math.abs(e.type === "مصروف" ? c.net : c.rev || c.net));
    const bayan = (e.detail || "—") + (e.sub ? " · " + e.sub : "");
    const isB = BARBER_TYPES.includes(e.type);
    const commTxt = isB ? fmt(c.comm) : "—";
    const netTxt = isB ? fmt(c.net) : (e.type === "كوفي" ? fmt(c.net) : "—");
    return `<tr>
      <td>${e.entry_date}</td>
      <td><span class="tag t-${e.type}">${e.type}</span></td>
      <td>${bayan}</td>
      <td>${e.count ?? "—"}</td>
      <td class="${e.type === "مصروف" ? "neg" : ""}">${e.type === "مصروف" ? "−" : ""}${val}</td>
      <td class="neg">${commTxt}</td>
      <td class="pos"><strong>${netTxt}</strong></td>
      <td>${e.note || ""}</td>
      <td style="white-space:nowrap"><button class="mini" onclick="editEntry('${e.id}')">تعديل</button> <button class="mini danger" onclick="delEntry('${e.id}')">حذف</button></td>
    </tr>`;
  }).join("");
  document.getElementById("logTable").innerHTML = rows
    ? `<tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th>عدد</th><th>القيمة</th><th>العمولة</th><th>صافي للمحل</th><th>ملاحظات</th><th></th></tr>` + rows
    : `<tr><td class="empty">السجل فاضي — ضيف أول حركة من فوق</td></tr>`;

  const logTable = document.getElementById("logTable");
  let more = document.getElementById("logMore");
  if (!more && logTable) {
    more = document.createElement("div");
    more.id = "logMore";
    more.style.cssText = "text-align:center;margin-top:14px;display:flex;gap:8px;justify-content:center;align-items:center;flex-wrap:wrap";
    const host = logTable.closest("table") || logTable;
    (host.parentNode || logTable.parentNode).insertBefore(more, (host.nextSibling || null));
  }
  if (more) {
    const remaining = ENTRIES.length - LOG_SHOWN;
    if (remaining > 0) {
      more.innerHTML = `<button class="mini" onclick="showMoreLog()">▼ عرض المزيد (باقي ${remaining} حركة)</button>` +
        (LOG_SHOWN > 40 ? ` <button class="mini" onclick="showLessLog()">▲ عرض أقل</button>` : "");
    } else if (LOG_SHOWN > 40) {
      more.innerHTML = `<span style="opacity:.6;font-size:.85rem">عم تشوف كل الحركات (${ENTRIES.length})</span> <button class="mini" onclick="showLessLog()">▲ عرض أقل</button>`;
    } else {
      more.innerHTML = "";
    }
  }
}
window.showMoreLog = () => { LOG_SHOWN += 40; renderLog(); };
window.showLessLog = () => { LOG_SHOWN = 40; renderLog(); document.getElementById("logTable").scrollIntoView({ behavior: "smooth", block: "start" }); };
async function delEntry(id){
  if (!confirm("متأكد بدك تحذف هالحركة؟")) return;
  await db.from("entries").delete().eq("id", id);
  await loadAll(); renderLog(); renderDay(); renderDash();
  toast("انحذفت");
}

const bookDate = document.getElementById("bookDate");
bookDate.value = new Date().toISOString().slice(0, 10);
bookDate.addEventListener("change", renderBookings);
document.getElementById("bookAll").addEventListener("click", () => { bookDate.value = ""; renderBookings(); });

async function renderBookings(){
  let q = db.from("bookings").select("*, barbers(name), services(name, price)").order("booking_date").order("booking_time");
  if (bookDate.value) q = q.eq("booking_date", bookDate.value);
  else q = q.gte("booking_date", new Date().toISOString().slice(0, 10));
  const { data } = await q;
  const STATES = ["جديد", "مؤكد", "منجز", "ملغى"];
  const rows = (data || []).map(b => `<tr>
    <td>${b.booking_date}<br><strong>${b.booking_time}</strong></td>
    <td><strong>${b.customer_name}</strong><br><a href="tel:${b.phone}" dir="ltr">${b.phone}</a></td>
    <td>${b.barbers?.name || "—"}</td>
    <td>${b.services?.name || "—"}</td>
    <td><span class="tag s-${b.status}">${b.status}</span></td>
    <td>${STATES.filter(s => s !== b.status).map(s =>
      `<button class="mini ${s === "ملغى" ? "danger" : ""}" onclick="setBooking('${b.id}','${s}')">${s}</button>`).join(" ")}</td>
  </tr>`).join("");
  document.getElementById("bookTable").innerHTML = rows
    ? `<tr><th>الموعد</th><th>الزبون</th><th>الحلاق</th><th>الخدمة</th><th>الحالة</th><th>تغيير</th></tr>` + rows
    : `<tr><td class="empty">ما في حجوزات ${bookDate.value ? "بهاليوم" : "قادمة"}</td></tr>`;
}
async function setBooking(id, status){
  await db.from("bookings").update({ status }).eq("id", id);
  renderBookings(); toast("تحدّثت الحالة ✓");
}

function renderSettings(){
  document.getElementById("svcTable").innerHTML = editTable(SERVICES, "services",
    [["name", "الخدمة", "text"], ["price", "السعر", "number"], ["duration_min", "الدقائق", "number"]], true);
  document.getElementById("cofTable").innerHTML = editTable(COFFEE, "coffee_items",
    [["name", "المشروب", "text"], ["category", "الفئة", "text"], ["price", "السعر", "number"]], true);
  document.getElementById("barbTable").innerHTML = editTable(BARBERS, "barbers",
    [["name", "الاسم", "text"], ["title", "اللقب", "text"], ["commission", "العمولة (0.4 = 40%)", "number"]], true);
  document.getElementById("priceTable").innerHTML = editTable(PRICES, "price_periods",
    [["from_date", "من تاريخ", "date"], ["price", "السعر", "number"], ["note", "ملاحظة", "text"]], false);
  const cp = CUT_PRICES();
  document.getElementById("cutBox").innerHTML = `
    <div class="form-grid">
      <div class="field"><label>شعر</label><input class="cell" style="border:1px solid var(--line)" id="cpHair" type="number" value="${cp["شعر"]}"></div>
      <div class="field"><label>دقن</label><input class="cell" style="border:1px solid var(--line)" id="cpBeard" type="number" value="${cp["دقن"]}"></div>
      <div class="field"><label>كامل</label><input class="cell" style="border:1px solid var(--line)" id="cpFull" type="number" value="${cp["كامل"]}"></div>
      <div class="field"><label>طفل</label><input class="cell" style="border:1px solid var(--line)" id="cpKid" type="number" value="${cp["طفل"]}"></div>
      <div class="field"><label>نسبة الخدمات (0.5 = 50%)</label><input class="cell" style="border:1px solid var(--line)" id="cpSrv" type="number" step="0.05" value="${+SETTINGS.services_commission || .5}"></div>
      <div class="field"><label>نسبة المنتجات (0.5 = 50%)</label><input class="cell" style="border:1px solid var(--line)" id="cpPrd" type="number" step="0.05" value="${+SETTINGS.products_commission || .5}"></div>
      <button class="mini" onclick="saveCutPrices()">حفظ الأسعار والنسب</button>
    </div>`;
  document.getElementById("shareBox").innerHTML = `
    <div class="form-grid">
      <div class="field"><label>حصتك</label><input class="cell" style="border:1px solid var(--line)" id="shOwner" type="number" step="0.05" value="${SETTINGS.owner_share || .5}"></div>
      <div class="field"><label>حصة ${SETTINGS.partner_name || "الشريك"}</label><input class="cell" style="border:1px solid var(--line)" id="shPartner" type="number" step="0.05" value="${SETTINGS.partner_share || .5}"></div>
      <button class="mini" onclick="saveShares()">حفظ النسب</button>
    </div>`;
}
function editTable(list, table, cols, canToggle){
  if (!list.length) return `<div class="empty">فاضي</div>`;
  return `<table><tr>${cols.map(c => `<th>${c[1]}</th>`).join("")}<th></th></tr>` +
    list.map(r => `<tr>
      ${cols.map(c => `<td><input class="cell" type="${c[2]}" value="${r[c[0]] ?? ""}" ${c[2] === "number" ? 'step="any" inputmode="numeric"' : ""} onchange="saveField('${table}',${JSON.stringify(r.id)},'${c[0]}',this.value)"></td>`).join("")}
      <td>${canToggle ? `<button class="mini ${r.active ? "danger" : ""}" onclick="toggleRow('${table}',${JSON.stringify(r.id)},${!r.active})">${r.active ? "إخفاء" : "إظهار"}</button>` : ""}</td>
    </tr>`).join("") + `</table>`;
}
async function saveField(table, id, field, value){
  const { error } = await db.from(table).update({ [field]: value === "" ? null : value }).eq("id", id);
  if (error) return toast("ما انحفظ — تأكد من القيمة");
  toast("انحفظ ✓"); await loadAll(); renderDash();
}
async function toggleRow(table, id, active){
  await db.from(table).update({ active }).eq("id", id);
  await loadAll(); renderSettings(); syncLogForm(); toast(active ? "صار ظاهر بالموقع" : "انخفى من الموقع");
}
async function addService(){
  await db.from("services").insert({ name: "خدمة جديدة", price: 0, sort: SERVICES.length + 1 });
  await loadAll(); renderSettings();
}
async function addCoffee(){
  await db.from("coffee_items").insert({ name: "مشروب جديد", category: "مشروبات ساخنة", price: 0, sort: COFFEE.length + 1 });
  await loadAll(); renderSettings();
}
async function addBarber(){
  const name = prompt("اسم الحلاق الجديد:");
  if (!name || !name.trim()) return;
  await db.from("barbers").insert({ name: name.trim(), title: "حلاق", commission: 0.4, active: true, sort: BARBERS.length + 1 });
  await loadAll(); renderSettings(); syncLogForm(); toast("انضاف ✓");
}
async function addPrice(){
  await db.from("price_periods").insert({ from_date: new Date().toISOString().slice(0, 10), price: 0, note: "عرض جديد" });
  await loadAll(); renderSettings();
}
async function saveCutPrices(){
  await db.from("settings").upsert([
    { key: "price_cut_hair", value: String(+document.getElementById("cpHair").value || 60000) },
    { key: "price_cut_beard", value: String(+document.getElementById("cpBeard").value || 40000) },
    { key: "price_cut_full", value: String(+document.getElementById("cpFull").value || 90000) },
    { key: "price_cut_kid", value: String(+document.getElementById("cpKid").value || 50000) },
    { key: "services_commission", value: String(+document.getElementById("cpSrv").value || .5) },
    { key: "products_commission", value: String(+document.getElementById("cpPrd").value || .5) },
  ]);
  await loadAll(); renderSettings(); syncLogForm(); renderDay(); renderDash(); toast("انحفظت ✓");
}
async function saveShares(){
  const o = +document.getElementById("shOwner").value, p = +document.getElementById("shPartner").value;
  if (Math.abs(o + p - 1) > .001) return toast("⚠ مجموع النسب لازم يساوي 1");
  await db.from("settings").upsert([{ key: "owner_share", value: String(o) }, { key: "partner_share", value: String(p) }]);
  await loadAll(); renderDash(); toast("انحفظت النسب ✓");
}
async function savePin(){
  const v = document.getElementById("newPin").value.trim();
  if (v.length < 4) return toast("الرمز لازم يكون 4 خانات عالأقل");
  await db.from("settings").upsert({ key: "admin_pin", value: v });
  document.getElementById("newPin").value = "";
  toast("تغيّر الرمز ✓");
}
