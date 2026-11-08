// UI and orchestration.
// Reads the document, runs the engine one stage at a time, shows each stage
// as it finishes, keeps run history, and lets a person resolve held invoices.
(() => {
  // ================================================================ helpers
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const money = (x, cur) => Engine.money(x, cur || "USD");
  // ---- currency. Every amount stays in the currency printed on its invoice. Totals are kept
  // per currency and never converted: "$4,979.00", or "$4,979.00 · ₹46,610.00" when both appear.
  const curOf = (r) => r.currency || "USD";
  const curList = (list) => [...new Set(list.map(curOf))].sort((a, b) => (a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b)));
  const moneySum = (list, f) => {
    const cs = curList(list);
    if (!cs.length) return money(0, "USD");
    return cs.map((c) => money(list.filter((r) => curOf(r) === c).reduce((a, r) => a + (f(r) || 0), 0), c)).join(" · ");
  };
  const dur = (ms) => (ms < 1000 ? Math.max(1, Math.round(ms)) + " ms" : (ms / 1000).toFixed(1) + " s");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const now = () => performance.now();
  const when = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const initials = (name) => (name || "?").replace(/&/g, " ").split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

  // simple line icons (drawn by hand in the Lucide style, no icon font)
  const ICONS = {
    check: '<path d="M20 6L9 17l-5-5"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    pause: '<path d="M9 5v14M15 5v14"/>',
    bang: '<path d="M12 5v9M12 19v.01"/>',
    minus: '<path d="M6 12h12"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    chev: '<path d="M9 18l6-6-6-6"/>',
    file: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1"/>',
    download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    zoom: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>',
    play: '<path d="M6 4l14 8-14 8z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
  };
  const icon = (name, cls = "i") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  const STATUS_ICON = { Approved: "check", Hold: "pause", Rejected: "x" };
  const STATUS_WORD = { Approved: "Approved", Hold: "On hold", Rejected: "Rejected" };
  const pill = (status, text) => `<span class="pill ${status}">${icon(STATUS_ICON[status])}${esc(text || STATUS_WORD[status])}</span>`;

  // smooth number count-up for headline figures
  function countUp(el, to, fmt, ms = 650) {
    if (!el) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !isFinite(to)) { el.textContent = fmt(to); return; }
    const t0 = now();
    const step = () => {
      const k = Math.min(1, (now() - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(to * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function toast(text, ic = "info") {
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = icon(ic) + `<span>${esc(text)}</span>`;
    $("#toasts").appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 260); }, 2600);
  }

  // ================================================================ storage (per viewer, best effort)
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: keep in memory only */ } },
  };
  const KEY_RUNS = "idd.runs.v2", KEY_POLICY = "idd.policy.v1";
  let runs = store.get(KEY_RUNS, []);
  let policy = Object.assign({}, SEED.policy, store.get(KEY_POLICY, {}));
  const saveRuns = () => store.set(KEY_RUNS, runs);
  const fullPreviews = {}; // full-size page images for this session only (too big for storage)

  // invoices that count for duplicate and cumulative-billing checks:
  // the seeded ledger plus anything a run entered (approved or held, not rejected)
  const history = () => [...SEED.ledger, ...runs.filter((r) => r.entered).map((r) => r.entered)];

  // a run's outcome after any human review
  const statusOf = (r) => (r.resolution ? r.resolution.final : r.decision.status);
  const openHolds = () => runs.filter((r) => r.decision && r.decision.status === "Hold" && !r.resolution);

  // ================================================================ AI second reader (optional)
  // Off by default. A visitor can turn it on and choose a provider and model.
  // Their own key goes straight from this page to the provider (see ai.js);
  // nothing is sent to or stored on this site's server. The "built-in" choice
  // uses the site owner's Gemini key through /api/read, when that exists.
  let downloads = null, builtinOn = false, builtinModel = null;
  // The built-in reader (the site owner's key) is the default. Only when it is not set up, or its
  // limit is reached, does the page offer the visitor's own key.
  let builtinOut = false; try { builtinOut = sessionStorage.getItem("idd.builtinOut") === "1"; } catch { /* no session storage */ }
  const builtinMode = () => builtinOn && !builtinOut;
  (async () => {
    try { downloads = window.claude && window.claude.use ? await window.claude.use("downloads") : null; } catch { downloads = null; }
  })();

  const PROV = AI.PROVIDERS;
  const aiSaved = store.get("idd.ai.v1", {});                 // provider + model only, never the key
  let aiKeySession = ""; try { aiKeySession = sessionStorage.getItem("idd.aikey") || ""; } catch { /* no session storage */ }
  const ai = { on: false, provider: aiSaved.provider || "gemini", model: aiSaved.model || "", key: aiKeySession, remember: !!aiKeySession };
  const liveModels = {};                                       // models a key can use, per provider
  const aiCfg = () => ({ provider: ai.provider, model: ai.model, key: ai.key });
  const aiReady = () => !!PROV[ai.provider] && (ai.provider === "builtin" ? builtinMode() : !!(ai.key && ai.model));
  const aiName = () => `${PROV[ai.provider].short}${ai.provider === "builtin" ? (builtinModel ? " · " + builtinModel : "") : ai.model ? " · " + ai.model : ""}`;
  const aiShort = () => (PROV[ai.provider] ? PROV[ai.provider].short : "AI");

  function paintAI() {
    const on = ai.on && aiReady();
    $("#opt-ai").checked = on;
    $("#aidot").classList.toggle("on", on);
    $("#aitext").textContent = on ? `${aiShort()} second reader on` : "AI second reader off";
    $("#aisub").textContent = on ? `Model: ${aiName().replace(/^[^·]*· ?/, "") || "default"}. The rules still make every decision.` : "Rules decide every outcome. Turn on the AI reader for a second pair of eyes.";
    $("#ai-desc").textContent = on ? `On · ${aiName()}` : builtinOn && builtinOut ? "The built-in reader has reached its limit. Add your own API key to keep using it." : "Off. Rules and OCR only.";
    $("#ai-config").hidden = builtinMode();
    $("#ai-config").textContent = on ? "Change model or key" : builtinOn && builtinOut ? "Use my own API key" : "Choose model";
  }

  // which providers are offered: "built-in" only if the server has a key set
  async function detectBuiltin() {
    try {
      const r = await fetch("api/read", { cache: "no-store" });
      const j = r.ok ? await r.json() : null;
      if (j && j.configured) { builtinOn = true; builtinModel = j.model; }
    } catch { builtinOn = false; }
    if (builtinMode()) ai.provider = "builtin";
    else if (ai.provider === "builtin") ai.provider = "gemini";
    paintAI();
  }
  detectBuiltin();

  // ---- settings dialog
  const aiEl = { modal: $("#aimodal"), prov: $("#ai-provider"), model: $("#ai-model"), key: $("#ai-key"), status: $("#ai-status") };
  let aiSaving = false;
  function setStatus(text, tone) { aiEl.status.textContent = text || ""; aiEl.status.className = "status " + (tone || ""); }

  function fillProviders() {
    const ids = Object.keys(PROV).filter((k) => k !== "builtin");
    aiEl.prov.innerHTML = ids.map((k) => `<option value="${k}">${esc(PROV[k].label)}</option>`).join("");
    aiEl.prov.value = ids.includes(ai.provider) ? ai.provider : ids[0];
  }
  function fillModels(selected) {
    const prov = aiEl.prov.value, P = PROV[prov];
    const live = liveModels[prov];
    aiEl.model.innerHTML = "";
    if (!P.needsKey) {
      aiEl.model.innerHTML = `<option>${esc(builtinModel || "default")}</option>`; aiEl.model.disabled = true;
      $("#ai-modelhint").textContent = "Chosen by the site owner.";
      return;
    }
    aiEl.model.disabled = false;
    const list = live ? live : P.models.map((m) => ({ id: m, label: m }));
    aiEl.model.innerHTML = list.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join("");
    const want = selected && list.some((m) => m.id === selected) ? selected : list[0].id;
    aiEl.model.value = want;
    $("#ai-modelhint").textContent = live ? `${list.length} models available to your key.` : "Suggested models. Paste your key and the full list your key can use loads here automatically.";
  }
  function paintProviderPanel() {
    const prov = aiEl.prov.value, P = PROV[prov];
    $("#ai-keywrap").hidden = !P.needsKey;
    $("#ai-load").hidden = !P.needsKey;
    $("#ai-test").hidden = false;
    if (P.needsKey) { const l = $("#ai-keylink"); l.href = P.keyUrl; l.textContent = `Get your ${P.host} key`; }
    $("#ai-privacy").textContent = P.needsKey
      ? `Your key goes straight from your browser to ${P.host}. It is not sent to this website's server, and we don't collect or store it. It stays in this tab and is gone when you close it. Only the invoice's text (not the file) is sent to ${P.host} to be read.`
      : `This uses the site owner's own Gemini key, which stays on the server and is never sent to your browser. Reads are limited per visitor. Only the invoice's text (not the file) is sent to Google to be read.`;
    setStatus("");
  }
  function openAI() {
    aiSaving = false;
    fillProviders();
    aiEl.key.value = ai.key; aiEl.key.type = "password"; $("#ai-showkey").textContent = "Show";
    $("#ai-remember").checked = ai.remember;
    paintProviderPanel(); fillModels(ai.model);
    aiEl.modal.classList.remove("closing"); aiEl.modal.hidden = false;
    if (PROV[aiEl.prov.value].needsKey && aiEl.key.value.trim().length >= 20 && !liveModels[aiEl.prov.value]) loadModels(true);
    (PROV[aiEl.prov.value].needsKey && !aiEl.key.value ? aiEl.key : $("#ai-save")).focus();
  }
  function closeAI() {
    hideModal(aiEl.modal);
    if (!aiSaving && !aiReady()) { ai.on = false; paintAI(); }   // closed without choosing: stay off
  }
  const dialogCfg = () => ({ provider: aiEl.prov.value, model: PROV[aiEl.prov.value].needsKey ? aiEl.model.value : "", key: aiEl.key.value.trim() });

  aiEl.prov.addEventListener("change", () => { paintProviderPanel(); fillModels(""); });
  $("#ai-showkey").addEventListener("click", () => { const show = aiEl.key.type === "password"; aiEl.key.type = show ? "text" : "password"; $("#ai-showkey").textContent = show ? "Hide" : "Show"; });
  // fetch every model this key can use and fill the dropdown with them
  let loadTimer = null, loadSeq = 0;
  async function loadModels(auto) {
    const cfg = dialogCfg(); if (!PROV[cfg.provider].needsKey || !cfg.key) return;
    const seq = ++loadSeq;
    setStatus(`Looking up every model ${PROV[cfg.provider].host} allows for your key…`, "wait");
    try {
      const list = await AI.listModels(cfg);
      if (seq !== loadSeq || aiEl.prov.value !== cfg.provider) return;        // the user changed something meanwhile
      liveModels[cfg.provider] = list; fillModels(aiEl.model.value);
      setStatus(`${list.length} models available to your key. Pick any from the list.`, "ok");
    } catch (e) {
      if (seq !== loadSeq) return;
      setStatus(auto ? `Couldn't load your models yet: ${e.message}` : e.message, "bad");
    }
  }
  aiEl.key.addEventListener("input", () => {
    delete liveModels[aiEl.prov.value]; fillModels(aiEl.model.value); setStatus("");
    clearTimeout(loadTimer);
    if (aiEl.key.value.trim().length >= 20) loadTimer = setTimeout(() => loadModels(true), 700);   // a pasted key loads its models by itself
  });
  $("#ai-load").addEventListener("click", () => loadModels(false));
  $("#ai-test").addEventListener("click", async () => {
    const cfg = dialogCfg(); setStatus("Reading a tiny test invoice…", "wait");
    $("#ai-test").disabled = true;
    try { const t = await AI.test(cfg); setStatus(t.ok ? "Connected. The model read the test invoice correctly." : "Connected, but the model misread the test invoice. Try a stronger model.", t.ok ? "ok" : "bad"); }
    catch (e) { setStatus(e.message, "bad"); }
    $("#ai-test").disabled = false;
  });
  $("#ai-save").addEventListener("click", () => {
    const cfg = dialogCfg(), P = PROV[cfg.provider];
    if (P.needsKey && !cfg.key) { setStatus(`Paste your ${P.host} key first.`, "bad"); aiEl.key.focus(); return; }
    if (P.needsKey && !cfg.model) { setStatus("Choose a model.", "bad"); return; }
    Object.assign(ai, cfg, { on: true, remember: $("#ai-remember").checked });
    store.set("idd.ai.v1", { provider: ai.provider, model: ai.model });
    try { if (ai.remember && ai.key) sessionStorage.setItem("idd.aikey", ai.key); else sessionStorage.removeItem("idd.aikey"); } catch { /* ignore */ }
    aiSaving = true; paintAI(); closeAI();
    toast(`AI second reader on: ${aiName()}`, "check");
  });
  $("#ai-off").addEventListener("click", () => { ai.on = false; aiSaving = true; paintAI(); closeAI(); toast("AI second reader off. Rules and OCR only."); });
  $("#aiclose").addEventListener("click", closeAI);
  aiEl.modal.addEventListener("click", (e) => { if (e.target.id === "aimodal") closeAI(); });
  $("#ai-config").addEventListener("click", openAI);
  $("#opt-ai").addEventListener("change", (e) => {
    if (!e.target.checked) { ai.on = false; paintAI(); return; }
    if (builtinMode()) { ai.provider = "builtin"; ai.on = true; paintAI(); return; }   // built-in: nothing to choose
    if (aiReady()) { ai.on = true; paintAI(); } else { e.target.checked = false; openAI(); }
  });
  // "Add your own API key" buttons inside run results
  document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest("[data-ownkey]")) openAI(); });
  function builtinUsedUp() {
    builtinOut = true;
    try { sessionStorage.setItem("idd.builtinOut", "1"); } catch { /* ignore */ }
    ai.on = false; ai.provider = aiSaved.provider && aiSaved.provider !== "builtin" ? aiSaved.provider : "gemini";
    paintAI();
    toast("The built-in AI reader has reached its limit, so this invoice continues on rules only. To keep using the AI reader, add your own API key.", "info");
  }

  // ask the chosen provider for its reading; throws a short, readable message
  const askReader = (lines) => AI.read(aiCfg(), lines);
  if (!aiKeySession) ai.key = "";
  paintAI();

  // ================================================================ theme
  const systemDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
  function paintTheme() {
    const t = document.documentElement.getAttribute("data-theme") || (systemDark() ? "dark" : "light");
    $("#theme-dark").setAttribute("aria-pressed", t === "dark");
    $("#theme-light").setAttribute("aria-pressed", t === "light");
  }
  function setTheme(t) {
    document.documentElement.classList.add("theme-switch");
    setTimeout(() => document.documentElement.classList.remove("theme-switch"), 350);
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("idd.theme", t); } catch { /* not saved */ }
    paintTheme();
  }
  $("#theme-dark").addEventListener("click", () => setTheme("dark"));
  $("#theme-light").addEventListener("click", () => setTheme("light"));
  paintTheme();

  // ================================================================ views
  const VIEWS = {
    run: ["Process an invoice", "Drop a PDF or pick one from the inbox. Every stage runs live, and the decision explains itself."],
    queue: ["Exceptions", "Invoices the process held for a person. Each one says why, who owns it and what it would take to release it."],
    dash: ["Dashboard", "Every run in this browser: outcomes, money, reasons and timing."],
    ref: ["Reference data", "What the process checks against. In production this comes from the ERP."],
    how: ["How it works", "The process map, the edge cases and the rules behind every decision."],
  };
  let current = "run";
  // ---- motion helpers
  // staggered entrance: each element rises in a few milliseconds after the one before
  function stagger(els, start = 0) {
    [...els].slice(0, 16).forEach((el, i) => {
      el.classList.remove("enter"); void el.offsetWidth;
      el.style.setProperty("--i", start + i);
      el.classList.add("enter");
    });
  }
  function enterView(view) {
    if (view === "run") { stagger($$(".runlayout > *")); stagger($$("#samples .sample"), 2); }
    if (view === "queue") { stagger($$("#qstats > *")); stagger($$("#qlist > *, #qdone > *"), 4); }
    if (view === "dash") { stagger($$("#kpis > *")); stagger($$("#view-dash > .grid2 > *, #view-dash > .card"), 6); }
    if (view === "ref" || view === "how") stagger($$("#view-" + view + " .stackcol > .card"));
  }
  // one highlight that glides to the selected sidebar item
  const navInd = document.createElement("span");
  navInd.className = "nav-ind"; navInd.setAttribute("aria-hidden", "true");
  $(".side").appendChild(navInd);
  let navPlaced = false;
  function moveNavInd() {
    const b = $('.nav button[aria-current="page"]');
    if (!b || !b.offsetWidth) return;
    navInd.style.width = b.offsetWidth + "px"; navInd.style.height = b.offsetHeight + "px";
    navInd.style.transform = "translate(" + b.offsetLeft + "px, " + b.offsetTop + "px)";
    if (!navPlaced) { navPlaced = true; requestAnimationFrame(() => navInd.classList.add("ready")); }   // first placement doesn't slide in from the corner
  }
  window.addEventListener("resize", moveNavInd);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveNavInd);
  // fade a dialog out, then hide it
  function hideModal(el) {
    if (el.hidden || el.classList.contains("closing")) return;
    el.classList.add("closing");
    setTimeout(() => { el.hidden = true; el.classList.remove("closing"); }, 170);
  }

  function show(view) {
    current = view;
    $$(".nav button").forEach((b) => (b.dataset.view === view ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    $$(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
    const el = $("#view-" + view); el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
    $("#ptitle").textContent = VIEWS[view][0];
    $("#psub").textContent = VIEWS[view][1];
    $("#pactions").innerHTML = "";
    if (view === "dash") renderDash();
    if (view === "queue") renderQueue();
    if (view === "ref") renderRef();
    if (view === "how") renderHow();
    moveNavInd(); enterView(view);
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }
  $$(".nav button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));

  function updateBadge() {
    const n = openHolds().length, b = $("#qbadge");
    b.textContent = n; b.classList.toggle("zero", !n);
  }

  // ================================================================ inbox: samples + upload
  function renderSamples() {
    $("#samples").innerHTML = SAMPLES.map((s, i) => {
      const last = runs.find((r) => r.file === s.file.split("/").pop());
      const st = last ? statusOf(last) : null;
      return `
      <div class="sample" data-row="${i}" title="Click to look at this invoice">
        <span class="avatar av${i % 6}">${esc(initials(s.vendor))}</span>
        <span>
          <span class="v">${esc(s.vendor)}</span>
          <span class="l">${esc(s.label)}</span>
          <span class="meta"><span class="tag ${s.kind}">${s.kind === "happy" ? "Happy path" : "Edge case"}</span>
          ${st ? `<span class="last"><i style="background:var(--${st === "Approved" ? "ok" : st === "Hold" ? "warn" : "bad"}-mark)"></i>${STATUS_WORD[st]}</span>` : ""}</span>
        </span>
        <span class="right">
          <button class="btn xs primary srun" data-sample="${i}" title="Run this invoice (key ${i + 1})">${icon("play")}Run</button>
          <button class="btn xs sview" data-view="${i}" title="Open the document without running it">${icon("file")}View</button>
        </span>
      </div>`;
    }).join("");
    $$("[data-sample]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); runSample(+b.dataset.sample); }));
    $$("[data-row]").forEach((r) => r.addEventListener("click", () => previewSample(+r.dataset.row)));
  }

  // ---- look at a sample document without running it
  const samplePreviews = {};   // index -> array of image urls (kept for the session)
  async function samplePages(i) {
    if (samplePreviews[i]) return samplePreviews[i];
    const f = await loadSample(i), urls = [];
    if (f.type === "application/pdf") {
      const pdf = await pdfjsLib.getDocument({ data: f.bytes.slice() }).promise;
      for (let p = 1; p <= Math.min(pdf.numPages, 3); p++) urls.push((await renderPage(await pdf.getPage(p), 1.6)).toDataURL("image/jpeg", 0.88));
    } else {
      urls.push(URL.createObjectURL(new Blob([f.bytes], { type: f.type })));
    }
    return (samplePreviews[i] = urls);
  }
  async function previewSample(i) {
    const s = SAMPLES[i];
    $("#modaltitle").textContent = s.file.split("/").pop();
    $("#modalbody").innerHTML = `<p class="note" style="justify-content:center">${icon("clock")}Opening the document…</p>`;
    $("#modalfoot").hidden = false;
    $("#modalfoot").innerHTML = `<span class="why"><b>${esc(s.vendor)}</b> · ${esc(s.note)}</span><button class="btn sm primary" id="previewrun">${icon("play")}Run this invoice</button>`;
    $("#previewrun").addEventListener("click", () => { closeModal(); if (current !== "run") show("run"); runSample(i); });
    $("#modal").classList.remove("closing"); $("#modal").hidden = false;
    $("#modalclose").focus();
    try {
      const pages = await samplePages(i);
      if ($("#modal").hidden || $("#modaltitle").textContent !== s.file.split("/").pop()) return;
      $("#modalbody").innerHTML = pages.map((u, n) => `<img src="${u}" alt="Page ${n + 1} of ${esc(s.file.split("/").pop())}"${n ? ' style="margin-top:14px"' : ""}>`).join("");
    } catch (e) { $("#modalbody").innerHTML = `<p class="note" style="justify-content:center">${icon("info")}Couldn't open this document: ${esc(e.message)}</p>`; }
  }

  async function loadSample(i) {
    const s = SAMPLES[i];
    const name = s.file.split("/").pop();
    const ext = name.split(".").pop().toLowerCase();
    const type = { pdf: "application/pdf", webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" }[ext] || "application/pdf";
    // the sample files are built into the page, so they open even without a web server
    const packed = typeof SAMPLE_FILES !== "undefined" && SAMPLE_FILES[name];
    if (packed) return { name, type, bytes: Uint8Array.from(atob(packed), (c) => c.charCodeAt(0)), source: "sample", sampleIndex: i };
    let res;
    try { res = await fetch(s.file); } catch { throw new Error("Couldn't load the sample. Open the app from its web address instead of the saved file."); }
    if (!res.ok) throw new Error(`Couldn't load ${s.file} (HTTP ${res.status}).`);
    return { name, type, bytes: new Uint8Array(await res.arrayBuffer()), source: "sample", sampleIndex: i };
  }
  async function runSample(i) {
    if (busy) { toast("A run is in progress. It'll be done in a moment."); return; }
    try { await runInvoice(await loadSample(i)); } catch (e) { toast(e.message, "info"); }
  }
  $("#runall").addEventListener("click", async () => {
    if (busy) return;
    for (let i = 0; i < SAMPLES.length; i++) { await runSample(i); await sleep(700); }
    toast(`All ${SAMPLES.length} processed. The dashboard and Exceptions queue are up to date.`, "check");
  });

  const drop = $("#drop");
  $("#file").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) fromFile(f); e.target.value = ""; });
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) fromFile(f); });
  async function fromFile(f) {
    if (busy) { toast("A run is in progress. Drop the file again when it finishes."); return; }
    runInvoice({ name: f.name, type: f.type || (f.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : ""), bytes: new Uint8Array(await f.arrayBuffer()), source: "upload" });
  }

  // keyboard: 1 to the number of samples runs one, Esc closes the document viewer
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeModal(); if (!$("#aimodal").hidden) closeAI(); }
    if (!$("#aimodal").hidden || !$("#modal").hidden) return;
    if (e.metaKey || e.ctrlKey || e.altKey || /input|textarea|select/i.test((e.target.tagName || ""))) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= SAMPLES.length) { if (current !== "run") show("run"); runSample(n - 1); }
  });

  // ================================================================ document reading
  async function sha256(bytes) {
    try {
      const h = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch { return null; }
  }

  // group pdf.js text items into visual lines, top to bottom, left to right
  function itemsToLines(items) {
    const rows = [];
    items.filter((it) => it.str && it.str.trim()).forEach((it) => {
      const x = it.transform[4], y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) <= 2.5);
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x, w: it.width || 0, s: it.str });
    });
    rows.sort((a, b) => b.y - a.y);
    const lines = [], cells = [];
    rows.forEach((r) => {
      const parts = r.parts.sort((a, b) => a.x - b.x);
      const text = parts.map((p) => p.s.trim()).join(" ").replace(/\s+/g, " ").trim();
      if (!text) return;
      // a wide gap between two pieces of text starts a new column
      const cols = [];
      parts.forEach((p, i) => {
        const wide = i > 0 && p.x - (parts[i - 1].x + parts[i - 1].w) > 14;
        if (!cols.length || wide) cols.push(p.s.trim()); else cols[cols.length - 1] += " " + p.s.trim();
      });
      lines.push(text); cells.push(cols.map((c) => c.replace(/\s+/g, " ").trim()).filter(Boolean));
    });
    return { lines, cells };
  }

  async function renderPage(page, scale) {
    const vp = page.getViewport({ scale });
    const c = document.createElement("canvas");
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return c;
  }

  async function imageToCanvas(bytes, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("Not a readable image.")); img.src = url; });
    const c = document.createElement("canvas");
    const long = Math.max(img.width, img.height);
    const k = long < 1600 ? 2000 / long : Math.min(1, 2400 / long);   // upscale small pictures: OCR reads tiny text badly
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    return c;
  }

  // Tesseract OCR, loaded on first use. The English model ships with the page
  // (vendor/eng.traineddata.b64.txt) so OCR never depends on a third-party data host.
  let ocrWorker = null;
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Couldn't load " + src)); document.head.appendChild(s); });
  }
  async function getOcr(progress) {
    if (ocrWorker) return ocrWorker;
    progress("loading OCR engine");
    if (!window.Tesseract) await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js");
    progress("loading English model");
    const res = await fetch("vendor/eng.traineddata.b64.txt");
    if (!res.ok) throw new Error("English OCR model missing (vendor/eng.traineddata.b64.txt).");
    const b64 = (await res.text()).trim();
    const shim = `const B64=${JSON.stringify(b64)};const _f=self.fetch.bind(self);self.fetch=(u,o)=>String(u).indexOf("eng.traineddata")>=0?Promise.resolve(new Response(Uint8Array.from(atob(B64),c=>c.charCodeAt(0)))):_f(u,o);importScripts("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js");`;
    const workerPath = URL.createObjectURL(new Blob([shim], { type: "application/javascript" }));
    progress("starting OCR");
    ocrWorker = await Tesseract.createWorker("eng", 1, {
      workerPath, workerBlobURL: false, langPath: "https://model.local/tessdata", cacheMethod: "none", gzip: true,
      corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1",
    });
    // normal mode: the page is one block, so table rows stay on one line
    await ocrWorker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK });
    return ocrWorker;
  }
  // turn one recognised page into lines, column cells and each line's height on the page
  function pageToLines(data) {
    const out = [];
    (data.lines || []).forEach((l) => {
      const text = l.text.replace(/\s+/g, " ").trim();
      if (!text) return;
      // split the line into columns wherever two words are far apart
      const ws = (l.words || []).filter((x) => x.text && x.text.trim() && x.bbox).sort((a, b) => a.bbox.x0 - b.bbox.x0);
      const hs = ws.map((x) => x.bbox.y1 - x.bbox.y0).sort((a, b) => a - b);
      const gap = (hs.length ? hs[Math.floor(hs.length / 2)] : 20) * 1.6;
      const cols = [];
      ws.forEach((x, i) => {
        const wide = i > 0 && x.bbox.x0 - ws[i - 1].bbox.x1 > gap;
        if (!cols.length || wide) cols.push(x.text.trim()); else cols[cols.length - 1] += " " + x.text.trim();
      });
      out.push({ text, cells: cols.length ? cols : [text], y: l.bbox ? l.bbox.y0 : 0 });
    });
    return out;
  }

  async function ocrCanvas(canvas, progress) {
    const w = await getOcr(progress);
    progress("recognising text");
    const { data } = await w.recognize(canvas);
    let rows = pageToLines(data);
    if (!rows.length) data.text.split("\n").map((x) => x.trim()).filter(Boolean).forEach((x, i) => rows.push({ text: x, cells: [x], y: i }));

    // Very large, heavy headings (a big "INVOICE") are often skipped at full size but
    // read fine when the page is smaller. If no heading with the word invoice turned
    // up, look again at a shrunken copy and add any such line in its place.
    if (rows.length && !rows.some((r) => /\binvoice\b/i.test(r.text))) {
      try {
        const k = 800 / Math.max(canvas.width, canvas.height);
        if (k < 1) {
          const small = document.createElement("canvas");
          small.width = Math.round(canvas.width * k); small.height = Math.round(canvas.height * k);
          const sctx = small.getContext("2d"); sctx.imageSmoothingQuality = "high"; sctx.drawImage(canvas, 0, 0, small.width, small.height);
          progress("looking again for the heading");
          await w.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });   // finds scattered text such as big headings
          let second;
          try { second = pageToLines((await w.recognize(small)).data); }
          finally { await w.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK }); }
          second.filter((r) => /\b(tax\s+)?invoice\b/i.test(r.text) && r.text.length <= 40)
            .forEach((r) => { rows.push({ text: r.text, cells: [r.text], y: r.y / k }); });
          rows.sort((a, b) => a.y - b.y);
        }
      } catch { /* the second look is a bonus; the first reading stands */ }
    }
    return { lines: rows.map((r) => r.text), cells: rows.map((r) => r.cells), confidence: Math.round(data.confidence) };
  }

  // ================================================================ pipeline UI
  const STAGES = [
    ["receive", "Receive file"],
    ["read", "Read the document"],
    ["extract", "Extract fields"],
    ["ai", "Second reading by AI"],
    ["validate", "Check the invoice itself"],
    ["vendor", "Vendor and bank details"],
    ["dup", "Duplicate check"],
    ["po", "Match to PO and receipts"],
    ["decide", "Decide"],
    ["record", "Record and route"],
  ];
  const NODE_ICON = { pass: "check", warn: "bang", fail: "x", skip: "minus" };
  let busy = false;

  const stageEl = (key) => $(`.stage[data-k="${key}"]`);
  function drawStages() {
    $("#stages").innerHTML = STAGES.map(([k, name]) => `
      <li class="stage" data-k="${k}" data-s="pending">
        <span class="node"></span>
        <button class="st-h" aria-expanded="false" aria-controls="sd-${k}">
          <span><span class="st-n">${name}</span><span class="st-s">Waiting</span></span>
          <span class="st-t"></span><span class="st-c">${icon("chev")}</span>
        </button>
        <div class="st-d" id="sd-${k}"><div><div class="inner"></div></div></div>
      </li>`).join("");
    $$(".st-h").forEach((b) => b.addEventListener("click", () => {
      const li = b.closest(".stage");
      if (li.dataset.s === "pending" || li.dataset.s === "running") return;
      toggleStage(li, b.getAttribute("aria-expanded") !== "true");
    }));
  }
  function toggleStage(li, open) {
    $(".st-d", li).classList.toggle("open", open);
    $(".st-h", li).setAttribute("aria-expanded", open);
  }
  function setStage(key, s, summary, ms, detailHTML) {
    const el = stageEl(key); if (!el) return;
    el.dataset.s = s;
    $(".node", el).innerHTML = NODE_ICON[s] ? icon(NODE_ICON[s]) : "";
    if (summary != null) $(".st-s", el).textContent = summary;
    if (ms != null) $(".st-t", el).textContent = dur(ms);
    if (detailHTML != null) $(".inner", el).innerHTML = detailHTML;
  }
  function pipeHead(run, state) {
    const done = run ? Object.keys(run.stages || {}).length : 0;
    const pct = Math.round((done / STAGES.length) * 100);
    const st = run && run.decision ? run.decision.status : "";
    const flagged = run ? Object.entries(run.stages || {}).filter(([k, v]) => k !== "decide" && (v.s === "warn" || v.s === "fail")).length : 0;
    $("#pipehead").innerHTML = `
      <div class="row">
        <div class="file"><span class="fi">${icon("file")}</span><span style="min-width:0"><b>${run ? esc(run.file) : "No invoice yet"}</b><span>${run ? `${esc(run.id)} · ${run.source === "sample" ? "from inbox" : run.source === "history" ? "from history · " + when(run.at) : "uploaded"}` : "Pick a sample or drop a file to start"}</span></span></div>
        <span class="clock">${state === "running" ? '<span class="live"></span>' : icon("clock")}<span id="runclock">${run && run.ms ? dur(run.ms) : "0.0 s"}</span></span>
      </div>
      <div class="progress ${state === "done" ? "done " + st : ""}"><span id="progbar" style="width:${state === "done" ? 100 : pct}%"></span></div>
      ${state === "running" ? '<div class="quicklabel" id="quicklabel" aria-live="polite">Starting…</div>' : ""}
      ${state === "done" ? `<div class="pipe-sum"><b>${done} stages</b><span>·</span>${flagged ? `<span style="color:var(--warn)">${flagged} flagged${$(".pipeline").classList.contains("quick") ? "" : ", opened below"}</span>` : `<span style="color:var(--ok)">all checks passed</span>`}<span>·</span><span class="mono">${dur(run.ms)}</span><button class="stepstoggle" id="stepstoggle" type="button" aria-expanded="false">Show the ${done} steps${icon("chev")}</button></div>` : ""}`;
    const tg = $("#stepstoggle");
    if (tg) tg.addEventListener("click", () => {
      const open = $(".pipeline").classList.toggle("expanded");
      tg.setAttribute("aria-expanded", open);
      tg.firstChild.textContent = open ? `Hide the ${done} steps` : `Show the ${done} steps`;
    });
  }
  // step-by-step on: the full stage list. Off: one progress block, with the steps a click away.
  function applyViewMode(quick) {
    const p = $(".pipeline");
    p.classList.toggle("quick", quick);
    if (!quick) p.classList.remove("expanded");
  }
  const bumpProgress = (n) => { const b = $("#progbar"); if (b) b.style.width = Math.round((n / STAGES.length) * 100) + "%"; };

  const worst = (checks) => (checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "pass");
  const CI = { pass: "check", warn: "bang", fail: "x", info: "minus" };
  const checksHTML = (checks) => `<ul class="checks">${checks.map((c) => `<li><span class="ci ${c.status}">${icon(CI[c.status] || "minus")}</span><span><b>${esc(c.label)}.</b> <span class="muted">${esc(c.detail)}</span></span></li>`).join("")}</ul>`;

  // ================================================================ the run
  async function runInvoice(file) {
    if (busy) return;
    busy = true;
    $$("[data-sample],#runall").forEach((b) => (b.disabled = true));
    if (file.sampleIndex != null) { const b = $(`[data-row="${file.sampleIndex}"]`); if (b) b.setAttribute("aria-busy", "true"); }
    if (current !== "run") show("run");
    const pace = $("#opt-pace").checked ? 450 : 0;
    applyViewMode(!pace);
    const useAI = ai.on && aiReady();
    const t0 = now();
    const run = { id: "R-" + Date.now().toString(36).toUpperCase().slice(-6), at: new Date().toISOString(), file: file.name, source: file.source, stages: {}, events: [] };
    const log = (text, tone) => run.events.push({ at: new Date().toISOString(), text, tone });
    log(file.source === "sample" ? "Picked up from the AP inbox" : "Uploaded by a user", "acc");

    drawStages();
    pipeHead(run, "running");
    const clock = setInterval(() => { const c = $("#runclock"); if (c) c.textContent = ((now() - t0) / 1000).toFixed(1) + " s"; }, 100);
    $("#decision").innerHTML = `<div class="skeleton" aria-label="Working"><i style="width:40%"></i><i style="width:85%;height:18px"></i><i style="width:60%"></i><i style="width:30%;height:26px;margin-top:18px"></i><i style="width:100%;margin-top:28px"></i><i style="width:92%"></i><i style="width:70%"></i></div>`;

    const ctx = { company: SEED.company, checks: [] };
    let preview = null;
    async function stage(key, fn) {
      setStage(key, "running", "Running…");
      const ql = $("#quicklabel"); if (ql) ql.textContent = (STAGES.find((x) => x[0] === key) || [0, ""])[1] + "…";
      const s0 = now();
      let r;
      try { r = await fn(); }
      catch (e) { r = { s: "fail", summary: e.message || String(e), detail: `<p>${esc(e.message || e)}</p>` }; }
      const ms = now() - s0;
      if (pace) await sleep(Math.max(0, pace - ms));
      setStage(key, r.s, r.summary, ms, r.detail || "");
      run.stages[key] = { s: r.s, summary: r.summary, ms: Math.round(ms), detail: r.detail || "" };
      bumpProgress(Object.keys(run.stages).length);
      if (r.s === "fail" || r.s === "warn") toggleStage(stageEl(key), true);
      return r;
    }

    try {
      // 1 receive
      await stage("receive", async () => {
        const hash = await sha256(file.bytes);
        run.hash = hash;
        const kind = /pdf/i.test(file.type) || file.name.toLowerCase().endsWith(".pdf") ? "PDF" : /image/.test(file.type) ? "Image" : null;
        if (!kind) throw new Error("Only PDF, PNG, JPEG or WebP files can be processed.");
        ctx.kind = kind;
        const same = runs.find((r) => r.hash && r.hash === hash);
        return { s: "pass", summary: `${kind}, ${(file.bytes.length / 1024).toFixed(0)} KB${same ? " · identical file seen in " + same.id : ""}`,
          detail: `<dl class="kv"><dt>File</dt><dd>${esc(file.name)}</dd><dt>SHA-256</dt><dd class="mono">${esc(hash ? hash.slice(0, 24) + "…" : "n/a")}</dd>${same ? `<dt>Seen before</dt><dd>Identical bytes were processed in ${same.id} (${when(same.at)}). The duplicate check decides what that means.</dd>` : ""}</dl>` };
      });

      // 2 read
      await stage("read", async () => {
        let lines = [], cells = [], method, conf = null, canvas, firstPage;
        if (ctx.kind === "PDF") {
          const pdf = await pdfjsLib.getDocument({ data: file.bytes.slice() }).promise;
          const pages = Math.min(pdf.numPages, 3);
          for (let p = 1; p <= pages; p++) {
            const page = await pdf.getPage(p);
            const tc = await page.getTextContent();
            const got = itemsToLines(tc.items);
            lines.push(...got.lines); cells.push(...got.cells);
            if (p === 1) firstPage = page;
          }
          method = "PDF text layer";
          const hasText = lines.join("").replace(/\s/g, "").length >= 40;
          // the preview is a nice-to-have for text PDFs, so it never holds up the run
          canvas = hasText ? await Promise.race([renderPage(firstPage, 2), sleep(2500).then(() => null)]) : await renderPage(firstPage, 2.2);
          if (!hasText) {
            setStage("read", "running", "No text layer, so this is a scan. Running OCR…");
            const o = await ocrCanvas(canvas, (m) => setStage("read", "running", "Scan detected · " + m + "…"));
            lines = o.lines; cells = o.cells; conf = o.confidence; method = "OCR (Tesseract) on scanned page";
          }
          run.pages = pdf.numPages;
        } else {
          canvas = await imageToCanvas(file.bytes, file.type);
          const o = await ocrCanvas(canvas, (m) => setStage("read", "running", "Image · " + m + "…"));
          lines = o.lines; cells = o.cells; conf = o.confidence; method = "OCR (Tesseract) on image";
        }
        preview = canvas;
        ctx.lines = lines; ctx.cells = cells; ctx.method = method; ctx.ocrConfidence = conf;
        run.method = method; run.ocrConfidence = conf; run.text = lines;
        log(`Read with ${method}${conf != null ? ` (${conf}% confidence)` : ""}`);
        const s = !lines.length ? "fail" : conf != null && conf < 70 ? "warn" : "pass";
        return { s, summary: `${method}${conf != null ? `, ${conf}% confidence` : ""} · ${lines.length} lines`,
          detail: `<details class="more"><summary>${icon("chev")}Show the ${lines.length} lines read</summary><pre class="code">${esc(lines.join("\n"))}</pre></details>` };
      });

      // 3 extract
      await stage("extract", async () => {
        const f = Engine.extract(ctx.lines, ctx.cells);
        ctx.fields = f;
        const found = ["invoiceNumber", "invoiceDate", "poNumber", "total", "bankLast4"].filter((k) => f[k]).length;
        const n = f.lines.value.length;
        const sg = f.signals.value;
        if ((sg.score < 2 || !n) && !f.total && !f.invoiceNumber) return { s: "fail", summary: `Doesn't look like an invoice (${sg.score} of 5 invoice signals)`, detail: fieldsHTML(f) + `<p class="note">${icon("info")}Missing: ${esc(sg.missing.join(", "))}.</p>` };
        return { s: f.total && f.invoiceNumber ? "pass" : "warn", summary: `${found} of 5 key fields, ${n} line item${n === 1 ? "" : "s"}`, detail: fieldsHTML(f) };
      });

      // 4 AI second reading
      await stage("ai", async () => {
        if (!useAI) return { s: "skip", summary: "Off for this run · rules and OCR only", detail: `<p class="muted" style="margin:0">Without a second reader, any field the rules can't find is treated as missing rather than guessed.</p>` };
        let ai;
        try { ai = await askReader(ctx.lines); }
        catch (e) {
          if (aiCfg().provider === "builtin" && (e.code === "quota" || e.code === "unconfigured")) {
            builtinUsedUp();
            return { s: "skip", summary: "Built-in AI reader has reached its limit · continuing rules-only",
              detail: `<p class="muted" style="margin:0 0 10px">The site owner's Gemini allowance is used up for now. The decision below comes from the rules, as it always does. To keep using the AI reader, use your own API key.</p><button class="btn xs" type="button" data-ownkey>Add your own API key</button>` };
          }
          return { s: "skip", summary: (e.message || "AI reader failed") + " · continuing rules-only", detail: "" };
        }
        ctx.ai = ai; run.ai = ai;
        const rows = Engine.compareWithAI(ctx.fields, ai, Engine.identifyVendor(ctx.fields, ctx.lines, SEED), SEED);
        const filled = Engine.fillFromAI(ctx.fields, ai);
        ctx.aiDisagree = rows.filter((r) => r.status === "fail" && ["invoiceNumber", "total", "vendor", "bankLast4"].includes(r.key)).map((r) => r.label.toLowerCase());
        const dis = rows.filter((r) => r.status === "fail").length;
        const s = dis ? "fail" : filled.length || rows.some((r) => r.status === "warn") ? "warn" : "pass";
        log(dis ? `AI reader disagreed on ${dis} field${dis > 1 ? "s" : ""}` : "AI reader agreed with the rules");
        const word = { pass: "same", fail: "differs", warn: "one only", info: "neither" };
        return { s, summary: dis ? `Disagrees on ${dis} field${dis > 1 ? "s" : ""}` : filled.length ? `Agrees · filled ${filled.join(", ")} from ${aiShort()}` : "Both readings agree",
          detail: `<div class="tbl"><table><thead><tr><th>Field</th><th>Rules</th><th>${esc(aiShort())}</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="mono">${esc(fmtVal(r.mine))}</td><td class="mono">${esc(fmtVal(r.theirs))}</td><td><span class="ci ${r.status}" style="display:inline-grid;width:auto;padding:0 6px;font-size:11px;font-weight:600">${word[r.status]}</span></td></tr>`).join("")}</tbody></table></div>${filled.length ? `<p class="note">${icon("info")}Filled from ${esc(aiShort())} because no rule found them: ${esc(filled.join(", "))}. Marked as AI-sourced in the record.</p>` : ""}` };
      });

      // 5 validate
      await stage("validate", async () => {
        const c = Engine.validateDocument(ctx.fields, policy, SEED.today, SEED.company);
        ctx.checks.push(...c);
        return { s: worst(c), summary: c.filter((x) => x.status !== "pass").map((x) => x.label).join(", ") || "Complete, and the arithmetic checks out", detail: checksHTML(c) };
      });

      // 6 vendor + bank
      await stage("vendor", async () => {
        const vm = Engine.identifyVendor(ctx.fields, ctx.lines, SEED);
        ctx.vendor = vm;
        const c = Engine.vendorChecks(ctx.fields, vm);
        ctx.checks.push(...c);
        const s = worst(c);
        return { s, summary: vm ? `${vm.vendor.name} (${vm.vendor.id})${s === "fail" ? " · " + c.filter((x) => x.status === "fail").map((x) => x.label.toLowerCase()).join(", ") + " problem" : ""}` : "Sender not in vendor master", detail: checksHTML(c) };
      });
      const activeVendor = ctx.vendor && ctx.vendor.vendor.status === "Active" ? ctx.vendor.vendor : null;

      // 7 duplicates
      await stage("dup", async () => {
        const d = Engine.duplicateCheck(ctx.fields, activeVendor, history());
        ctx.dupMatch = d.match; ctx.checks.push(...d.checks);
        const s = d.checks.some((c) => c.status === "fail") ? "fail" : d.checks.some((c) => c.status === "warn") ? "warn" : d.checks[0].status === "info" ? "skip" : "pass";
        return { s, summary: s === "fail" ? `Matches ${d.match.invoice}` : s === "warn" ? "Possible match, see detail" : s === "skip" ? "Skipped" : "No earlier invoice matches", detail: checksHTML(d.checks) };
      });

      // 8 PO match
      await stage("po", async () => {
        const pf = Engine.findPO(ctx.fields, activeVendor, SEED);
        const pm = Engine.matchPO(ctx.fields, activeVendor, pf, history(), policy);
        ctx.poFind = pf; ctx.poMatch = pm; ctx.checks.push(...pm.checks);
        const s = worst(pm.checks);
        return { s, summary: pm.po ? `${pm.po.po}${pf.how === "inferred" ? " (inferred)" : ""} · ${pm.lines.filter((l) => l.status === "pass").length} of ${pm.lines.length} lines in tolerance` : "No PO matched",
          detail: checksHTML(pm.checks) + (pm.lines.length ? linesHTML(pm.lines) : "") };
      });

      // 9 decide
      let decision;
      await stage("decide", async () => {
        ctx.lineCount = (ctx.lines || []).length;
        decision = Engine.decide(ctx, policy);
        ctx.erp = Engine.erpRecord(ctx, decision);
        log(`Decided: ${STATUS_WORD[decision.status]} (${REASON[decision.code] || decision.code})`, decision.status === "Approved" ? "ok" : decision.status === "Hold" ? "warn" : "bad");
        return { s: decision.status === "Approved" ? "pass" : decision.status === "Hold" ? "warn" : "fail", summary: `${STATUS_WORD[decision.status]} · ${REASON[decision.code] || decision.code}`,
          detail: `<p style="margin:0">${esc(decision.headline)}.</p>` };
      });

      // 10 record + route
      await stage("record", async () => {
        const f = ctx.fields;
        const entered = decision.status === "Rejected" ? null : {
          vendor: activeVendor && activeVendor.id, invoice: f.invoiceNumber && f.invoiceNumber.value, date: f.invoiceDate && f.invoiceDate.value,
          amount: f.total && f.total.value, currency: f.currency ? f.currency.value : "USD", po: ctx.poMatch && ctx.poMatch.po && ctx.poMatch.po.po,
          status: decision.status === "Approved" ? "Approved" : "On hold", enteredOn: new Date().toISOString().slice(0, 10), runId: run.id,
          lines: ((ctx.poMatch && ctx.poMatch.lines) || []).filter((l) => l.pl).map((l) => ({ ln: l.pl.ln, qty: l.it.qty })),
        };
        log(decision.status === "Hold" ? `Routed to ${decision.owner} via the Exceptions queue` : decision.status === "Approved" ? "Scheduled for the next payment run" : `Not entered · reply drafted for ${decision.owner}`, decision.status === "Hold" ? "warn" : undefined);
        if (decision.message) log(`Message drafted to ${decision.message.to}`);
        Object.assign(run, {
          ms: Math.round(now() - t0), decision, erp: ctx.erp, entered,
          vendor: ctx.vendor ? { id: ctx.vendor.vendor.id, name: ctx.vendor.vendor.name } : null,
          printedVendor: f.vendorName ? f.vendorName.value : null,
          invoice: f.invoiceNumber ? f.invoiceNumber.value : null, total: f.total ? f.total.value : null, currency: f.currency ? f.currency.value : "USD",
          checks: ctx.checks, aiUsed: !!ctx.ai, aiName: ctx.ai ? aiName() : null, preview: preview ? thumb(preview) : null,
        });
        if (preview) fullPreviews[run.id] = preview.toDataURL("image/jpeg", 0.85);
        runs.unshift(run); runs = runs.slice(0, 60); saveRuns();
        return { s: "pass", summary: entered ? `Entered in AP as ${entered.status.toLowerCase()} · routed to ${decision.owner}` : `Not entered · reply drafted for ${decision.owner}`,
          detail: `<details class="more"><summary>${icon("chev")}ERP record</summary><pre class="code">${esc(JSON.stringify(ctx.erp, null, 2))}</pre></details>` };
      });
      saveRuns();
      pipeHead(run, "done");
      renderDecision(run);
      // on narrower screens the decision sits below the pipeline: bring it into view
      const dr = $("#decision").getBoundingClientRect();
      if (dr.top > innerHeight - 120) $("#decision").scrollIntoView({ behavior: "smooth", block: "start" });
      updateBadge();
      renderSamples();
    } catch (e) {
      toast(e.message || String(e));
    } finally {
      clearInterval(clock);
      busy = false;
      $$("[data-sample],#runall").forEach((b) => { b.disabled = false; });
      $$("[data-row]").forEach((r) => r.removeAttribute("aria-busy"));
    }
  }

  const fmtVal = (v) => (v == null || v === "" ? "—" : typeof v === "number" ? Engine.money(v) : typeof v === "boolean" ? (v ? "yes" : "no") : String(v));
  function thumb(c) { const t = document.createElement("canvas"); const w = 360; t.width = w; t.height = Math.round((c.height * w) / c.width); t.getContext("2d").drawImage(c, 0, 0, t.width, t.height); return t.toDataURL("image/jpeg", 0.65); }

  function fieldsHTML(f) {
    const rows = [["Invoice number", "invoiceNumber"], ["Invoice date", "invoiceDate"], ["PO number", "poNumber"], ["Subtotal", "subtotal"], ["Tax", "tax"], ["Total", "total"], ["Terms", "terms"], ["Bank", "bankName"], ["Account (last 4)", "bankLast4"], ["Bank change wording", "bankChangeNotice"], ["Reminder wording", "reminderWording"], ["Emails", "emails"], ["Sender as printed", "vendorName"], ["Billed to", "billTo"], ["Currency", "currency"]];
    const tr = rows.filter(([, k]) => f[k]).map(([l, k]) => {
      let v = f[k].value; if (k === "terms") v = v.text; if (Array.isArray(v)) v = v.join(", ");
      return `<tr><td>${l}</td><td class="mono">${esc(fmtVal(v))}</td><td><div class="ev" style="margin:0">${esc(f[k].line || f[k].how)}</div></td></tr>`;
    }).join("");
    const miss = rows.filter(([, k]) => !f[k] && ["invoiceNumber", "invoiceDate", "poNumber", "total"].includes(k)).map(([l]) => l);
    const items = f.lines.value;
    return `<div class="tbl"><table><thead><tr><th>Field</th><th>Value</th><th>Evidence: the line it came from</th></tr></thead><tbody>${tr}</tbody></table></div>
      ${miss.length ? `<p class="note">${icon("info")}Not on the document: ${esc(miss.join(", "))}.</p>` : ""}
      ${items.length ? `<div class="tbl"><table><thead><tr><th>Line item</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr></thead><tbody>${items.map((it) => `<tr><td>${esc(it.desc)}${it.sku ? `<div class="ev">${esc(it.sku)}</div>` : ""}</td><td class="n">${it.qty.toLocaleString()} ${esc(it.uom || "")}</td><td class="n">${it.price}</td><td class="n">${money(it.amount)}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
  }
  function linesHTML(lines) {
    return `<div class="tbl"><table><thead><tr><th>Invoice line</th><th>PO line</th><th>Result</th></tr></thead><tbody>${lines.map((l) => `<tr><td>${esc(l.it.desc)}<div class="ev">${l.it.qty.toLocaleString()} ${esc(l.it.uom || "")} × ${l.it.price}</div></td><td>${l.pl ? `#${l.pl.ln} ${esc(l.pl.sku)}<div class="ev">${l.pl.qty.toLocaleString()} ${esc(l.pl.uom)} × ${l.pl.price}</div>` : "<span class='faint'>not on PO</span>"}</td><td><span class="ci ${l.status}" style="display:inline-grid;vertical-align:-5px;margin-right:6px">${icon(l.status === "pass" ? "check" : "x")}</span><span class="muted">${esc(l.notes.join(" "))}</span></td></tr>`).join("")}</tbody></table></div>`;
  }

  // ================================================================ decision panel
  function emptyDecision() {
    $("#decision").innerHTML = `<div class="empty"><div class="art">${icon("inbox")}</div><h3>No decision yet</h3><p>Run an invoice and its decision appears here: approve, hold or reject, with the reasons and the next step.</p><div class="keys">Press <span class="kbd">1</span>–<span class="kbd">${SAMPLES.length}</span> to run a sample</div></div>`;
  }

  function renderDecision(run) {
    const money = (x) => Engine.money(x, run.currency || "USD");
    const d = run.decision, total = run.total;
    const payable = run.erp ? run.erp.payable_now : null;
    const fails = d.reasons.filter((c) => c.status === "fail"), warns = d.reasons.filter((c) => c.status === "warn");
    let sched = "";
    if (d.schedule) {
      sched = `<dt>Due</dt><dd><span class="mono">${esc(d.schedule.due)}</span> <span class="faint">· Net ${d.schedule.net}</span></dd>`;
      if (d.schedule.discount) {
        const left = Engine.daysBetween(new Date().toISOString().slice(0, 10), d.schedule.discount.by);
        sched += `<dt>Discount</dt><dd>${d.schedule.discount.pct}% if paid by ${esc(d.schedule.discount.by)}${d.schedule.discount.amount ? ` (${money(d.schedule.discount.amount)})` : ""}<span class="faint">${left >= 0 ? ` · ${left} day${left === 1 ? "" : "s"} left` : " · window has passed"}</span></dd>`;
      }
    }
    const res = run.resolution;
    const followUp = d.status === "Hold" && !res
      ? `<div class="sect"><div class="resolve-cta">${icon("pause")}<span>Waiting for <b>${esc(d.owner)}</b> in the Exceptions queue.</span><button class="btn sm" id="goqueue">Resolve${icon("arrow")}</button></div></div>`
      : res ? `<div class="sect"><div class="resolved-banner">${pill(res.final, res.label)}<span class="muted">${esc(res.note || "No note")} <span class="faint">· ${when(res.at)}</span></span></div></div>` : "";
    $("#decision").innerHTML = `<div class="reveal">
      <div class="verdict ${d.status}">
        <div class="top-row">${pill(d.status, d.status === "Approved" ? "Approved for payment" : null)}<span class="faint mono" style="font-size:12px">${esc(run.id)} · ${dur(run.ms)}</span></div>
        <h3>${esc(d.headline)}</h3>
        <div class="who">${esc(run.vendor ? run.vendor.name : run.printedVendor ? run.printedVendor + " (not on file)" : "Sender not identified")} · <span class="mono">${esc(run.invoice || "no invoice number")}</span></div>
        <div class="amount"><span class="big" id="bigamt">${money(total)}</span>${d.status === "Hold" && payable ? `<span class="pay"><b>${money(payable)}</b> payable now</span>` : ""}</div>
      </div>
      ${followUp}
      <div class="sect"><h4>Next step</h4><dl class="next"><dt>Owner</dt><dd><span class="owner"><i>${esc(initials(d.owner))}</i>${esc(d.owner)}</span></dd><dt>Action</dt><dd class="muted">${esc(d.action)}</dd>${sched}</dl></div>
      <div class="sect"><h4>Why</h4>${fails.length || warns.length ? checksHTML([...fails, ...warns]) : `<p class="muted" style="margin:0;font-size:13px">All ${run.checks.length} checks passed: vendor and bank on file, no duplicate, every line within tolerance of ${esc(run.erp.po_number)} and its goods receipt.</p>`}</div>
      ${d.message ? `<div class="sect"><h4>Drafted message<span class="right"><button class="btn xs" id="copymsg">${icon("copy")}Copy</button></span></h4><div class="email"><div class="eh"><span>To</span><b>${esc(d.message.to)}</b><span>Subject</span><span style="color:var(--text)">${esc(d.message.subject)}</span></div><div class="eb" id="msgtext">${esc(d.message.body)}</div></div><p class="note">${icon("shield")}For a person to review and send. Nothing is sent automatically.</p></div>` : ""}
      <div class="sect"><h4>Document</h4><div class="docprev">${run.preview ? `<button class="thumb" id="openDoc" title="Open full page">${`<img src="${run.preview}" alt="First page of ${esc(run.file)}">`}</button>` : ""}<dl class="kv"><dt>File</dt><dd>${esc(run.file)}</dd><dt>Read by</dt><dd>${esc(run.method)}${run.ocrConfidence != null ? `, ${run.ocrConfidence}%` : ""}</dd><dt>Second reader</dt><dd>${run.aiUsed ? esc(run.aiName || "AI reader") : "Off"}</dd><dt>PO</dt><dd class="mono">${esc((run.erp && run.erp.po_number) || "—")}${run.erp && run.erp.po_source === "inferred" ? " (inferred)" : ""}</dd></dl></div></div>
      <div class="sect"><h4>Activity</h4><ul class="timeline">${(run.events || []).map((e) => `<li class="${e.tone || ""}"><time>${new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>${esc(e.text)}</li>`).join("")}</ul></div>
      <div class="sect"><details class="more"><summary>${icon("chev")}ERP record (JSON)</summary><pre class="code">${esc(JSON.stringify(run.erp, null, 2))}</pre></details></div>
    </div>`;
    countUp($("#bigamt"), total, (x) => money(x));
    const cp = $("#copymsg");
    if (cp) cp.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText($("#msgtext").textContent); toast("Message copied", "check"); }
      catch { const r = document.createRange(); r.selectNodeContents($("#msgtext")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Selected. Press Ctrl or Cmd + C to copy."); }
    });
    const gq = $("#goqueue"); if (gq) gq.addEventListener("click", () => { show("queue"); focusQueueItem(run.id); });
    const od = $("#openDoc"); if (od) od.addEventListener("click", () => openModal(run));
  }

  // replay a stored run in the process view
  function openRun(id) {
    const run = runs.find((r) => r.id === id); if (!run) return;
    show("run");
    applyViewMode(false);
    drawStages();
    pipeHead(Object.assign({}, run, { source: "history" }), "done");
    STAGES.forEach(([k]) => { const s = run.stages[k]; if (s) { setStage(k, s.s, s.summary, s.ms, s.detail); if (s.s === "fail" || s.s === "warn") toggleStage(stageEl(k), true); } });
    renderDecision(run);
  }

  // ================================================================ document viewer
  function openModal(run) {
    $("#modaltitle").textContent = run.file;
    $("#modalfoot").hidden = true;
    const src = fullPreviews[run.id] || run.preview;
    $("#modalbody").innerHTML = `<img src="${src}" alt="First page of ${esc(run.file)}">${fullPreviews[run.id] ? "" : `<p class="note" style="justify-content:center">${icon("info")}Lower-resolution copy from history. Re-run the invoice for full size.</p>`}`;
    $("#modal").classList.remove("closing"); $("#modal").hidden = false;
    $("#modalclose").focus();
  }
  function closeModal() { hideModal($("#modal")); }
  $("#modalclose").addEventListener("click", closeModal);
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });

  // ================================================================ exceptions queue (human in the loop)
  // What a reviewer can do depends on why the invoice was held.
  function actionsFor(run) {
    const d = run.decision, po = run.erp && run.erp.po_number, pay = run.erp ? run.erp.payable_now : 0, money = (x) => Engine.money(x, run.currency);
    switch (d.code) {
      case "PO_INFERRED": return { hint: `Confirm the invoice belongs to ${po}. Everything else already checks out.`, acts: [
        { key: "approve", label: `Confirm ${po} and approve`, cls: "ok", final: "Approved" },
        { key: "reject", label: "Wrong PO, reject", cls: "danger", final: "Rejected" }] };
      case "MATCH_EXCEPTION": return { hint: `Release the part that matches (${money(pay)}) and dispute the rest with the vendor, or reject the whole invoice.`, acts: [
        { key: "partial", label: `Pay ${money(pay)}, dispute the rest`, cls: "ok", final: "Approved", payable: pay },
        { key: "reject", label: "Reject invoice", cls: "danger", final: "Rejected" }] };
      case "BANK_CHANGE": return { hint: "Only release after calling the vendor on the number on file. Record who you spoke to.", needNote: true, acts: [
        { key: "verified", label: "Verified by phone, release", cls: "ok", final: "Approved" },
        { key: "fraud", label: "Reject as suspected fraud", cls: "danger", final: "Rejected" }] };
      case "APPROVAL_LIMIT": return { hint: "Matched in full. Needs a controller's sign-off because of the amount.", acts: [
        { key: "approve", label: "Approve as controller", cls: "ok", final: "Approved" },
        { key: "reject", label: "Reject", cls: "danger", final: "Rejected" }] };
      default: return { hint: "Check the document, then approve with a note or reject.", needNote: true, acts: [
        { key: "approve", label: "Approve with note", cls: "ok", final: "Approved" },
        { key: "reject", label: "Reject", cls: "danger", final: "Rejected" }] };
    }
  }

  function renderQueue() {
    const open = openHolds().sort((a, b) => (b.total || 0) - (a.total || 0));
    const reviewed = runs.filter((r) => r.resolution);
    const held$ = open.reduce((s, r) => s + (r.total || 0), 0);
    const pay$ = open.reduce((s, r) => s + ((r.erp && r.erp.payable_now) || 0), 0);
    const oldest = open.length ? open.reduce((a, r) => (r.at < a.at ? r : a)) : null;
    const tile = (k, v, s, id) => `<div class="card kpi"><div class="k">${k}</div><div class="v" ${id ? `id="${id}"` : ""}>${v}</div><div class="s">${s}</div></div>`;
    $("#qstats").innerHTML = [
      tile("Open exceptions", open.length, open.length ? "waiting for a person" : "nothing waiting"),
      tile("Value on hold", moneySum(open, (r) => r.total), "across open items", "qheld"),
      tile("Releasable now", moneySum(open, (r) => (r.erp && r.erp.payable_now) || 0), "matched part of held invoices"),
      tile("Oldest item", oldest ? when(oldest.at) : "—", oldest ? `${oldest.vendor ? oldest.vendor.name : "Unknown"}` : "queue is clear"),
    ].join("");

    $("#qlist").innerHTML = open.length ? open.map((r) => {
      const a = actionsFor(r), d = r.decision;
      const why = d.reasons.filter((c) => c.status === "fail").slice(0, 3);
      return `<div class="card qitem" data-q="${r.id}">
        <div class="qmain">
          <div class="qhead">${pill("Hold")}<span class="pill neutral">${esc(REASON[d.code] || d.code)}</span><span class="faint mono" style="font-size:12px;margin-left:auto">${esc(r.id)} · ${when(r.at)}</span></div>
          <h3>${esc(d.headline)}</h3>
          <div class="qmeta"><span><b style="color:var(--text)">${esc(r.vendor ? r.vendor.name : r.printedVendor || "Unknown sender")}</b></span><span class="mono">${esc(r.invoice || "—")}</span><span class="num">${money(r.total, r.currency)}</span><span>Owner: ${esc(d.owner)}</span></div>
          ${why.length ? `<div class="qwhy">${checksHTML(why)}</div>` : ""}
          <div style="margin-top:12px"><button class="btn xs ghost" data-open="${r.id}">${icon("file")}Open full run</button></div>
        </div>
        <div class="qact">
          <span class="hint">${esc(a.hint)}</span>
          <label for="note-${r.id}">Reviewer note${a.needNote ? " (required)" : ""}</label>
          <textarea id="note-${r.id}" placeholder="${d.code === "BANK_CHANGE" ? "e.g. Called (503) 555-0161, spoke to M. Chen, change confirmed" : "Optional context for the audit trail"}"></textarea>
          <span class="field-err" id="err-${r.id}" hidden>Add a note before releasing. It goes in the audit trail.</span>
          <div class="btns">${a.acts.map((x) => `<button class="btn sm ${x.cls}" data-act="${x.key}" data-run="${r.id}">${icon(x.final === "Approved" ? "check" : "x")}${esc(x.label)}</button>`).join("")}</div>
        </div>
      </div>`;
    }).join("") : `<div class="card allclear"><div class="art">${icon("check")}</div><h3 style="font-size:15px">Queue is clear</h3><p class="muted" style="margin:6px auto 16px;max-width:360px;font-size:13px">Nothing is waiting for a person. Held invoices from your runs will appear here with what it takes to release them.</p><button class="btn primary" id="qrun">${icon("play")}Run all ${SAMPLES.length} samples</button></div>`;

    $("#qdone").innerHTML = reviewed.length ? `<div class="card"><div class="card-h"><h2>Recently resolved</h2><span class="sub">Audit trail of human decisions</span></div><div class="tbl" style="border:0;border-radius:0"><table><thead><tr><th>Resolved</th><th>Vendor</th><th>Invoice</th><th class="n">Amount</th><th>Was held for</th><th>Outcome</th><th>Note</th></tr></thead><tbody>${reviewed.map((r) => `<tr class="click" data-run="${r.id}"><td class="mono faint">${when(r.resolution.at)}</td><td>${esc(r.vendor ? r.vendor.name : "Unknown")}</td><td class="mono">${esc(r.invoice || "—")}</td><td class="n">${money(r.total, r.currency)}</td><td>${esc(REASON[r.decision.code] || r.decision.code)}</td><td>${pill(r.resolution.final, r.resolution.label)}</td><td class="muted">${esc(r.resolution.note || "—")}</td></tr>`).join("")}</tbody></table></div></div>` : "";

    $$("[data-act]").forEach((b) => b.addEventListener("click", () => resolve(b.dataset.run, b.dataset.act)));
    $$("[data-open]").forEach((b) => b.addEventListener("click", () => openRun(b.dataset.open)));
    $$("#qdone [data-run]").forEach((tr) => tr.addEventListener("click", () => openRun(tr.dataset.run)));
    const qr = $("#qrun"); if (qr) qr.addEventListener("click", () => { show("run"); $("#runall").click(); });
  }

  function focusQueueItem(id) {
    const el = $(`[data-q="${id}"]`); if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.boxShadow = "0 0 0 2px var(--accent)"; setTimeout(() => (el.style.boxShadow = ""), 1600);
    const t = $(`#note-${id}`); if (t) setTimeout(() => t.focus({ preventScroll: true }), 400);
  }

  function resolve(id, key) {
    const run = runs.find((r) => r.id === id); if (!run) return;
    const a = actionsFor(run), act = a.acts.find((x) => x.key === key);
    const note = ($(`#note-${id}`).value || "").trim();
    if (a.needNote && act.final === "Approved" && !note) { $(`#err-${id}`).hidden = false; $(`#note-${id}`).focus(); return; }
    const label = { partial: "Part-paid", verified: "Released after call", fraud: "Rejected: fraud", approve: "Approved after review", reject: "Rejected after review" }[key] || act.label;
    run.resolution = { key, final: act.final, label, note, at: new Date().toISOString(), by: "AP reviewer", payable: act.payable != null ? act.payable : act.final === "Approved" ? run.total : 0 };
    run.events.push({ at: run.resolution.at, text: `${label} by AP reviewer${note ? `: “${note}”` : ""}`, tone: act.final === "Approved" ? "ok" : "bad" });
    if (run.erp) { run.erp.decision = act.final.toUpperCase(); run.erp.payable_now = run.resolution.payable; run.erp.payment_block = act.final !== "Approved"; run.erp.reviewed_by = "AP reviewer"; }
    // a rejected invoice no longer counts toward duplicates or billed quantity
    if (act.final === "Rejected") { run.voided = run.entered; run.entered = null; }
    else if (run.entered) run.entered.status = key === "partial" ? "Approved (partial)" : "Approved";
    saveRuns();
    const el = $(`[data-q="${id}"]`);
    if (el) { el.style.height = el.offsetHeight + "px"; void el.offsetHeight; el.classList.add("leaving"); el.style.height = "0px"; }
    toast(`${run.vendor ? run.vendor.name : "Invoice"}: ${label.toLowerCase()}`, act.final === "Approved" ? "check" : "x");
    setTimeout(() => { renderQueue(); updateBadge(); renderSamples(); }, 460);
  }

  // ================================================================ dashboard
  let filter = "All", query = "";
  // when the history holds more than one currency, the dashboard shows one currency at a time
  let dashCur = "USD";
  const CUR_NAME = { USD: "US dollars ($)", INR: "Indian rupees (₹)", EUR: "Euros (€)", GBP: "Pounds (£)", CAD: "Canadian dollars", AUD: "Australian dollars", AED: "UAE dirhams", CHF: "Swiss francs" };
  const dashRuns = () => { const cs = curList(runs); if (!cs.includes(dashCur)) dashCur = cs[0] || "USD"; return cs.length > 1 ? runs.filter((r) => curOf(r) === dashCur) : runs; };
  const REASON = { OK: "Approved", DUPLICATE: "Duplicate", BANK_CHANGE: "Bank details changed", MATCH_EXCEPTION: "Qty or price exception", PO_INFERRED: "PO not quoted", NO_PO: "No PO", MISSING_FIELDS: "Missing fields", MATH: "Doesn't add up", VENDOR_UNKNOWN: "Unknown vendor", VENDOR_INACTIVE: "Inactive vendor", UNREADABLE: "Unreadable", NOT_INVOICE: "Not an invoice", READ_CONFLICT: "Readings disagree", APPROVAL_LIMIT: "Over approval limit", WRONG_BUYER: "Addressed to another company" };

  function dashActions() {
    $("#pactions").innerHTML = `<button class="btn sm" id="csv" ${runs.length ? "" : "disabled"}>${icon("download")}Export CSV</button><span id="clearwrap"><button class="btn sm ghost" id="clear" ${runs.length ? "" : "disabled"}>${icon("trash")}Clear history</button></span>`;
    $("#csv").addEventListener("click", exportCSV);
    $("#clear").addEventListener("click", () => {
      $("#clearwrap").innerHTML = `<span class="confirm">Clear ${runs.length} runs and the invoices they entered?<button class="btn xs danger" id="clearyes">Clear</button><button class="btn xs ghost" id="clearno">Cancel</button></span>`;
      $("#clearno").addEventListener("click", dashActions);
      $("#clearyes").addEventListener("click", () => { runs = []; saveRuns(); updateBadge(); renderSamples(); emptyDecision(); drawStages(); pipeHead(null); renderDash(); toast("History cleared. Duplicate checks start fresh.", "check"); });
    });
  }

  function renderDash() {
    dashActions();
    const cs = curList(runs);
    const RUNS = dashRuns();
    $("#curtabs").innerHTML = cs.length > 1 ? cs.map((c) => `<button aria-pressed="${c === dashCur}" data-cur="${c}">${CUR_NAME[c] || c}<span class="cnt">${runs.filter((r) => curOf(r) === c).length}</span></button>`).join("") : "";
    $$("[data-cur]").forEach((b) => b.addEventListener("click", () => { dashCur = b.dataset.cur; renderDash(); }));
    const n = RUNS.length;
    const by = (s) => RUNS.filter((r) => statusOf(r) === s);
    const sum = (arr, f) => arr.reduce((a, r) => a + (f(r) || 0), 0);
    const msum = (arr, f) => money(sum(arr, f), dashCur);   // this section's currency, even when the list is empty
    const ap = by("Approved"), ho = by("Hold"), rj = by("Rejected");
    // money approved = what will actually be paid (a part-paid invoice counts only its released part)
    const paid = (r) => (r.resolution ? r.resolution.payable : r.total);
    const touchless = RUNS.filter((r) => r.decision.status === "Approved").length;
    const times = RUNS.map((r) => r.ms).sort((a, b) => a - b);
    const med = times.length ? times[Math.floor(times.length / 2)] : 0;
    const kpi = (k, v, s, c, id) => `<div class="card kpi"><div class="k">${c ? `<span class="sw" style="background:var(--${c}-mark)"></span>` : ""}${k}</div><div class="v" id="${id}">${v}</div><div class="s">${s}</div></div>`;
    $("#kpis").innerHTML = [
      kpi("Invoices processed", "0", n ? `${msum(RUNS, (r) => r.total)} in total` : "none yet", null, "k-n"),
      kpi("Approved", "0", `${msum(ap, paid)} to pay`, "ok", "k-ap"),
      kpi("On hold", "0", `${msum(ho, (r) => r.total)} waiting`, "warn", "k-ho"),
      kpi("Rejected", "0", `${msum(rj, (r) => r.total)} not paid`, "bad", "k-rj"),
      kpi("Touchless rate", n ? "0%" : "—", "approved with no human step", null, "k-tl"),
      kpi("Median run time", n ? dur(med) : "—", "file in to decision out", null, "k-med"),
    ].join("");
    const int = (x) => Math.round(x).toLocaleString();
    countUp($("#k-n"), n, int); countUp($("#k-ap"), ap.length, int); countUp($("#k-ho"), ho.length, int); countUp($("#k-rj"), rj.length, int);
    if (n) countUp($("#k-tl"), (touchless / n) * 100, (x) => Math.round(x) + "%");

    // money by outcome: one stacked bar plus a legend that doubles as the table view
    // a part-paid invoice splits: released part is approved, disputed part counts as held
    // dollars and rupees are never added together, so each currency gets its own bar
    const tone = (k) => (k === "Approved" ? "ok" : k === "Hold" ? "warn" : "bad");
    const block = (c) => {
      const mine = (arr) => arr.filter((r) => curOf(r) === c);
      const m = [["Approved", sum(mine(ap), paid)], ["Hold", sum(mine(ho), (r) => r.total) + sum(mine(ap), (r) => r.total - paid(r))], ["Rejected", sum(mine(rj), (r) => r.total)]];
      const tot = m.reduce((a, x) => a + x[1], 0);
      return `<div class="stack ${tot ? "" : "empty"}">${tot ? m.filter((x) => x[1] > 0).map(([k, v]) => `<span style="flex-grow:0;background:var(--${tone(k)}-mark)" data-grow="${v / tot}" title="${STATUS_WORD[k]}: ${money(v, c)} (${Math.round((v / tot) * 100)}%)"></span>`).join("") : ""}</div>
      <div class="legend">${m.map(([k, v]) => `<div class="row"><span style="color:var(--${tone(k)})">${icon(STATUS_ICON[k])}</span><span>${STATUS_WORD[k]}</span><span class="c">${money(v, c)}</span><span class="p">${tot ? Math.round((v / tot) * 100) + "%" : "—"}</span></div>`).join("")}</div>`;
    };
    $("#moneysub").textContent = RUNS.length ? msum(RUNS, (r) => r.total) + " processed" : "";
    $("#fxnote").textContent = cs.length > 1 ? `Showing ${CUR_NAME[dashCur] || dashCur} invoices. Each currency has its own section, and amounts are never converted or added together.` : "";
    $("#moneybars").innerHTML = block(RUNS.length ? curOf(RUNS[0]) : "USD");
    requestAnimationFrame(() => $$("#moneybars [data-grow]").forEach((s) => (s.style.flexGrow = s.dataset.grow)));

    const counts = {};
    RUNS.filter((r) => r.decision.status !== "Approved").forEach((r) => { counts[r.decision.code] = (counts[r.decision.code] || 0) + 1; });
    const ent = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const mx = Math.max(1, ...ent.map((e) => e[1]));
    $("#reasons").innerHTML = ent.length
      ? `<div class="bars">${ent.map(([k, v]) => `<div class="bar" title="${esc(REASON[k] || k)}: ${v}"><span>${esc(REASON[k] || k)}</span><span class="track"><span class="fill" data-w="${(v / mx) * 100}"></span></span><span class="c">${v}</span></div>`).join("")}</div>`
      : `<p class="faint" style="margin:0;font-size:13px">Nothing has been held or rejected yet.</p>`;
    requestAnimationFrame(() => $$("#reasons [data-w]").forEach((s) => (s.style.width = s.dataset.w + "%")));

    const cnt = { All: n, Approved: ap.length, Hold: ho.length, Rejected: rj.length, Reviewed: RUNS.filter((r) => r.resolution).length };
    $("#filters").innerHTML = ["All", "Approved", "Hold", "Rejected", "Reviewed"].map((f) => `<button aria-pressed="${f === filter}" data-f="${f}">${f === "Hold" ? "On hold" : f}<span class="cnt">${cnt[f]}</span></button>`).join("");
    $$("[data-f]").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.f; renderDash(); }));
    $("#q").value = query;
    renderRunsTable();
  }
  $("#q").addEventListener("input", (e) => { query = e.target.value; renderRunsTable(); });

  function renderRunsTable() {
    const q = query.trim().toLowerCase();
    const list = dashRuns().filter((r) => (filter === "All" || (filter === "Reviewed" ? !!r.resolution : statusOf(r) === filter)))
      .filter((r) => !q || [r.vendor && r.vendor.name, r.printedVendor, r.invoice, REASON[r.decision.code], r.decision.owner, r.file].join(" ").toLowerCase().includes(q));
    if (!runs.length) {
      $("#runs").innerHTML = `<div class="empty"><div class="art">${icon("inbox")}</div><h3>No runs yet</h3><p>Each run you make shows up here with its outcome, reason and timing.</p><div style="margin-top:16px"><button class="btn primary" id="dashrun">${icon("play")}Run all ${SAMPLES.length} samples</button></div></div>`;
      $("#dashrun").addEventListener("click", () => { show("run"); $("#runall").click(); });
      return;
    }
    $("#runs").innerHTML = list.length ? `<div class="tbl" style="border:0;border-radius:0 0 12px 12px"><table><thead><tr><th>When</th><th>Vendor</th><th>Invoice</th><th class="n">Amount</th><th>Outcome</th><th>Reason</th><th>Owner</th><th class="n">Time</th></tr></thead><tbody>${list.map((r) => {
      const st = statusOf(r);
      return `<tr class="click" data-run="${r.id}" tabindex="0"><td class="mono faint" style="white-space:nowrap">${when(r.at)}</td>
      <td><b style="font-weight:500">${esc(r.vendor ? r.vendor.name : r.printedVendor || "Unknown")}</b></td><td class="mono">${esc(r.invoice || "—")}</td><td class="n">${money(r.total, r.currency)}</td>
      <td>${pill(st, r.resolution ? r.resolution.label : null)}</td>
      <td>${esc(REASON[r.decision.code] || r.decision.code)}</td><td class="muted">${esc(r.decision.owner)}</td><td class="n mono faint">${dur(r.ms)}</td></tr>`;
    }).join("")}</tbody></table></div>` : `<p class="faint" style="padding:20px 18px;margin:0;font-size:13px">No runs match this filter.</p>`;
    $$("#runs [data-run]").forEach((tr) => { tr.addEventListener("click", () => openRun(tr.dataset.run)); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") openRun(tr.dataset.run); }); });
  }

  function exportCSV() {
    const cols = ["run_id", "processed_at", "file", "vendor_id", "vendor", "invoice_number", "invoice_date", "po_number", "total", "currency", "decision", "reason_code", "owner", "payable_now", "reviewed", "review_note", "run_ms"];
    const q = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = runs.map((r) => [r.id, r.at, r.file, r.vendor && r.vendor.id, r.vendor ? r.vendor.name : r.printedVendor, r.invoice, r.erp && r.erp.invoice_date, r.erp && r.erp.po_number, r.total, r.currency || "USD", statusOf(r), r.decision.code, r.decision.owner, r.erp && r.erp.payable_now, r.resolution ? r.resolution.label : "", r.resolution ? r.resolution.note : "", r.ms].map(q).join(","));
    const csv = [cols.join(","), ...rows].join("\n");
    // inside claude.ai, files are saved through the viewer's "downloads" prompt
    if (downloads) {
      downloads.save({ filename: "invoice-runs.csv", data: csv })
        .then(() => toast("CSV saved", "download"))
        .catch((e) => toast(e && e.code === "declined" ? "Export cancelled" : "Export isn't available in this view", "info"));
      return;
    }
    // on a normal website, a plain browser download
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "invoice-runs.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("CSV exported", "download");
  }

  // ================================================================ reference data
  const POLICY_FIELDS = [["pricePct", "Unit price tolerance", 0.1, "%"], ["qtyPct", "Quantity tolerance", 1, "%"], ["freightAllowance", "Freight without a PO line", 1, "USD"], ["autoApproveLimit", "Auto-approval limit", 100, "USD"]];
  function renderRef() {
    $("#policy").innerHTML = POLICY_FIELDS.map(([k, l, st, u]) => `<label for="pol-${k}">${l}<span class="inputwrap"><input type="number" step="${st}" min="0" id="pol-${k}" data-k="${k}" value="${policy[k]}"><span>${u}</span></span></label>`).join("");
    $$("#policy input").forEach((i) => i.addEventListener("change", () => {
      const v = parseFloat(i.value); if (isNaN(v) || v < 0) { i.value = policy[i.dataset.k]; return; }
      policy[i.dataset.k] = v; store.set(KEY_POLICY, policy); toast("Policy saved. It applies from the next run.", "check");
    }));
    $("#vendors").innerHTML = `<table><thead><tr><th>ID</th><th>Vendor</th><th>Status</th><th>Email domain</th><th>Bank on file</th><th>Phone on file</th><th>Terms</th></tr></thead><tbody>${SEED.vendors.map((v) => `<tr><td class="mono">${v.id}</td><td><b style="font-weight:500">${esc(v.name)}</b></td><td>${v.status === "Active" ? `<span class="pill Approved">${icon("check")}Active</span>` : `<span class="pill neutral">Inactive</span>`}</td><td class="mono">${esc(v.domains.join(", "))}</td><td>${esc(v.bank.name)} <span class="mono faint">··${v.bank.last4}</span></td><td class="mono">${esc(v.phone)}</td><td>${esc(v.terms)}</td></tr>`).join("")}</tbody></table>`;
    const h = history();
    $("#pos").innerHTML = `<table><thead><tr><th>PO</th><th>Vendor</th><th>Line</th><th class="n">Ordered</th><th class="n">Price</th><th class="n">Received</th><th class="n">Billed</th><th>Requester</th></tr></thead><tbody>${SEED.pos.map((p) => p.lines.map((l, i) => {
      const rec = p.receiptRequired ? p.receipts.reduce((s, r) => s + (r.lines[l.ln] || 0), 0).toLocaleString() : "service";
      const billed = h.filter((x) => x.po === p.po).reduce((s, x) => s + ((x.lines || []).find((y) => y.ln === l.ln) || { qty: 0 }).qty, 0);
      return `<tr>${i === 0 ? `<td class="mono" style="white-space:nowrap" rowspan="${p.lines.length}">${p.po}<div class="ev">${p.date}</div></td><td rowspan="${p.lines.length}">${esc(SEED.vendors.find((v) => v.id === p.vendor).name)}</td>` : ""}<td>${esc(l.desc)}<div class="ev">${esc(l.sku)}</div></td><td class="n">${l.qty.toLocaleString()} ${esc(l.uom)}</td><td class="n">${l.price}</td><td class="n">${rec}</td><td class="n">${billed.toLocaleString()}</td>${i === 0 ? `<td rowspan="${p.lines.length}" class="muted">${esc(p.requester)}</td>` : ""}</tr>`;
    }).join("")).join("")}</tbody></table>`;
    $("#ledger").innerHTML = `<table><thead><tr><th>Vendor</th><th>Invoice</th><th>Date</th><th class="n">Amount</th><th>PO</th><th>Status</th><th>Payment</th></tr></thead><tbody>${h.map((x) => `<tr><td>${esc((SEED.vendors.find((v) => v.id === x.vendor) || { name: x.vendor || "?" }).name)}</td><td class="mono">${esc(x.invoice)}</td><td class="mono">${esc(x.date || "")}</td><td class="n">${money(x.amount, x.currency)}</td><td class="mono">${esc(x.po || "")}</td><td>${esc(x.status)}${x.runId ? ` <span class="ev" style="display:inline">${x.runId}</span>` : ""}</td><td class="mono faint">${esc(x.paidOn ? x.paidOn + " · " + x.payRef : "")}</td></tr>`).join("")}</tbody></table>`;
  }
  $("#policyreset").addEventListener("click", () => { policy = Object.assign({}, SEED.policy); store.set(KEY_POLICY, {}); renderRef(); toast("Policy restored to defaults", "check"); });

  // ================================================================ how it works
  const EDGE_WHY = [
    "The baseline, and it isn't a perfect match on purpose. Tape is billed 0.95% over the PO price (inside the 2% tolerance) and there's an $85 freight line that isn't on the PO (inside the $150 allowance). Real invoices are rarely exact.",
    "One PO split across invoices. On its own this invoice looks fine; only tracking what was billed before against what was ordered and received shows the over-bill. It releases $4,836 and disputes $1,184 rather than blocking everything.",
    "A “second notice” with the number reformatted (CFL 871 vs INV-0871). An exact-match duplicate check would pay it twice. Normalising the number catches it, and the drafted reply quotes the original ACH reference.",
    "Business email compromise. The invoice matches its PO perfectly, which is what makes it dangerous. A new account plus a lookalike domain blocks payment: call the number on file, never the one on the invoice.",
    "A scanned image with no PO number. OCR reads it, the process infers the one open PO that fits by lines and total, then holds for a one-click confirmation from the requester instead of guessing.",
    "A small designer-template invoice saved as a picture. The vendor, PO, prices and receipt all match, so a simple rules engine would approve it. But it is made out to “Studio Shodwe”, not to us, so it was probably sent in error. Reading the Billed to / From columns catches it and holds the invoice.",
  ];
  const EXPECT = [["Approved", "Approved, due 25 Nov"], ["Hold", "On hold, $4,836 payable now"], ["Rejected", "Rejected as duplicate"], ["Hold", "On hold, payment blocked"], ["Hold", "On hold for PO confirmation"], ["Hold", "On hold: not addressed to us"]];
  const RULES = [
    ["No text could be read", "Hold", "AP specialist"], ["Read fine, but not an invoice", "Rejected", "AP inbox triage"], ["Invoice, but no number and no total found", "Hold", "AP specialist"],
    ["Sender isn't an active vendor", "Rejected", "Procurement"], ["Duplicate of a paid or entered invoice", "Rejected", "AP specialist"],
    ["Bank account differs, or lookalike sender domain", "Hold", "AP lead + Treasury"], ["Invoice is addressed to another company", "Hold", "AP specialist"], ["Invoice number, date or total missing", "Hold", "Vendor"],
    ["Lines or totals don't add up", "Hold", "Vendor"], ["No PO, or PO inferred rather than quoted", "Hold", "Requester"],
    ["Price, quantity or receipt outside tolerance", "Hold", "AP + vendor"], ["The AI reader and the rules disagree on a key field", "Hold", "AP specialist"],
    ["Above the auto-approval limit", "Hold", "Controller"], ["Everything passes", "Approved", "Payment run"],
  ];
  function renderHow() {
    $("#edges").innerHTML = SAMPLES.map((s, i) => `<div class="card"><div style="display:flex;align-items:center;gap:10px"><span class="avatar av${i % 6}">${esc(initials(s.vendor))}</span><span><b style="display:block;font-size:13px">${esc(s.vendor)}</b><span class="tag ${s.kind}" style="margin-top:3px">${s.kind === "happy" ? "Happy path" : "Edge case " + i}</span></span></div><h3>${esc(s.label)}</h3><p>${esc(EDGE_WHY[i])}</p><div class="exp">${pill(EXPECT[i][0], EXPECT[i][1])}<button class="btn xs ghost" data-try="${i}" style="margin-left:auto">${icon("play")}Run it</button></div></div>`).join("");
    $$("[data-try]").forEach((b) => b.addEventListener("click", () => { show("run"); runSample(+b.dataset.try); }));
    $("#rules").innerHTML = `<table><thead><tr><th>#</th><th>Rule</th><th>Outcome</th><th>Who acts next</th></tr></thead><tbody>${RULES.map(([r, o, w], i) => `<tr><td class="mono faint">${i === RULES.length - 1 ? "—" : i + 1}</td><td>${esc(r)}</td><td>${pill(o)}</td><td class="muted">${esc(w)}</td></tr>`).join("")}</tbody></table>`;
  }

  // ================================================================ start
  $("#samplecount").textContent = SAMPLES.length + " samples";
  renderSamples();
  updateBadge();
  $("#opt-pace").addEventListener("change", () => { if (!busy) applyViewMode(!$("#opt-pace").checked); });
  drawStages();
  if (runs.length) openRun(runs[0].id); else { pipeHead(null); emptyDecision(); }
  moveNavInd(); enterView("run");
  // deep links: #dashboard, #exceptions, #reference, #how
  const initial = { dashboard: "dash", exceptions: "queue", reference: "ref", how: "how" }[location.hash.slice(1)];
  if (initial) show(initial);
})();
