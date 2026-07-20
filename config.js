const SB_URL = "https://fqaqikckjjmljdzzsmpv.supabase.co";
const SB_KEY = "sb_publishable_YrsonOu1xF4d3bA77UrcUg_ASvZEese";
const db = window.supabase.createClient(SB_URL, SB_KEY);

const fmt = n => new Intl.NumberFormat("en-US").format(Math.round(n));
const fmtSYP = n => fmt(n) + " ل.س";

function toast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(()=>t.classList.remove("show"), 3200);
}
