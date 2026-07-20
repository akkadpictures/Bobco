/* ============ BOB & CO — Front App (Detailed Booking) ============ */
let BARBERS = [], SERVICES = [], COFFEE = [], SETTINGS = {};
const state = { services: new Set(), barber: null, date: null, slot: null };

const AR_D = ["٠","١","٢","٣","٤","٥","٦","٧","٨","٩"];
const arNum = s => String(s).replace(/[0-9]/g, d => AR_D[d]);

const DAY_NAMES = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const DAY_SHORT = ['أحد','اثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'];
const MONTHS = ['كانون الثاني','شباط','آذار','نيسان','أيار','حزيران','تموز','آب','أيلول','تشرين الأول','تشرين الثاني','كانون الأول'];

const CARE_NAMES = ["غسيل وتصفيف","عناية بالبشرة","تنضيف بشرة","عناية وجه","مساج ظهر","حمام زيت"];
const COMBO_NAMES = { a: "قص شعر", b: "تحديد لحية", merged: "قص شعر + لحية" };

const today = new Date(); today.setHours(0,0,0,0);
let calYear = today.getFullYear(), calMonth = today.getMonth();
const MAX_AHEAD = 2;

let takenCache = {};

const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const fmtDate = d => DAY_NAMES[d.getDay()] + ' ' + arNum(d.getDate()) + ' ' + MONTHS[d.getMonth()];
const sameDay = (a,b) => a && b && a.getTime() === b.getTime();

init();

async function init(){
  const [b, s, c, st] = await Promise.all([
    db.from("barbers").select("*").eq("active", true).order("sort"),
    db.from("services").select("*").eq("active", true).order("sort"),
    db.from("coffee_items").select("*").eq("active", true).order("sort"),
    db.from("settings").select("*")
  ]);
  BARBERS = b.data || [];
  SERVICES = s.data || [];
  COFFEE = c.data || [];
  (st.data || []).forEach(r => SETTINGS[r.key] = r.value);

  renderBarbersSection();
  renderServices();
  renderBarberPick();
  renderMenu();
  setupNav();
  setupReveal();
  document.getElementById('calPrev').onclick = () => { calMonth--; if(calMonth < 0){ calMonth = 11; calYear--; } renderCalendar(); };
  document.getElementById('calNext').onclick = () => { calMonth++; if(calMonth > 11){ calMonth = 0; calYear++; } renderCalendar(); };
  document.getElementById('bookBtn').addEventListener('click', submitBooking);
  document.addEventListener('input', () => syncTicket());
  update();
}

/* ---------- helpers ---------- */
const comboService = () => SERVICES.find(s => s.name === COMBO_NAMES.merged);
const svcById = id => SERVICES.find(s => s.id === id);
const visibleServices = () => SERVICES.filter(s => s.name !== COMBO_NAMES.merged);

function totalMins(){
  return [...state.services].reduce((t,id) => t + (Number(svcById(id)?.duration_min) || 30), 0);
}

function calc(){
  const items = [...state.services].map(svcById).filter(Boolean);
  let sum = items.reduce((t,s) => t + Number(s.price||0), 0);
  const a = SERVICES.find(s => s.name === COMBO_NAMES.a);
  const bb = SERVICES.find(s => s.name === COMBO_NAMES.b);
  const merged = comboService();
  const comboOn = !!(a && bb && merged && state.services.has(a.id) && state.services.has(bb.id));
  let discount = 0;
  if(comboOn){
    const full = Number(a.price) + Number(bb.price);
    discount = full - Number(merged.price);
    if(discount > 0) sum -= discount; else discount = 0;
  }
  return { items, sum, discount, comboOn, mins: totalMins() };
}

/* ---------- barbers section (top of site) ---------- */
function renderBarbersSection(){
  const g = document.getElementById("barbersGrid");
  g.innerHTML = BARBERS.map(b => `
    <div class="barber-card rv">
      <div class="monogram">${(b.name||"؟").trim()[0]}</div>
      <h3>${b.name}</h3>
      <div class="role">${b.title||"حلاق"}</div>
      <button class="btn btn-olive" onclick="chooseBarber(${b.id})">احجز معه</button>
    </div>`).join("");
  observeNew(g);
}

window.chooseBarber = id => {
  state.barber = id;
  update();
  document.getElementById("book").scrollIntoView({behavior:"smooth"});
};

/* ---------- step 1: services ---------- */
function renderServices(){
  const barberBox = document.getElementById('svcBarber');
  const careBox = document.getElementById('svcCare');
  barberBox.innerHTML = ''; careBox.innerHTML = '';
  visibleServices().forEach(s => {
    const el = document.createElement('div');
    el.className = 'svc'; el.dataset.id = s.id;
    el.innerHTML = `<div class="check">✓</div><h3>${s.name}</h3>
      <div class="meta"><span>${arNum(s.duration_min)} دقيقة</span><b>${fmtSYP(s.price)}</b></div>`;
    el.onclick = () => {
      state.services.has(s.id) ? state.services.delete(s.id) : state.services.add(s.id);
      state.slot = null;
      update();
    };
    (CARE_NAMES.includes(s.name) ? careBox : barberBox).appendChild(el);
  });
  document.getElementById('careWrap').style.display = careBox.children.length ? '' : 'none';
}

/* ---------- step 2: barbers ---------- */
function renderBarberPick(){
  const box = document.getElementById('barberList');
  box.innerHTML = '';
  BARBERS.forEach(b => {
    const el = document.createElement('div');
    el.className = 'bpick'; el.dataset.id = b.id;
    el.innerHTML = `<div class="avatar">${(b.name||"؟").trim()[0]}</div><h3>${b.name}</h3><p>${b.title||"حلاق"}</p>`;
    el.onclick = () => { state.barber = b.id; state.slot = null; update(); };
    box.appendChild(el);
  });
}

/* ---------- step 3: calendar ---------- */
function renderCalendar(){
  document.getElementById('calTitle').textContent = MONTHS[calMonth] + ' ' + arNum(calYear);

  const minM = today.getFullYear()*12 + today.getMonth();
  const curM = calYear*12 + calMonth;
  document.getElementById('calPrev').disabled = curM <= minM;
  document.getElementById('calNext').disabled = curM >= minM + MAX_AHEAD;

  const grid = document.getElementById('calGrid');
  grid.innerHTML = DAY_SHORT.map(d => `<div class="cal-dow">${d}</div>`).join('');

  const first = new Date(calYear, calMonth, 1);
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();

  for(let i = 0; i < first.getDay(); i++){
    grid.insertAdjacentHTML('beforeend','<div class="cal-day blank"></div>');
  }
  for(let d = 1; d <= daysInMonth; d++){
    const date = new Date(calYear, calMonth, d);
    const el = document.createElement('div');
    el.className = 'cal-day';
    el.textContent = arNum(d);
    if(date < today) el.classList.add('off');
    if(sameDay(date, today)) el.classList.add('today');
    if(sameDay(date, state.date)) el.classList.add('on');
    if(date >= today) el.onclick = () => { state.date = date; state.slot = null; update(); };
    grid.appendChild(el);
  }
}

/* ---------- step 3: slots (duration-aware + real bookings) ---------- */
function slotGrid(){
  const [oh, om] = (SETTINGS.open_time || "12:00").split(":").map(Number);
  const [ch, cm] = (SETTINGS.close_time || "22:00").split(":").map(Number);
  const step = Number(SETTINGS.slot_minutes || 30);
  return { open: oh*60+om, close: ch*60+cm, step };
}

async function getTaken(barberId, dateStr){
  const key = barberId + "|" + dateStr;
  if(takenCache[key]) return takenCache[key];
  const { data } = await db.from("bookings").select("booking_time,status")
    .eq("barber_id", barberId).eq("booking_date", dateStr);
  const taken = new Set((data||[])
    .filter(r => r.status !== "ملغى" && r.status !== "ملغي")
    .map(r => r.booking_time));
  takenCache[key] = taken;
  return taken;
}

async function renderSlots(){
  const box = document.getElementById('slotList');
  const hint = document.getElementById('slotHint');
  const picked = document.getElementById('pickedDate');
  box.innerHTML = '';

  if(!state.date){
    hint.textContent = 'اختار التاريخ من الرزنامة أولاً';
    picked.classList.remove('show');
    return;
  }
  picked.classList.add('show');
  picked.textContent = 'يوم ' + fmtDate(state.date);

  if(!state.barber){
    hint.textContent = 'اختار الحلاق لتظهر الأوقات المتاحة';
    return;
  }

  const mins = totalMins();
  hint.textContent = mins
    ? `مدة موعدك الكاملة: ${arNum(mins)} دقيقة — الأوقات المعروضة بتتسع لكل خدماتك سوا`
    : 'اختار خدماتك ليتحدد طول الموعد';

  box.innerHTML = '<span class="slots-empty">عم نجيب الأوقات...</span>';
  const dateStr = iso(state.date);
  const taken = await getTaken(state.barber, dateStr);
  box.innerHTML = '';

  const { open, close, step } = slotGrid();
  const need = Math.max(1, Math.ceil((mins || step) / step));
  const now = new Date();
  const isToday = sameDay(state.date, today);
  const nowMin = now.getHours()*60 + now.getMinutes();
  const toLabel = t => `${String(Math.floor(t/60)).padStart(2,"0")}:${String(t%60).padStart(2,"0")}`;

  let any = false;
  for(let t = open; t < close; t += step){
    if(mins && t + mins > close) break;
    const label = toLabel(t);
    const el = document.createElement('div');
    el.className = 'slot';
    el.dataset.slot = label;
    el.textContent = arNum(label);

    let busy = isToday && t <= nowMin;
    if(!busy){
      for(let k = 0; k < need; k++){
        if(taken.has(toLabel(t + k*step))){ busy = true; break; }
      }
    }
    if(busy) el.classList.add('busy');
    else { any = true; el.onclick = () => { state.slot = label; update(); }; }
    box.appendChild(el);
  }
  if(!box.children.length || !any){
    box.insertAdjacentHTML('beforeend', '<span class="slots-empty">ما في أوقات متاحة بتتسع لموعدك هاليوم — جرب يوم تاني</span>');
  }
  document.querySelectorAll('.slot').forEach(el => el.classList.toggle('on', state.slot === el.dataset.slot));
}

/* ---------- ticket ---------- */
function syncTicket(){
  const { items, sum, discount, comboOn, mins } = calc();
  document.getElementById('comboNote').classList.toggle('show', comboOn);

  const body = document.getElementById('ticketBody');
  const totals = document.getElementById('ticketTotals');
  const gift = document.getElementById('coffeeGift');
  if(!items.length){
    body.innerHTML = '<div class="empty-ticket">اختار خدماتك ليبلّش الحساب ✂</div>';
    totals.style.display = 'none'; gift.style.display = 'none';
  } else {
    body.innerHTML = items.map(s => `<div class="tline"><span class="n">${s.name}</span><span class="p">${fmtSYP(s.price)}</span></div>`).join('')
      + (discount ? `<div class="tline discount"><span class="n">خصم كومبو ✦</span><span class="p">−${fmtSYP(discount)}</span></div>` : '');
    totals.style.display = 'block'; gift.style.display = 'block';
    document.getElementById('tGrand').textContent = fmtSYP(sum);
  }

  const meta = [];
  if(state.barber){ const b = BARBERS.find(x => x.id === state.barber); if(b) meta.push('الحلّاق: ' + b.name); }
  if(mins) meta.push('المدة: ' + arNum(mins) + ' دقيقة');
  if(state.date && state.slot) meta.push('الموعد: ' + fmtDate(state.date) + ' — الساعة ' + arNum(state.slot));
  else if(state.date) meta.push('التاريخ: ' + fmtDate(state.date));
  document.getElementById('ticketMeta').innerHTML = meta.join('<br>');

  const ready = items.length && state.barber && state.date && state.slot
    && document.getElementById('custName').value.trim()
    && document.getElementById('custPhone').value.trim();
  document.getElementById('bookBtn').disabled = !ready;
}

function update(){
  document.querySelectorAll('.svc').forEach(el => el.classList.toggle('on', state.services.has(Number(el.dataset.id))));
  document.querySelectorAll('.bpick').forEach(el => el.classList.toggle('on', state.barber === Number(el.dataset.id)));
  renderCalendar();
  renderSlots();
  syncTicket();
}

/* ---------- submit ---------- */
async function submitBooking(){
  const name = document.getElementById('custName').value.trim();
  const phone = document.getElementById('custPhone').value.trim();
  if(!/^0?9\d{8}$/.test(phone.replace(/\s/g,""))) return toast("تأكد من رقم الموبايل (09XXXXXXXX)");

  const { items, sum, comboOn, mins } = calc();
  const btn = document.getElementById('bookBtn');
  btn.disabled = true; btn.textContent = "عم نثبّت الحجز...";

  const ids = [...state.services];
  const merged = comboService();
  const code = 'BC-' + Math.floor(1000 + Math.random()*9000);

  const { error } = await db.from("bookings").insert({
    customer_name: name, phone,
    barber_id: state.barber,
    service_id: comboOn && merged ? merged.id : ids[0],
    service_ids: ids,
    booking_date: iso(state.date),
    booking_time: state.slot,
    status: "جديد",
    note: 'رمز الحجز: ' + code + (comboOn ? ' · عرض كومبو' : '')
  });

  btn.disabled = false; btn.textContent = "ثبّت الحجز";
  if(error){ console.error(error); return toast("صار خطأ، جرب مرة تانية"); }

  const b = BARBERS.find(x => x.id === state.barber);
  document.getElementById('confirmText').innerHTML =
    `أهلاً ${name}! موعدك مع <b>${b ? b.name : ""}</b> يوم <b>${fmtDate(state.date)}</b> الساعة <b>${arNum(state.slot)}</b><br>` +
    `${arNum(items.length)} خدمات · ${arNum(mins)} دقيقة · ${fmtSYP(sum)} — والقهوة علينا ☕`;
  document.getElementById('confirmCode').textContent = code;
  document.getElementById('bookLayout').style.display = 'none';
  document.getElementById('confirmBox').classList.add('show');
  takenCache = {};
  document.getElementById('book').scrollIntoView({behavior:"smooth"});
}

window.resetAll = () => {
  state.services.clear(); state.barber = null; state.date = null; state.slot = null;
  calYear = today.getFullYear(); calMonth = today.getMonth();
  document.getElementById('custName').value = '';
  document.getElementById('custPhone').value = '';
  document.getElementById('confirmBox').classList.remove('show');
  document.getElementById('bookLayout').style.display = '';
  update();
};

/* ---------- Coffee menu ---------- */
function renderMenu(){
  const cats = {};
  COFFEE.forEach(i => (cats[i.category] = cats[i.category] || []).push(i));
  document.getElementById("menuBoard").innerHTML = Object.entries(cats).map(([cat, items]) => `
    <div class="menu-cat rv">
      <h3>${cat}</h3>
      ${items.map(i => `<div class="mi"><span class="nm">${i.name}</span><span class="dots"></span><span class="pr">${fmtSYP(i.price)}</span></div>`).join("")}
    </div>`).join("");
  observeNew(document.getElementById("menuBoard"));
}

/* ---------- Nav & reveal ---------- */
function setupNav(){
  const nav = document.getElementById("nav");
  const onScroll = () => nav.classList.toggle("solid", window.scrollY > 60);
  window.addEventListener("scroll", onScroll, {passive:true});
  onScroll();
}

let _io;
function setupReveal(){
  _io = new IntersectionObserver(es => es.forEach(e => {
    if(e.isIntersecting){ e.target.classList.add("in"); _io.unobserve(e.target); }
  }), {threshold:.12});
  document.querySelectorAll(".rv").forEach(el => _io.observe(el));
}
function observeNew(root){
  if(_io) root.querySelectorAll(".rv").forEach(el => _io.observe(el));
  else root.querySelectorAll(".rv").forEach(el => el.classList.add("in"));
}
