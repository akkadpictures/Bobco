// ============ Bob & Co — admin ============
let SETTINGS = {}, BARBERS = [], EXPCATS = [], PRICES = [], SERVICES = [], COFFEE = [], ENTRIES = [], PRODUCTS = [];

const RENT_ACC = "مؤونة الأجار";
const BARBER_TYPES = ["حلاقة", "خدمة", "منتج"];
const CUT_PRICES = () => {
  const svc = n => { const s = SERVICES.find(x => x.name === n); return s ? +s.price : 0; };
  return {
    "شعر": +SETTINGS.price_cut_hair || 60000,
    "دقن": +SETTINGS.price_cut_beard || 40000,
    "كامل": +SETTINGS.price_cut_full || 90000,
    "طفل": +SETTINGS.price_cut_kid || 50000,
    "ستايل": svc("ستايل") || 30000,
    "شمع": svc("شمع") || 20000
  };
};
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
  renderDash(); renderLogForm(); renderLog(); renderDay(); renderBookings(); renderSettings(); renderStats();
}

async function loadAll(){
  const [st, b, ec, pp, sv, cf, en, pr] = await Promise.all([
    db.from("settings").select("*"),
    db.from("barbers").select("*").order("sort"),
    db.from("expense_categories").select("*").order("sort"),
    db.from("price_periods").select("*").order("from_date"),
    db.from("services").select("*").order("sort"),
    db.from("coffee_items").select("*").order("sort"),
    db.from("entries").select("*").order("entry_date", { ascending: false }).order("created_at", { ascending: false }),
    db.from("products").select("*").order("sort"),
  ]);
  SETTINGS = {}; (st.data || []).forEach(r => SETTINGS[r.key] = r.value);
  BARBERS = b.data || []; EXPCATS = ec.data || []; PRICES = pp.data || [];
  SERVICES = sv.data || []; COFFEE = cf.data || []; ENTRIES = en.data || []; PRODUCTS = pr.data || [];
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
    const sale = +e.amount || 0;
    const cost = +e.cost || 0;
    const profit = sale - cost;
    return { rev: sale, comm: 0, net: profit, usd: 0 };
  }
  if (e.type === "كوفي")  return { rev: +e.amount || 0, comm: 0, net: +e.amount || 0, usd: 0 };
  if (e.type === "مصروف" || e.type === "مصروف شهري") return { rev: +e.amount || 0, comm: 0, net: -(+e.amount || 0), usd: 0 };
  if (e.type === "رصيد سابق") return { rev: +e.amount || 0, comm: 0, net: +e.amount || 0, usd: 0 };
  if (e.type === "دولار") return { rev: 0, comm: 0, net: 0, usd: e.rate ? (+e.amount || 0) / +e.rate : 0 };
  return { rev: 0, comm: 0, net: 0, usd: 0 };
}
function totals(list){
  const t = { hRev: 0, hComm: 0, hNet: 0, products: 0, productSales: 0, coffee: 0, exp: 0, profit: 0, prevBal: 0 };
  list.forEach(e => {
    const c = calc(e);
    if (e.type === "حلاقة" || e.type === "خدمة") { t.hRev += c.rev; t.hComm += c.comm; t.hNet += c.net; }
    if (e.type === "منتج") { t.products += c.net; t.productSales += c.rev; }
    if (e.type === "كوفي")  t.coffee += c.rev;
    if (e.type === "مصروف" || e.type === "مصروف شهري") t.exp += c.rev;
    if (e.type === "رصيد سابق") t.prevBal += c.net;
  });
  // الربح العادي (حلاقة+منتجات+كوفي-مصاريف) + الرصيد السابق (للأشهر القديمة)
  t.profit = t.hNet + t.products + t.coffee - t.exp + t.prevBal;
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
    ${kpi("مبيعات المنتجات", m.productSales)}
    ${kpi("ربح المنتجات", m.products)}
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

  const isExp = e => e.type === "مصروف" || e.type === "مصروف شهري";
  const exRows = EXPCATS.map(c => {
    const mv = mE.filter(e => isExp(e) && e.detail === c.name).reduce((s, e) => s + (+e.amount || 0), 0);
    const av = ENTRIES.filter(e => isExp(e) && e.detail === c.name).reduce((s, e) => s + (+e.amount || 0), 0);
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
    ? `<table><tr><th>الشهر</th><th>حلاقة</th><th>منتجات</th><th>كوفي</th><th>مصاريف</th><th>✨ الربح</th></tr>` +
      months.map(mm => { const t = totals(ENTRIES.filter(e => inMonth(e, mm)));
        return `<tr><td>${mm}</td><td>${fmt(t.hNet)}</td><td>${fmt(t.products)}</td><td>${fmt(t.coffee)}</td><td class="neg">${fmt(t.exp)}</td><td><strong>${fmt(t.profit)}</strong></td></tr>`; }).join("") + `</table>`
    : `<div class="empty">لسا ما في بيانات</div>`;

  renderRent(usdBy(RENT_ACC));
  renderCash();
}

function renderCash(){
  // رصيد صندوق تموز (شغل النظام من 1 تموز)
  const CASH_START = "2026-07-01";
  let sypIn = 0, exp = 0, comm = 0;
  ENTRIES.forEach(e => {
    if (e.entry_date < CASH_START) return;
    const c = calc(e);
    if (e.type === "حلاقة" || e.type === "خدمة") { sypIn += c.rev; comm += c.comm; }
    if (e.type === "منتج") sypIn += c.net;
    if (e.type === "كوفي") sypIn += c.rev;
    if (e.type === "مصروف" || e.type === "مصروف شهري") exp += (+e.amount || 0);
  });
  const julySyp = sypIn - comm - exp;

  // التحويشة (ما قبل تموز) — من الإعدادات
  const openSyp = +(SETTINGS.opening_syp || 0);
  const openUsd = +(SETTINGS.opening_usd || 0);

  // الصندوق الفعلي — ليرة ودولار منفصلين (بدون تحويل)
  const totalSyp = julySyp + openSyp;

  document.getElementById("cashStats").innerHTML = `<table>
    <tr><td colspan="2" style="padding-top:2px;font-size:.82rem;opacity:.65;font-weight:800">💰 صندوقك الفعلي — كل اللي معك</td></tr>
    <tr><td><strong>رصيد الليرة الكلي</strong></td><td class="pos"><strong style="font-size:1.2rem">${fmtSYP(totalSyp)}</strong></td></tr>
    <tr><td><strong>رصيد الدولار الكلي</strong></td><td class="pos"><strong style="font-size:1.2rem">${openUsd.toFixed(0)} $</strong></td></tr>
    <tr><td colspan="2" style="padding-top:14px;font-size:.8rem;opacity:.55;font-weight:800">التفصيل ↓</td></tr>
    <tr><td>&nbsp;&nbsp;صندوق المحل (تموز)</td><td>${fmtSYP(julySyp)}</td></tr>
    <tr><td>&nbsp;&nbsp;ما قبل تموز — ليرة</td><td>${fmtSYP(openSyp)}</td></tr>
    <tr><td>&nbsp;&nbsp;ما قبل تموز — دولار</td><td>${openUsd.toFixed(0)} $</td></tr>
  </table>
  <div style="margin-top:10px;font-size:.8rem;opacity:.6;line-height:1.7">
    💡 الليرة والدولار منفصلين متل ما هم فعلياً. الدولار جاهز للأجار وقت ما تحب.
  </div>`;
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
  // المصاريف (عادي + شهري) ما بتظهر بصورة اليوم — بس بالملخص الشهري
  const list = ENTRIES.filter(e => e.entry_date === d && e.type !== "مصروف شهري" && e.type !== "مصروف");
  const t = totals(list);
  // إجمالي اليوم = الكاش الفعلي اللي دخل (المنتجات بسعر البيع الكامل)
  const total = t.hRev + t.productSales + t.coffee;
  const prodCost = t.productSales - t.products; // تكلفة المنتجات المباعة
  const shopShare = total - t.hComm - prodCost;

  document.getElementById("dayKpis").innerHTML = `
    ${kpi("إجمالي اليوم (الكاش الداخل)", total, false, true)}
    ${kpi("إيراد الحلاقة والخدمات", t.hRev)}
    ${kpi("مبيعات المنتجات", t.productSales)}
    ${kpi("ربح المنتجات", t.products)}
    ${kpi("إيراد الكوفي", t.coffee)}
    ${kpi("حصة الحلاقين", t.hComm)}
    ${kpi("تكلفة المنتجات", prodCost, true)}
    ${kpi("حصة المحل", shopShare)}
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
  ["eDetail", "eCount", "eAmount", "eDate", "eCost", "eExtra"].forEach(id => {
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
  show("fProdSelect", t === "منتج");
  show("fProdName", false);
  show("fCost", t === "منتج");
  show("fExtra", t === "منتج");
  show("fCount", t === "حلاقة" || t === "خدمة" || t === "كوفي");
  show("fRate", t === "دولار");
  document.getElementById("lAmount").textContent =
    t === "حلاقة" ? "خدمات إضافية (ل.س)" : t === "منتج" ? "سعر البيع (ل.س)" : t === "كوفي" ? "المبلغ (ل.س) — تلقائي مع المشروب" : "المبلغ (ل.س)";
  document.querySelector("#fCount label").textContent = t === "حلاقة" ? "عدد الحلاقات" : "العدد";
  const lD = document.getElementById("lDetail");
  const lS = document.getElementById("lSub");
  const activeBarbers = BARBERS.filter(b => b.active !== false);
  if (t === "حلاقة" || t === "خدمة") { lD.textContent = "الحلاق"; dSel.innerHTML = activeBarbers.map(b => `<option>${b.name}</option>`).join(""); }
  if (t === "منتج") {
    lD.textContent = "البائع"; dSel.innerHTML = `<option value="المحل">🏪 المحل (بدون حلاق)</option>` + activeBarbers.map(b => `<option>${b.name}</option>`).join("");
    const pSel = document.getElementById("eProdSelect");
    pSel.innerHTML = PRODUCTS.filter(p => p.active !== false).map(p => `<option value="${p.name}">${p.name} — بيع ${fmt(p.price)} / تكلفة ${fmt(p.cost)}</option>`).join("") + `<option value="__manual">✏️ منتج آخر (يدوي)</option>`;
    pSel.onchange = applyProductPick;
    applyProductPick();
  }
  if (t === "حلاقة") { lS.textContent = "نوع الحلاقة"; sSel.innerHTML = Object.entries(CUT_PRICES()).map(([n, p]) => `<option value="${n}">${n} — ${fmt(p)}</option>`).join("") + `<option value="آخر">آخر — سعر يدوي</option>`; }
  if (t === "خدمة") { lS.textContent = "الخدمة"; sSel.innerHTML = SERVICES.filter(s => s.active !== false && s.section === "عناية").map(s => `<option value="${s.name}">${s.name}${+s.price ? " — " + fmt(s.price) : " — حسب الطلب"}</option>`).join("") + `<option value="آخر">آخر — سعر يدوي</option>`; }
  if (t === "كوفي") { lS.textContent = "المشروب"; sSel.innerHTML = `<option value="">— مبلغ يدوي —</option>` + COFFEE.filter(c => c.active !== false).map(c => `<option value="${c.name}">${c.name} — ${fmt(c.price)}</option>`).join(""); }
  if (t === "مصروف" || t === "مصروف شهري") { lD.textContent = "البند"; dSel.innerHTML = EXPCATS.map(c => `<option>${c.name}</option>`).join(""); }
  if (t === "دولار") { lD.textContent = "من حساب مين"; dSel.innerHTML = ["المحل", "حصتي", "حصة " + (SETTINGS.partner_name || "الشريك"), RENT_ACC].map(x => `<option>${x}</option>`).join(""); }
  syncSubUI();
}
function applyProductPick(){
  const pSel = document.getElementById("eProdSelect");
  const nameField = document.getElementById("fProdName");
  const sel = pSel.value;
  if (sel === "__manual") {
    nameField.style.display = "";
    document.getElementById("eProdName").value = "";
    document.getElementById("eAmount").value = "";
    document.getElementById("eCost").value = "";
  } else {
    nameField.style.display = "none";
    const p = PRODUCTS.find(x => x.name === sel);
    if (p) {
      document.getElementById("eProdName").value = p.name;
      document.getElementById("eAmount").value = +p.price || 0;
      document.getElementById("eCost").value = +p.cost || 0;
    }
  }
  commPreview();
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
  if (t === "منتج") {
    const sale = (+document.getElementById("eAmount").value || 0) + (+document.getElementById("eExtra").value || 0);
    const cost = +document.getElementById("eCost").value || 0;
    const profit = sale - cost;
    box.innerHTML = `
      <span class="tag t-حلاقة">سعر البيع: ${fmt(sale)} ل.س</span>
      <span class="tag t-مصروف">التكلفة: ${fmt(cost)} ل.س</span>
      <span class="tag t-دولار">الربح: ${fmt(profit)} ل.س</span>`;
    return;
  }
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
  if (e.type === "منتج") {
    const pSel = document.getElementById("eProdSelect");
    const known = PRODUCTS.find(p => p.name === e.sub);
    pSel.value = known ? e.sub : "__manual";
    applyProductPick();
    if (!known) document.getElementById("eProdName").value = e.sub || "";
    document.getElementById("eAmount").value = e.amount ?? "";
    document.getElementById("eCost").value = e.cost ?? "";
    document.getElementById("eExtra").value = "";
  }
  document.getElementById("eCount").value = e.count ?? "";
  if (e.type !== "منتج") document.getElementById("eAmount").value = e.amount ?? "";
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
  ["eCount", "eAmount", "eRate", "eNote", "eProdName", "eCost", "eExtra"].forEach(i => document.getElementById(i).value = "");
  commPreview();
}
async function addEntry(){
  const t = document.getElementById("eType").value;
  const subVal = document.getElementById("eSub").value;
  const cnt = +document.getElementById("eCount").value || 0;
  let amount = +document.getElementById("eAmount").value || 0;
  let cost = 0;
  let sub = null;
  if (t === "حلاقة") sub = subVal || "كامل";
  if (t === "خدمة") { sub = subVal; if (subVal !== "آخر") amount = svcPrice(subVal) * Math.max(1, cnt); }
  if (t === "منتج") {
    const pSel = document.getElementById("eProdSelect").value;
    sub = pSel === "__manual" ? document.getElementById("eProdName").value.trim() : pSel;
    amount = amount + (+document.getElementById("eExtra").value || 0); // سعر البيع + إضافي
    cost = +document.getElementById("eCost").value || 0;
  }
  if (t === "كوفي" && subVal) { sub = subVal; amount = drinkPrice(subVal) * Math.max(1, cnt); }
  const e = {
    entry_date: document.getElementById("eDate").value,
    type: t,
    detail: t === "كوفي" ? null : document.getElementById("eDetail").value,
    count: (t === "حلاقة" || t === "خدمة" || (t === "كوفي" && subVal)) ? Math.max(t === "حلاقة" ? 0 : 1, cnt) : null,
    amount: amount,
    cost: t === "منتج" ? cost : 0,
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
  document.getElementById("eCost").value = ""; document.getElementById("eExtra").value = "";
  await loadAll(); renderLog(); renderDay(); renderDash();
}
let LOG_SHOWN = 40;
function renderLog(){
  const rows = ENTRIES.slice(0, LOG_SHOWN).map(e => {
    const c = calc(e);
    const isExp = e.type === "مصروف" || e.type === "مصروف شهري";
    const val = e.type === "دولار" ? c.usd.toFixed(2) + " $" : fmtSYP(Math.abs(isExp ? c.net : c.rev || c.net));
    const bayan = (e.detail || "—") + (e.sub ? " · " + e.sub : "");
    const isB = BARBER_TYPES.includes(e.type);
    const commTxt = isB ? fmt(c.comm) : "—";
    const netTxt = isB ? fmt(c.net) : (e.type === "كوفي" ? fmt(c.net) : "—");
    return `<tr>
      <td>${e.entry_date}</td>
      <td><span class="tag t-${e.type === "مصروف شهري" ? "مصروف" : e.type}">${e.type}</span></td>
      <td>${bayan}</td>
      <td>${e.count ?? "—"}</td>
      <td class="${isExp ? "neg" : ""}">${isExp ? "−" : ""}${val}</td>
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
    [["name", "الخدمة", "text"], ["section", "القسم", ["حلاقة","عناية"]], ["price", "السعر", "number"], ["duration_min", "الدقائق", "number"], ["description", "وصف صغير (اختياري)", "text"]], true);
  const prodBox = document.getElementById("prodTable");
  if (prodBox) prodBox.innerHTML = editTable(PRODUCTS, "products",
    [["name", "المنتج", "text"], ["price", "سعر البيع", "number"], ["cost", "التكلفة", "number"]], true);
  document.getElementById("cofTable").innerHTML = editTable(COFFEE, "coffee_items",
    [["name", "المشروب", "text"], ["category", "الفئة", "text"], ["price", "السعر", "number"]], true);
  document.getElementById("barbTable").innerHTML = editTable(BARBERS, "barbers",
    [["name", "الاسم", "text"], ["title", "اللقب", "text"], ["commission", "العمولة (0.4 = 40%)", "number"]], true);
  document.getElementById("priceTable").innerHTML = editTable(PRICES, "price_periods",
    [["from_date", "من تاريخ", "date"], ["price", "السعر", "number"], ["note", "ملاحظة", "text"]], false);
  const expBox = document.getElementById("expTable");
  if (expBox) expBox.innerHTML = editTable(EXPCATS, "expense_categories",
    [["name", "البند", "text"]], false, true);
  const cp = CUT_PRICES();
  document.getElementById("cutBox").innerHTML = `
    <div class="form-grid">
      <div class="field"><label>شعر</label><input class="cell" style="border:1px solid var(--line)" id="cpHair" type="number" value="${cp["شعر"]}"></div>
      <div class="field"><label>دقن</label><input class="cell" style="border:1px solid var(--line)" id="cpBeard" type="number" value="${cp["دقن"]}"></div>
      <div class="field"><label>كامل</label><input class="cell" style="border:1px solid var(--line)" id="cpFull" type="number" value="${cp["كامل"]}"></div>
      <div class="field"><label>طفل</label><input class="cell" style="border:1px solid var(--line)" id="cpKid" type="number" value="${cp["طفل"]}"></div>
      <div class="field"><label>نسبة الخدمات (0.5 = 50%)</label><input class="cell" style="border:1px solid var(--line)" id="cpSrv" type="number" step="0.05" value="${+SETTINGS.services_commission || .5}"></div>
      <button class="mini" onclick="saveCutPrices()">حفظ الأسعار والنسب</button>
    </div>`;
  document.getElementById("shareBox").innerHTML = `
    <div class="form-grid">
      <div class="field"><label>حصتك</label><input class="cell" style="border:1px solid var(--line)" id="shOwner" type="number" step="0.05" value="${SETTINGS.owner_share || .5}"></div>
      <div class="field"><label>حصة ${SETTINGS.partner_name || "الشريك"}</label><input class="cell" style="border:1px solid var(--line)" id="shPartner" type="number" step="0.05" value="${SETTINGS.partner_share || .5}"></div>
      <button class="mini" onclick="saveShares()">حفظ النسب</button>
    </div>`;
  const shopBox = document.getElementById("shopBox");
  if (shopBox) shopBox.innerHTML = `
    <div class="form-grid">
      <div class="field"><label>العنوان (بيظهر بأسفل الموقع)</label><input class="cell" style="border:1px solid var(--line)" id="shopAddr" type="text" value="${SETTINGS.shop_address || ""}"></div>
      <div class="field"><label>حساب إنستغرام (بدون @)</label><input class="cell" style="border:1px solid var(--line)" id="shopInsta" type="text" value="${SETTINGS.shop_instagram || ""}"></div>
      <div class="field"><label>نص ساعات الدوام</label><input class="cell" style="border:1px solid var(--line)" id="shopHours" type="text" value="${SETTINGS.shop_hours_text || ""}"></div>
      <div class="field"><label>وقت الفتح (للحجز)</label><input class="cell" style="border:1px solid var(--line)" id="shopOpen" type="time" value="${SETTINGS.open_time || "11:00"}"></div>
      <div class="field"><label>وقت الإغلاق (للحجز)</label><input class="cell" style="border:1px solid var(--line)" id="shopClose" type="time" value="${SETTINGS.close_time || "23:00"}"></div>
      <button class="mini" onclick="saveShopInfo()">حفظ معلومات المحل</button>
    </div>
    <div style="border-top:1px solid var(--line);margin:18px 0 14px"></div>
    <h2 style="font-size:.98rem">🏦 رصيد ما قبل تموز (شغلك القديم)</h2>
    <p class="muted" style="margin:-6px 0 12px">اللي جمعته قبل ما يبلّش النظام. بينضاف للصندوق والإحصائيات. سعر الصرف للعرض بالإحصائيات فقط.</p>
    <div class="form-grid">
      <div class="field"><label>ليرة قديمة (ل.س)</label><input class="cell" style="border:1px solid var(--line)" id="openSyp" type="number" value="${SETTINGS.opening_syp || 0}"></div>
      <div class="field"><label>دولار قديم ($)</label><input class="cell" style="border:1px solid var(--line)" id="openUsd" type="number" value="${SETTINGS.opening_usd || 0}"></div>
      <div class="field"><label>سعر صرف الدولار (ل.س)</label><input class="cell" style="border:1px solid var(--line)" id="usdRate" type="number" value="${SETTINGS.usd_rate || 13000}"></div>
      <button class="mini" onclick="saveOpening()">حفظ</button>
    </div>`;
}
function editTable(list, table, cols, canToggle, canDelete){
  if (!list.length) return `<div class="empty">فاضي</div>`;
  const cell = (r, c) => {
    if (Array.isArray(c[2])) { // select: c[2] = array of options
      return `<select class="cell" style="border:1px solid var(--line)" onchange="saveField('${table}',${JSON.stringify(r.id)},'${c[0]}',this.value)">` +
        c[2].map(o => `<option ${String(r[c[0]] ?? "") === o ? "selected" : ""}>${o}</option>`).join("") + `</select>`;
    }
    return `<input class="cell" type="${c[2]}" value="${r[c[0]] ?? ""}" ${c[2] === "number" ? 'step="any" inputmode="numeric"' : ""} onchange="saveField('${table}',${JSON.stringify(r.id)},'${c[0]}',this.value)">`;
  };
  return `<table><tr>${cols.map(c => `<th>${c[1]}</th>`).join("")}<th></th></tr>` +
    list.map(r => `<tr>
      ${cols.map(c => `<td>${cell(r, c)}</td>`).join("")}
      <td style="white-space:nowrap">${canToggle ? `<button class="mini ${r.active ? "danger" : ""}" onclick="toggleRow('${table}',${JSON.stringify(r.id)},${!r.active})">${r.active ? "إخفاء" : "إظهار"}</button>` : ""}${canDelete ? ` <button class="mini danger" onclick="deleteRow('${table}',${JSON.stringify(r.id)})">حذف</button>` : ""}</td>
    </tr>`).join("") + `</table>`;
}
async function deleteRow(table, id){
  if (!confirm("متأكد بدك تحذف؟")) return;
  await db.from(table).delete().eq("id", id);
  await loadAll(); renderSettings(); syncLogForm(); renderDash(); toast("انحذف");
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
  await db.from("services").insert({ name: "خدمة جديدة", price: 0, section: "حلاقة", sort: SERVICES.length + 1 });
  await loadAll(); renderSettings(); toast("انضافت — عدّل الاسم والقسم والسعر");
}
async function addCoffee(){
  await db.from("coffee_items").insert({ name: "مشروب جديد", category: "مشروبات ساخنة", price: 0, sort: COFFEE.length + 1 });
  await loadAll(); renderSettings();
}
async function addProduct(){
  await db.from("products").insert({ name: "منتج جديد", price: 0, cost: 0, active: true, sort: PRODUCTS.length + 1 });
  await loadAll(); renderSettings(); syncLogForm(); toast("انضاف — عدّل الاسم وسعر البيع والتكلفة");
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
  ]);
  await loadAll(); renderSettings(); syncLogForm(); renderDay(); renderDash(); toast("انحفظت ✓");
}
async function saveShares(){
  const o = +document.getElementById("shOwner").value, p = +document.getElementById("shPartner").value;
  if (Math.abs(o + p - 1) > .001) return toast("⚠ مجموع النسب لازم يساوي 1");
  await db.from("settings").upsert([{ key: "owner_share", value: String(o) }, { key: "partner_share", value: String(p) }]);
  await loadAll(); renderDash(); toast("انحفظت النسب ✓");
}
async function saveShopInfo(){
  await db.from("settings").upsert([
    { key: "shop_address", value: document.getElementById("shopAddr").value.trim() },
    { key: "shop_instagram", value: document.getElementById("shopInsta").value.trim().replace(/^@/, "") },
    { key: "shop_hours_text", value: document.getElementById("shopHours").value.trim() },
    { key: "open_time", value: document.getElementById("shopOpen").value || "11:00" },
    { key: "close_time", value: document.getElementById("shopClose").value || "23:00" },
  ]);
  await loadAll(); toast("انحفظت معلومات المحل ✓ — بتظهر بالموقع خلال دقيقة");
}
async function saveOpening(){
  await db.from("settings").upsert([
    { key: "opening_syp", value: String(+document.getElementById("openSyp").value || 0) },
    { key: "opening_usd", value: String(+document.getElementById("openUsd").value || 0) },
    { key: "usd_rate", value: String(+document.getElementById("usdRate").value || 13000) },
  ]);
  await loadAll(); renderDash(); renderStats(); toast("انحفظ ✓");
}
async function addExpCat(){
  const name = prompt("اسم البند الجديد (مثال: أجار):");
  if (!name || !name.trim()) return;
  await db.from("expense_categories").insert({ name: name.trim(), sort: (EXPCATS.length ? Math.max(...EXPCATS.map(c => +c.sort || 0)) : 0) + 1 });
  await loadAll(); renderSettings(); syncLogForm(); toast("انضاف البند ✓");
}
async function savePin(){
  const v = document.getElementById("newPin").value.trim();
  if (v.length < 4) return toast("الرمز لازم يكون 4 خانات عالأقل");
  await db.from("settings").upsert({ key: "admin_pin", value: v });
  document.getElementById("newPin").value = "";
  toast("تغيّر الرمز ✓");
}

/* ============ 📈 الإحصائيات ============ */
const AR_MONTHS = ["كانون الثاني","شباط","آذار","نيسان","أيار","حزيران","تموز","آب","أيلول","تشرين الأول","تشرين الثاني","كانون الأول"];
const AR_DAYS = ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
const monthLabel = ym => { const [y,m]=ym.split("-"); return AR_MONTHS[+m-1]+" "+y; };
const CHART_COLORS = ["#5a6b3b","#c9a227","#8a9b5e","#b5843a","#6b8fa3","#a3546b","#7a6ba3","#a37a54"];

const statRange = document.getElementById("statRange");
if (statRange) statRange.addEventListener("change", renderStats);

// نضيف خيارات السنين تلقائياً حسب البيانات الموجودة
function ensureYearOptions(){
  if (!statRange) return;
  const years = [...new Set(ENTRIES.filter(e => e.entry_date >= "2026-07-01" || e.type === "رصيد سابق").map(e => e.entry_date.slice(0,4)))].sort();
  years.forEach(y => {
    if (![...statRange.options].some(o => o.value === "year-" + y)) {
      const opt = document.createElement("option");
      opt.value = "year-" + y;
      opt.textContent = "سنة " + y;
      statRange.appendChild(opt);
    }
  });
}

function statEntries(){
  // حركات النظام من 1 تموز + حركات "رصيد سابق" (أيار/حزيران للمقارنة)
  let list = ENTRIES.filter(e => e.entry_date >= "2026-07-01" || e.type === "رصيد سابق");
  const r = statRange ? statRange.value : "all";
  const allMonths = [...new Set(list.map(e => e.entry_date.slice(0,7)))].sort();

  if (r === "current") {
    const cur = allMonths[allMonths.length - 1]; // آخر شهر فيه بيانات
    list = list.filter(e => e.entry_date.slice(0,7) === cur);
  } else if (r === "3" || r === "6") {
    const months = allMonths.slice().reverse().slice(0, +r);
    list = list.filter(e => months.includes(e.entry_date.slice(0,7)));
  } else if (r.startsWith("year-")) {
    const y = r.slice(5);
    list = list.filter(e => e.entry_date.slice(0,4) === y);
  }
  // "all" = كل الأشهر (بدون فلترة)
  return list;
}

function renderStats(){
  if (!document.getElementById("statHighlights")) return;
  ensureYearOptions();
  const list = statEntries();

  // ---- تجميع شهري ----
  const byMonth = {};
  list.forEach(e => {
    const ym = e.entry_date.slice(0,7);
    if (!byMonth[ym]) byMonth[ym] = [];
    byMonth[ym].push(e);
  });
  const months = Object.keys(byMonth).sort();
  const monthTotals = months.map(ym => ({ ym, t: totals(byMonth[ym]) }));

  // ---- البطاقات المميزة ----
  const allT = totals(list);
  // أفضل شهر (بالربح)
  let bestMonth = null;
  monthTotals.forEach(m => { if (!bestMonth || m.t.profit > bestMonth.t.profit) bestMonth = m; });
  // مقارنة آخر شهرين
  let trend = null;
  if (monthTotals.length >= 2) {
    const cur = monthTotals[monthTotals.length-1].t.profit;
    const prev = monthTotals[monthTotals.length-2].t.profit;
    if (prev > 0) trend = ((cur - prev) / prev * 100);
  }
  // متوسط الدخل اليومي
  const days = [...new Set(list.filter(e => e.type!=="مصروف"&&e.type!=="مصروف شهري"&&e.type!=="دولار").map(e=>e.entry_date))];
  const totalRev = allT.hRev + allT.productSales + allT.coffee;
  const avgDay = days.length ? totalRev / days.length : 0;

  const trendTag = trend===null ? "" :
    `<span class="trend ${trend>2?"up":trend<-2?"down":"flat"}">${trend>0?"▲":trend<0?"▼":"■"} ${Math.abs(trend).toFixed(0)}%</span>`;

  // سعر الصرف (من الإعدادات) لتحويل الدولار وعرضه بين قوسين
  const rate = +(SETTINGS.usd_rate || 13000);
  const openUsd = +(SETTINGS.opening_usd || 0);
  const usdInSyp = openUsd * rate; // قيمة الدولار بالليرة
  const prevBalTotal = allT.prevBal; // مجموع الرصيد السابق (ليرة) ضمن الفترة المختارة
  const includesOld = prevBalTotal > 0; // الفترة المختارة فيها شهور قبل تموز؟
  // صافي تموز فما بعد (بدون الرصيد السابق)
  const julyOnward = allT.profit - prevBalTotal;
  // الدولار بيدخل بالإجمالي فقط لما الفترة تشمل ما قبل تموز
  const grandTotalSyp = allT.profit + (includesOld ? usdInSyp : 0);

  // بطاقة الإجمالي: العنوان والنص يتغيّروا حسب إذا في قديم بالفترة
  const heroLabel = includesOld ? "💰 إجمالي ربح المحل (شامل القديم والدولار)" : "💰 إجمالي ربح الفترة";
  const heroNote = includesOld
    ? `<div style="font-size:.78rem;opacity:.85;font-weight:600">(منها ${fmtShort(usdInSyp)} ل.س دولار محوّل — ${openUsd.toFixed(0)}$ × ${fmt(rate)})</div>`
    : "";
  const oldCard = includesOld ? `
    <div class="kpi" style="background:#efe1c9">
      <div class="l">🏦 صافي ما قبل تموز (أيار + حزيران)</div>
      <div class="v" style="font-size:1.15rem">${fmt(prevBalTotal)} ل.س</div>
      <div style="font-size:.78rem;opacity:.7;font-weight:600">(+ الدولار ${openUsd.toFixed(0)}$ محفوظ منفصل)</div>
    </div>` : "";

  document.getElementById("statHighlights").innerHTML = `
    <div class="kpi hero"><div class="l" style="opacity:.85">${heroLabel}</div><div class="v" style="color:var(--cream)">${fmt(grandTotalSyp)} ل.س</div>${heroNote}</div>
    ${includesOld ? kpi("✨ صافي تموز فما بعد", julyOnward) : ""}
    ${oldCard}
    <div class="kpi"><div class="l">🏆 أفضل شهر</div><div class="v" style="font-size:1.1rem">${bestMonth?monthLabel(bestMonth.ym):"—"}</div><div style="font-size:.8rem;opacity:.65">${bestMonth?fmt(bestMonth.t.profit)+" ل.س":""}</div></div>
    <div class="kpi"><div class="l">📈 مقارنة بالشهر السابق ${trendTag}</div><div class="v">${monthTotals.length>=2?fmt(monthTotals[monthTotals.length-1].t.profit):"—"}</div></div>
    ${kpi("📊 متوسط دخل اليوم", Math.round(avgDay))}
    ${kpi("💈 إجمالي الإيراد", totalRev)}
    ${kpi("💸 إجمالي المصاريف", allT.exp, true)}
  `;

  // ---- الربح عبر الأشهر (أعمدة) ----
  renderMonthlyBars(monthTotals);
  // ---- مصادر الدخل (دائري) ----
  renderSourcesDonut(allT);
  // ---- توزيع المصاريف (دائري) ----
  renderExpDonut(list);
  // ---- أيام الأسبوع ----
  renderWeekdayBars(list);
  // ---- الحلاقين ----
  renderBarbersStats(list);
  // ---- أفضل الأيام ----
  renderTopDays(list);
  // ---- أكثر المنتجات ----
  renderTopProducts(list);
}

function renderMonthlyBars(monthTotals){
  const box = document.getElementById("statMonthlyChart");
  if (!monthTotals.length) { box.innerHTML = `<div class="empty">لسا ما في بيانات كفاية</div>`; return; }
  const max = Math.max(...monthTotals.map(m => m.t.profit), 1);
  const bestVal = Math.max(...monthTotals.map(m => m.t.profit));
  box.innerHTML = `<div class="mini-bars">` + monthTotals.map(m => {
    const h = Math.round((m.t.profit / max) * 120);
    const best = m.t.profit === bestVal;
    return `<div class="mb">
      <div class="mb-val">${fmtShort(m.t.profit)}</div>
      <div class="mb-bar ${best?"best":""}" style="height:${h}px"></div>
      <div class="mb-lbl">${AR_MONTHS[+m.ym.split("-")[1]-1].slice(0,3)}<br>${m.ym.split("-")[0]}</div>
    </div>`;
  }).join("") + `</div>`;
}

function renderSourcesDonut(t){
  const parts = [
    { label: "حلاقة وخدمات", val: t.hRev },
    { label: "ربح المنتجات", val: t.products },
    { label: "الكوفي", val: t.coffee },
  ].filter(p => p.val > 0);
  document.getElementById("statSourcesChart").innerHTML = donut(parts);
}

function renderExpDonut(list){
  const byCat = {};
  list.filter(e => e.type==="مصروف"||e.type==="مصروف شهري").forEach(e => {
    const k = e.detail || "أخرى";
    byCat[k] = (byCat[k]||0) + (+e.amount||0);
  });
  const parts = Object.entries(byCat).map(([label,val]) => ({label,val})).sort((a,b)=>b.val-a.val);
  document.getElementById("statExpChart").innerHTML = parts.length ? donut(parts) : `<div class="empty">ما في مصاريف بالفترة</div>`;
}

function donut(parts){
  const total = parts.reduce((s,p)=>s+p.val,0);
  if (!total) return `<div class="empty">ما في بيانات</div>`;
  let acc = 0;
  const stops = parts.map((p,i) => {
    const start = acc/total*360; acc += p.val;
    const end = acc/total*360;
    return `${CHART_COLORS[i%CHART_COLORS.length]} ${start}deg ${end}deg`;
  }).join(",");
  const legend = parts.map((p,i) =>
    `<div class="li"><span class="dot" style="background:${CHART_COLORS[i%CHART_COLORS.length]}"></span>
     <span>${p.label} — <strong>${(p.val/total*100).toFixed(0)}%</strong> (${fmtShort(p.val)})</span></div>`
  ).join("");
  return `<div class="donut-wrap">
    <div style="width:150px;height:150px;border-radius:50%;background:conic-gradient(${stops});position:relative;flex-shrink:0">
      <div style="position:absolute;inset:26px;background:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-direction:column">
        <div style="font-size:.72rem;opacity:.6">الإجمالي</div>
        <div style="font-weight:800;font-size:.9rem">${fmtShort(total)}</div>
      </div>
    </div>
    <div class="donut-legend">${legend}</div>
  </div>`;
}

function renderWeekdayBars(list){
  const byDay = [0,0,0,0,0,0,0], cntDay = [0,0,0,0,0,0,0];
  const seen = {};
  list.filter(e => e.type!=="مصروف"&&e.type!=="مصروف شهري"&&e.type!=="دولار").forEach(e => {
    const c = calc(e);
    const wd = new Date(e.entry_date+"T00:00:00").getDay();
    byDay[wd] += c.rev;
    if (!seen[e.entry_date]) { seen[e.entry_date]=wd; }
  });
  // عدد أيام فريدة لكل يوم أسبوع
  Object.values(seen).forEach(wd => cntDay[wd]++);
  const avg = byDay.map((v,i) => cntDay[i] ? v/cntDay[i] : 0);
  const max = Math.max(...avg, 1);
  const bestVal = Math.max(...avg);
  document.getElementById("statWeekChart").innerHTML = `<div class="mini-bars">` +
    avg.map((v,i) => {
      const h = Math.round((v/max)*120);
      return `<div class="mb">
        <div class="mb-val">${fmtShort(v)}</div>
        <div class="mb-bar ${v===bestVal&&v>0?"best":""}" style="height:${Math.max(3,h)}px"></div>
        <div class="mb-lbl">${AR_DAYS[i].replace("ال","")}</div>
      </div>`;
    }).join("") + `</div>
    <div style="font-size:.8rem;opacity:.6;margin-top:6px">💡 اليوم الذهبي = أعلى متوسط دخل. استغلّه بالعروض والحجوزات.</div>`;
}

function renderBarbersStats(list){
  const rows = BARBERS.filter(b => b.active!==false).map(b => {
    const bl = list.filter(e => BARBER_TYPES.includes(e.type) && e.detail === b.name);
    let cnt=0, rev=0, comm=0;
    bl.forEach(e => { const c=calc(e); cnt+=+e.count||0; rev+=c.rev; comm+=c.comm; });
    return { name:b.name, cnt, rev, comm, net:rev-comm };
  }).filter(r => r.rev > 0).sort((a,b)=>b.rev-a.rev);
  if (!rows.length) { document.getElementById("statBarbersChart").innerHTML = `<div class="empty">ما في بيانات</div>`; return; }
  const max = Math.max(...rows.map(r=>r.rev));
  document.getElementById("statBarbersChart").innerHTML = rows.map((r,i) => `
    <div class="bar-row">
      <span class="bl">${i===0?"🥇 ":i===1?"🥈 ":i===2?"🥉 ":""}${r.name}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(r.rev/max*100).toFixed(0)}%;background:${CHART_COLORS[i%CHART_COLORS.length]}"></span></span>
      <span class="bar-val">${fmtShort(r.rev)} · ${r.cnt} حلاقة</span>
    </div>`).join("");
}

function renderTopDays(list){
  const byDay = {};
  list.filter(e => e.type!=="مصروف"&&e.type!=="مصروف شهري"&&e.type!=="دولار").forEach(e => {
    const c = calc(e);
    byDay[e.entry_date] = (byDay[e.entry_date]||0) + c.rev;
  });
  const top = Object.entries(byDay).map(([d,v])=>({d,v})).sort((a,b)=>b.v-a.v).slice(0,5);
  if (!top.length) { document.getElementById("statTopDays").innerHTML = `<div class="empty">ما في بيانات</div>`; return; }
  document.getElementById("statTopDays").innerHTML = `<table>
    <tr><th>#</th><th>التاريخ</th><th>اليوم</th><th>الدخل</th></tr>` +
    top.map((r,i) => {
      const wd = AR_DAYS[new Date(r.d+"T00:00:00").getDay()];
      return `<tr><td>${["🥇","🥈","🥉","4","5"][i]}</td><td>${r.d}</td><td>${wd}</td><td><strong>${fmt(r.v)}</strong></td></tr>`;
    }).join("") + `</table>`;
}

function renderTopProducts(list){
  const byProd = {};
  list.filter(e => e.type==="منتج").forEach(e => {
    const k = e.sub || "منتج";
    if (!byProd[k]) byProd[k] = { cnt:0, sales:0, profit:0 };
    byProd[k].cnt++;
    const c = calc(e);
    byProd[k].sales += c.rev;
    byProd[k].profit += c.net;
  });
  const top = Object.entries(byProd).map(([name,d])=>({name,...d})).sort((a,b)=>b.sales-a.sales).slice(0,6);
  if (!top.length) { document.getElementById("statTopProducts").innerHTML = `<div class="empty">ما في مبيعات منتجات بعد</div>`; return; }
  document.getElementById("statTopProducts").innerHTML = `<table>
    <tr><th>المنتج</th><th>عدد</th><th>مبيعات</th><th>ربح</th></tr>` +
    top.map(r => `<tr><td><strong>${r.name}</strong></td><td>${r.cnt}</td><td>${fmt(r.sales)}</td><td class="pos">${fmt(r.profit)}</td></tr>`).join("") + `</table>`;
}

// اختصار الأرقام (1.2م، 350ألف)
function fmtShort(n){
  n = +n || 0;
  if (Math.abs(n) >= 1000000) return (n/1000000).toFixed(1).replace(/\.0$/,"") + "م";
  if (Math.abs(n) >= 1000) return Math.round(n/1000) + "ألف";
  return String(Math.round(n));
}
