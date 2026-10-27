// ============ Bob & Co — Face ID (WebAuthn passkey على الجهاز) ============
// المفتاح بينحفظ بالـ Secure Enclave تبع الآيفون؛ نحنا بس منحفظ رقم تعريفه هون.
// إذا Face ID مفعّل: كل فتحة للتطبيق (أو رجعة بعد 5 دقايق بالخلفية) بتطلع شاشة قفل، لمسة وحدة عليها = Face ID مباشرة.
// ملاحظة: iOS ما بيسمح لمواقع الويب تشغّل Face ID بلا لمسة — إذا انطلب لحالو بيطلع شيت "Continue" إضافي،
// فمنخلّي اللمسة الوحيدة هي نفسها اللي بتفتح Face ID.
(function () {
  const KEY = "bobco_faceid";          // id المفتاح (base64url)
  const UNLOCK = "bobco_unlocked";     // sessionStorage — فتحة هالجلسة
  const LOCK_AFTER_MS = 5 * 60 * 1000; // قفل تلقائي بعد 5 دقايق بالخلفية

  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} },
    del: k => { try { localStorage.removeItem(k); } catch (_) {} }
  };
  const ss = {
    get: k => { try { return sessionStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (_) {} },
    del: k => { try { sessionStorage.removeItem(k); } catch (_) {} }
  };

  const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
  const rand = n => crypto.getRandomValues(new Uint8Array(n));

  const enrolled = () => !!ls.get(KEY);

  async function supported() {
    try {
      return !!(window.PublicKeyCredential && window.isSecureContext &&
        await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
    } catch (_) { return false; }
  }

  async function enroll() {
    const cred = await navigator.credentials.create({
      publicKey: {
        rp: { name: "Bob & Co" },
        user: { id: rand(16), name: "bobco-admin", displayName: "Bob & Co — الإدارة" },
        challenge: rand(32),
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
        timeout: 60000,
        attestation: "none"
      }
    });
    if (!cred) throw new Error("no-credential");
    ls.set(KEY, b64u(cred.rawId));
    return true;
  }

  async function verify() {
    const id = ls.get(KEY);
    if (!id) return false;
    const a = await navigator.credentials.get({
      publicKey: {
        challenge: rand(32),
        allowCredentials: [{ type: "public-key", id: unb64u(id), transports: ["internal", "hybrid"] }],
        userVerification: "required",
        timeout: 60000
      }
    });
    return !!(a && a.response && a.response.userHandle !== undefined);
  }

  function disable() { ls.del(KEY); ss.del(UNLOCK); }

  // ---------- UI ----------
  const $ = id => document.getElementById(id);
  let onUnlock = null, busy = false;

  function setMsg(t) { const e = $("gateErr"); if (e) e.textContent = t || ""; }

  function showLock() {
    const p = $("panel");
    if (p) p.style.display = "none";
    $("gate").style.display = "none";
    $("lockErr").textContent = "";
    $("lock").hidden = false;
  }
  function hideLock() { $("lock").hidden = true; }

  function showGate() {
    const g = $("gate"), p = $("panel");
    hideLock();
    if (p) p.style.display = "none";
    if (g) g.style.display = "flex";
    $("gateEnroll").hidden = true;
    $("gateLogin").hidden = false;
    $("fidBtn").hidden = !enrolled();
    $("pinWrap").classList.toggle("fid-on", enrolled());
  }

  function reveal() {
    hideLock();
    ss.set(UNLOCK, "1");
    ls.set("bobco_admin", String(Date.now()));
    if (typeof onUnlock === "function") onUnlock();
  }

  async function tryFaceID() {
    if (busy || !enrolled()) return;
    busy = true; setMsg(""); $("lockErr").textContent = "";
    $("fidBtn").classList.add("busy"); $("lock").classList.add("busy");
    try {
      if (await verify()) reveal();
    } catch (e) {
      if (e && e.name === "NotAllowedError") setMsg("");          // ألغى أو ما انطلب بلمسة — الزر جاهز
      else if (e && e.name === "InvalidStateError") setMsg("Face ID مش متاح هلق — ادخل بالرمز");
      else setMsg("ما زبط Face ID — جرّب كمان مرة أو ادخل بالرمز");
      if (!$("lock").hidden) $("lockErr").textContent = (e && e.name === "NotAllowedError") ? "" : "ما زبط — المس كمان مرة";
    } finally {
      busy = false; $("fidBtn").classList.remove("busy"); $("lock").classList.remove("busy");
    }
  }

  // بعد الدخول بالرمز: إذا الجهاز بيدعم ولسا ما فعّلنا، منعرض التفعيل مرة وحدة
  async function afterPin(open) {
    ss.set(UNLOCK, "1");
    const asked = ls.get("bobco_faceid_asked");
    if (!enrolled() && !asked && await supported()) {
      $("gateLogin").hidden = true;
      $("gateEnroll").hidden = false;
      $("enrollYes").onclick = async () => {
        try { await enroll(); open(); BobFaceID.toast("تم — من هلق بتفتح بـ Face ID"); }
        catch (_) { setMsg("ما تفعّل — فيك تفعّله بعدين من الإعدادات"); $("gateEnroll").hidden = true; $("gateLogin").hidden = false; setTimeout(open, 900); }
      };
      $("enrollNo").onclick = () => { ls.set("bobco_faceid_asked", "1"); open(); };
      return;
    }
    open();
  }

  // كرت الإعدادات
  async function renderSettings() {
    const box = $("fidSettings");
    if (!box) return;
    const ok = await supported();
    if (!ok) { box.innerHTML = '<p class="muted">هالجهاز أو المتصفح ما بيدعم Face ID / Touch ID للدخول.</p>'; return; }
    box.innerHTML = enrolled()
      ? '<p class="muted" style="margin-bottom:14px">مفعّل على هالجهاز. التطبيق بيطلب Face ID كل ما ينفتح، وبعد 5 دقايق بالخلفية. الرمز بيضل احتياط.</p><button class="mini" id="fidOff">إيقاف Face ID</button>'
      : '<p class="muted" style="margin-bottom:14px">ادخل بوجهك بدل الرمز على هالجهاز.</p><button class="btn-add" id="fidOn">تفعيل Face ID</button>';
    const on = $("fidOn"), off = $("fidOff");
    if (on) on.onclick = async () => { try { await enroll(); BobFaceID.toast("تم تفعيل Face ID"); } catch (_) { BobFaceID.toast("ما تفعّل Face ID"); } renderSettings(); syncLockBtn(); };
    if (off) off.onclick = () => { disable(); ls.set("bobco_faceid_asked", "1"); BobFaceID.toast("انطفى Face ID"); renderSettings(); syncLockBtn(); };
  }

  function syncLockBtn() { const b = $("lockBtn"); if (b) b.hidden = !enrolled(); }

  function lockNow() { if (!enrolled()) return; ss.del(UNLOCK); showLock(); }

  // اللمسة على شاشة القفل هي نفسها اللي بتفتح Face ID (user gesture) — بلا أي شيت بالنص
  function wireLock() {
    $("lock").addEventListener("click", e => { if (e.target.closest("#usePin")) return; tryFaceID(); });
    $("usePin").addEventListener("click", e => { e.stopPropagation(); showGate(); setTimeout(() => { const p = $("pin"); if (p) p.focus(); }, 50); });
  }

  // قفل تلقائي بعد فترة بالخلفية
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (enrolled() && hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS && $("panel").style.display === "block") lockNow();
  });

  window.BobFaceID = {
    enrolled, supported, afterPin, renderSettings, syncLockBtn, lockNow, tryFaceID,
    toast: m => (typeof toast === "function" ? toast(m) : null),
    // بيقرّر شو بيصير أول ما تنفتح الصفحة. بيرجّع true إذا Face ID أخد الموضوع.
    boot(open, remembered) {
      onUnlock = open;
      wireLock();
      if (!enrolled()) return false;
      if (ss.get(UNLOCK) && remembered) { open(); return true; }
      showLock();
      return true;
    }
  };
})();
