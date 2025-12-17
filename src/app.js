import { auth, db, firebase } from "./firebase.js";
import { UI_ADMIN_EMAILS, DEFAULT_PAY_SETTINGS } from "./config.js";

const RANKS = [
  "Directeur",
  "Co-directeur",
  "Assistant Directeur",
  "Responsable",
  "Superviseur",
  "Officier III",
  "Officier II",
  "Officier I",
  "Opérateur III",
  "Opérateur II",
  "Opérateur I",
  "Novice",
  "Licencier"
];

const QUALIFICATIONS = [
  "Convoyeur",
  "Assistance",
  "Moto",
  "Equipement léger",
  "Equipement lourd",
  "Equipement convois",
  "Equipement sécurité",
  "Agent de sécurité",
  "SUSPENDU"
];

const STATUSES = ["Actif", "Suspendu", "Licencié"];

const el = (sel) => document.querySelector(sel);
const els = (sel) => [...document.querySelectorAll(sel)];

function toast(msg, kind="info"){
  const t = el("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  t.style.borderColor = kind === "error" ? "rgba(239,68,68,.55)" : "rgba(139,92,246,.55)";
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=>t.classList.add("hidden"), 3200);
}

function pad2(n){ return String(n).padStart(2,"0"); }
function dateToStr(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function strToDate(s){ const [y,m,dd]=s.split("-").map(Number); return new Date(y, m-1, dd); }
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }

function startOfWeek(d){
  const x = new Date(d);
  const day = (x.getDay()+6)%7; // Monday=0
  x.setDate(x.getDate()-day);
  x.setHours(0,0,0,0);
  return x;
}
function endOfWeek(d){
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(s.getDate()+6);
  return e;
}

function money(n){
  if (n == null || Number.isNaN(n)) return "—";
  return (Math.round(n)).toLocaleString("fr-FR") + " $";
}
function hoursFmt(h){
  const x = Number(h);
  if (!Number.isFinite(x)) return "0";
  return x.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

function num(v){ const x = Number(v); return Number.isFinite(x) ? x : 0; }

function escapeHtml(s=""){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

async function getPaySettings(){
  const ref = firebase.doc(db, "settings", "pay");
  const snap = await firebase.getDoc(ref);
  if (snap.exists()) return { ...DEFAULT_PAY_SETTINGS, ...snap.data() };
  return { ...DEFAULT_PAY_SETTINGS };
}
async function setPaySettings(settings){
  const ref = firebase.doc(db, "settings", "pay");
  await firebase.setDoc(ref, settings, { merge: true });
}

function computeWorkHours(totals){
  const hoursConvoy = num(totals.convoys) / 2;      // 2 convois = 1h
  const hoursSecurity = num(totals.securityChecks) / 7; // 7 contrôles = 1h
  const hoursEvent = num(totals.securedEvents) * 2; // 1 event = 2h
  const hoursTotal = hoursConvoy + hoursSecurity + hoursEvent;
  return { hoursConvoy, hoursSecurity, hoursEvent, hoursTotal };
}

function computePay({rank, totals, pay}){
  const hourRate = (pay.baseSalaries?.[rank] ?? 0) || 0; // $/heure selon le grade
  const { hoursConvoy, hoursSecurity, hoursEvent, hoursTotal } = computeWorkHours(totals);

  // Directeur / Co-directeur : fixe hebdo
  if (rank === "Directeur" || rank === "Co-directeur"){
    const fixed = pay.directorWeekly ?? 8500000;
    const perHour = hoursTotal > 0 ? fixed / hoursTotal : null;
    return {
      hourRate, base: fixed,
      convoyPay: 0, securityPay: 0, prime: 0, eventPay: 0,
      total: fixed,
      hoursConvoy, hoursSecurity, hoursEvent, hoursTotal,
      perHour, fixedWeekly: fixed
    };
  }

  // Convois / Sécurité / Events : conversion en heures, puis taux horaire du grade
  const convoyPayRaw = hoursConvoy * hourRate;
  const securityPayRaw = hoursSecurity * hourRate;
  const eventPayRaw = hoursEvent * hourRate; // pas de max

  const convoyPay = Math.min(convoyPayRaw, pay.convoyMax);
  const securityPay = Math.min(securityPayRaw, pay.securityMax);

  // Prime = convois + sécurité (max 8.5M par défaut)
  const prime = Math.min(convoyPay + securityPay, pay.primeMax);

  const eventPay = eventPayRaw;

  const total = prime + eventPay;

  const perHour = hoursTotal > 0 ? total / hoursTotal : null;

  return { hourRate, base: 0, convoyPay, securityPay, prime, eventPay, total, hoursConvoy, hoursSecurity, hoursEvent, hoursTotal, perHour };
}

function contractTemplate({name, birth, nationality, dateStr, rank}){
  // On garde ton texte quasi identique.
  return `CONTRAT À DURÉE INDÉTERMINÉE [CDI]

---

Entre les soussignés :
Bobcat Security, dont le siège social est situé au El Rancho Boulevard, Los Santos, représenté par Tyler Jax, en qualité de Directeur.

Et :
${name}, né(e) le ${birth}, demeurant à Los Santos, de nationalité ${nationality}.

---

ARTICLE 1 : POSTE ET ATTRIBUTION
L'Employeur engage l'Employé à compter au poste de ${rank || "novice"} au Bobcat Security du ${dateStr}, son poste pouvant évoluer en fonction de l'amélioration des compétences, de l'activité et du professionnalisme dont il fera preuve.

---

ARTICLE 2 : PÉRIODE D'ESSAI
L'Employeur engage l'Employé sous réserve d'une période d'essai d'une semaine, à compter du ${dateStr}, durant laquelle il pourra metre fin à sont contrat à tout moment sans préavis, ni indemnité.

---

ARTICLE 3 : RÉMUNÉRATION
L'Employé recevra une rémunération sous forme de prime pouvant aller jusqu'à la somme de 15 000,00 $ hebdomadaire.

---

ARTICLE 4 : DURÉE DU CONTRAT
Ce contrat est conclu pour une durée indéterminée et peut être modifié en fonction de l'évolution dans le service.

---

ARTICLE 5 : RÈGLEMENT DE L'ENTREPRISE
L'Employé s'engage à respecter le règlement intérieur de l'entreprise qui lui a été fourni dès son arrivée.

---

ARTICLE 6 : ENGAGEMENT
Sous réserve des résultats de la visite médicale d'embauche déterminant l'aptitude du futur employé au poste proposé, M./Mme ${name} est engagé par la société.

---

ARTICLE 7 : SIGNATURE
Fait à Los Santos, le ${dateStr}.

---

L'Employeur :
Tyler Jax

L'Employé :
${name}`;
}

function isUiAdmin(userEmail){
  return UI_ADMIN_EMAILS?.map(x=>x.toLowerCase()).includes((userEmail||"").toLowerCase());
}

/** ---------- State ---------- */
let state = {
  user: null,
  profile: null,
  pay: null,
  currentView: "dashboard",
  weekDate: new Date(),
  adminWeekDate: new Date(),
  // Mode admin: consulter un autre employé
  viewAsUid: null,
  viewAsName: null
};

/** ---------- DOM refs ---------- */
const authView = el("#authView");
const appView = el("#appView");
const viewRoot = el("#viewRoot");
const viewTitle = el("#viewTitle");
const viewSubtitle = el("#viewSubtitle");
const nav = el("#nav");
const me = el("#me");
const weekDateInput = el("#weekDate");
const btnThisWeek = el("#btnThisWeek");
const btnSignOut = el("#btnSignOut");

// Semaine verrouillée : on travaille uniquement sur la semaine en cours
weekDateInput.disabled = true;


function setActiveNav(view){
  els(".navbtn[data-view]").forEach(b=>{
    b.classList.toggle("active", b.dataset.view === view);
  });
}

/** ---------- Auth ---------- */
el("#loginForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const email = String(fd.get("email")||"").trim();
  const password = String(fd.get("password")||"");
  try{
    await firebase.signInWithEmailAndPassword(auth, email, password);
  }catch(err){
    toast(err?.message || "Erreur de connexion", "error");
  }
});

el("#signupForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const invite = normalizeInviteCode(fd.get("invite"));
  const email = String(fd.get("email")||"").trim();
  const password = String(fd.get("password")||"");
  if (!invite) return toast("Code d’invitation requis.", "error");
  try{
    // On crée d'abord le compte Auth (puis on rattache via l'invitation).
    // Cela permet de fonctionner même si tes règles Firestore bloquent les lectures quand on est déconnecté.
    const cred = await firebase.createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;

    // Token refresh: évite un cas rare où la 1ère écriture Firestore est refusée juste après la création du compte
    await cred.user.getIdToken(true);

    // Crée le profil employé + verrouille le code
    await createEmployeeProfileFromInvite(uid, email, invite);

    toast("Compte créé ✅");
  }catch(err){
    // Si Auth a réussi mais Firestore a échoué, on supprime l'utilisateur fraîchement créé pour éviter un "compte orphelin"
    try{ await auth.currentUser?.delete(); }catch(_e){}
    toast(err?.message || "Erreur de création", "error");
  }
});

function normalizeInviteCode(v){
  return String(v||"")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

async function resolveInviteRef(inviteCode){
  // 1) Format standard : le code est l'ID du document
  const directRef = firebase.doc(db, "invites", inviteCode);
  try{
    const snap = await firebase.getDoc(directRef);
    if (snap.exists()) return { ref: directRef, data: snap.data() };
  }catch(_e){
    // ignore : on tentera la recherche par champ "code"
  }

  // 2) Compat : anciens formats où l'ID est auto et le code est stocké dans un champ "code"
  const col = firebase.collection(db, "invites");
  const q = firebase.query(col, firebase.where("code", "==", inviteCode), firebase.limit(1));
  const qs = await firebase.getDocs(q);
  if (!qs.empty){
    const d = qs.docs[0];
    return { ref: d.ref, data: d.data() };
  }
  return null;
}

/** ---------- Profil via invitation (utilisé à l'inscription + réparation) ---------- */
async function createEmployeeProfileFromInvite(uid, email, inviteCode){
  const code = normalizeInviteCode(inviteCode);
  const resolved = await resolveInviteRef(code);
  if (!resolved) throw new Error("Code d’invitation invalide.");
  const inviteRef = resolved.ref;

  await firebase.runTransaction(db, async (tx)=>{
    const inv = await tx.get(inviteRef);
    if (!inv.exists()) throw new Error("Code invalide.");
    const invData = inv.data();
    if (invData.usedBy) throw new Error("Code déjà utilisé.");

    const empRef = firebase.doc(db, "employees", uid);
    tx.set(empRef, {
      email,
      name: invData.name || "",
      birth: invData.birth || "",
      nationality: invData.nationality || "américaine / mexicaine",
      rank: invData.rank || "Novice",
      status: invData.status || "Actif",
      qualifications: invData.qualifications || [],
      joinDate: invData.joinDate || dateToStr(new Date()),
      isAdmin: false,
      createdAt: firebase.serverTimestamp(),
      updatedAt: firebase.serverTimestamp()
    }, { merge: true });

    tx.update(inviteRef, {
      usedBy: uid,
      usedEmail: (auth.currentUser?.email || email),
      usedAt: firebase.serverTimestamp()
    });
  });
}


btnSignOut.addEventListener("click", async ()=>{
  await firebase.signOut(auth);
});

/** ---------- Navigation ---------- */
els(".navbtn[data-view]").forEach(b=>{
  b.addEventListener("click", ()=>{
    const v = b.dataset.view;
    state.currentView = v;
    render();
  });
});

btnThisWeek.addEventListener("click", ()=>{
  state.weekDate = new Date();
  weekDateInput.value = dateToStr(state.weekDate);
  render();
});

weekDateInput.addEventListener("change", ()=>{
  // Semaine verrouillée: seule la semaine en cours est modifiable.
  weekDateInput.value = dateToStr(state.weekDate);
});

/** ---------- Load profile ---------- */
async function loadProfile(uid){
  const ref = firebase.doc(db, "employees", uid);
  const snap = await firebase.getDoc(ref);
  if (!snap.exists()) return null;
  return { uid, ...snap.data() };
}

function enforceAdminUI(){
  const allow = !!state.profile?.isAdmin || isUiAdmin(state.user?.email);
  els(".adminOnly").forEach(x=>x.classList.toggle("hidden", !allow));
}

/** ---------- Work days ---------- */
async function loadWeekDays(uid, startStr, endStr){
  const col = firebase.collection(db, "employees", uid, "workDays");
  const q = firebase.query(
    col,
    firebase.orderBy(firebase.documentId()),
    firebase.startAt(startStr),
    firebase.endAt(endStr)
  );
  const snap = await firebase.getDocs(q);
  const map = new Map();
  snap.forEach(docSnap=>{
    map.set(docSnap.id, docSnap.data());
  });
  return map;
}

async function saveDay(uid, dateStr, data){
  // Sécurité : on interdit la saisie hors de la semaine courante
  const cw = currentWeekStartStr();
  const ds = strToDate(dateStr);
  const w = dateToStr(startOfWeek(ds));
  if (w !== cw){
    throw new Error("Saisie autorisée uniquement pour la semaine en cours.");
  }

  const ref = firebase.doc(db, "employees", uid, "workDays", dateStr);
  await firebase.setDoc(ref, {
    convoys: num(data.convoys),
    securityChecks: num(data.securityChecks),
    securedEvents: num(data.securedEvents),
    updatedAt: firebase.serverTimestamp()
  }, { merge: true });
}

function computeTotals(daysMap){
  let totals = { convoys:0, securityChecks:0, securedEvents:0 };
  for (const [,v] of daysMap.entries()){
    totals.convoys += num(v.convoys);
    totals.securityChecks += num(v.securityChecks);
    totals.securedEvents += num(v.securedEvents);
  }
  return totals;
}

function currentWeekStartStr(){
  return dateToStr(startOfWeek(new Date()));
}

function isCurrentWeekSelected(){
  return dateToStr(startOfWeek(state.weekDate)) === currentWeekStartStr();
}

async function upsertPublicWeek(uid, profile, totals, weekStartStr){
  try{
    const { hoursConvoy, hoursSecurity, hoursEvent, hoursTotal } = computeWorkHours(totals);
    const score = hoursTotal;
    const ref = firebase.doc(db, "weeks", weekStartStr, "public", uid);
    await firebase.setDoc(ref, {
      uid,
      name: profile?.name || "—",
      rank: profile?.rank || "—",
      status: profile?.status || "—",
      convoys: num(totals.convoys),
      securityChecks: num(totals.securityChecks),
      securedEvents: num(totals.securedEvents),
      hoursConvoy,
      hoursSecurity,
      hoursEvent,
      hoursTotal,
      score,
      updatedAt: firebase.serverTimestamp()
    }, { merge: true });
  }catch(_e){
    // Non bloquant
  }
}

async function loadTop3(weekStartStr){
  try{
    const col = firebase.collection(db, "weeks", weekStartStr, "public");
    const q = firebase.query(col, firebase.orderBy("score","desc"), firebase.limit(3));
    const snap = await firebase.getDocs(q);
    const list = [];
    snap.forEach(d=>list.push({uid:d.id, ...d.data()}));
    return list;
  }catch(_e){
    return [];
  }
}

function renderViewAsBar(){
  if (!state.profile?.isAdmin || !state.viewAsUid) return "";
  const name = state.viewAsName ? escapeHtml(state.viewAsName) : escapeHtml(state.viewAsUid);
  return `
    <div class="viewAsBar noPrint">
      <div>Mode admin : consultation de <b>${name}</b></div>
      <div style="display:flex; gap:8px">
        <button id="btnExitViewAs">Retour à moi</button>
      </div>
    </div>
  `;
}

/** ---------- Views ---------- */
async function renderDashboard(forUid=null){
  const uid = forUid || state.user.uid;
  const profile = forUid ? await loadProfile(uid) : state.profile;

  const isAdminViewing = state.profile?.isAdmin && !!forUid;
  // Employés : semaine en cours uniquement. Admin (consultation d’un autre employé) : navigation semaines (lecture).
  if (!isAdminViewing){ state.weekDate = new Date(); }
  if (!state.weekDate){ state.weekDate = new Date(); }
  const s = startOfWeek(state.weekDate);
  const e = endOfWeek(state.weekDate);

  const startStr = dateToStr(s);
  const endStr = dateToStr(e);

  const weekNavHtml = isAdminViewing ? `
    <section class="card">
      <div class="row">
        <div>
          <h2>Navigation semaines</h2>
          <div class="muted">Consultation des anciennes semaines (lecture seule).</div>
        </div>
        <div class="row" style="gap:8px; flex-wrap:wrap; justify-content:flex-end">
          <button class="btn" id="dashPrevWeek">← Semaine -1</button>
          <button class="btn" id="dashThisWeek">Semaine actuelle</button>
          <button class="btn" id="dashNextWeek">Semaine +1 →</button>
          <label class="muted" style="display:flex; align-items:center; gap:8px">
            <span>Date</span>
            <input type="date" id="dashWeekPick" value="${startStr}" />
          </label>
        </div>
      </div>
      <div class="muted">Semaine du <b>${startStr}</b> au <b>${endStr}</b></div>
    </section>
  ` : ``;


  const days = await loadWeekDays(uid, startStr, endStr);
  const totals = computeTotals(days);
  const payResult = computePay({ rank: profile.rank, totals, pay: state.pay });

  const rows = [];
  for (let i=0;i<7;i++){
    const d = new Date(s);
    d.setDate(s.getDate()+i);
    const ds = dateToStr(d);
    const data = days.get(ds) || { convoys:0, securityChecks:0, securedEvents:0 };
    rows.push({ ds, label: d.toLocaleDateString("fr-FR",{weekday:"long", day:"2-digit", month:"2-digit"}), data });
  }

  const isCurrentWeek = startStr === currentWeekStartStr();
  const canEdit = (uid === state.user.uid) && isCurrentWeek;

  viewRoot.innerHTML = `
    ${renderViewAsBar()}
    ${weekNavHtml}
    <section class="card">
      <div class="row">
        <div class="pills">
          <span class="pill neutral">Grade: <b>${escapeHtml(profile.rank)}</b></span>
          <span class="pill ${profile.status==="Actif"?"good":(profile.status==="Suspendu"?"bad":"bad")}">Statut: <b>${escapeHtml(profile.status)}</b></span>
        </div>
        <div class="pills">
          ${(profile.qualifications||[]).map(q=>`<span class="pill">${escapeHtml(q)}</span>`).join("") || `<span class="pill">Aucune qualification</span>`}
        </div>
      </div>

      <hr class="sep" />

      <div class="panel" id="top3Panel"></div>

      <div class="kpis">
        <div class="kpi"><div class="label">Convois (hebdo)</div><div class="value">${totals.convoys}</div><div class="sub">Heures = convois / 2 → <b>${hoursFmt(payResult.hoursConvoy)}</b> h</div></div>
        <div class="kpi"><div class="label">Contrôles sécurité (hebdo)</div><div class="value">${totals.securityChecks}</div><div class="sub">Heures = contrôles / 7 → <b>${hoursFmt(payResult.hoursSecurity)}</b> h • Plafond: ${money(state.pay.securityMax)}</div></div>
        <div class="kpi"><div class="label">Évènements sécurisés (hebdo)</div><div class="value">${totals.securedEvents}</div><div class="sub">Heures = events × 2 → <b>${hoursFmt(payResult.hoursEvent)}</b> h • Pas de max</div></div>
        <div class="kpi"><div class="label">Total estimé</div><div class="value">${money(payResult.total)}</div><div class="sub">Total heures: <b>${hoursFmt(payResult.hoursTotal)}</b> h • Rapport: <b>${payResult.perHour ? money(payResult.perHour) + "/h" : "—"}</b></div></div>
      </div>
    </section>

    <section class="card">
      <h2>Saisie par jour</h2>
      <table class="table">
        <thead>
          <tr>
            <th>Jour</th>
            <th style="width:160px">Convois</th>
            <th style="width:220px">Contrôles sécurité</th>
            <th style="width:220px">Évènements sécurisés</th>
            <th style="width:170px"></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r=>`
            <tr data-date="${r.ds}">
              <td><b>${escapeHtml(r.label)}</b><div class="muted" style="font-family:var(--mono);font-size:12px">${r.ds}</div></td>
              <td><input inputmode="numeric" class="inConvoys" ${!canEdit?"disabled":""} value="${num(r.data.convoys)}" /></td>
              <td><input inputmode="numeric" class="inSec" ${!canEdit?"disabled":""} value="${num(r.data.securityChecks)}" /></td>
              <td><input inputmode="numeric" class="inEvt" ${!canEdit?"disabled":""} value="${num(r.data.securedEvents)}" /></td>
              <td><button class="primary btnSaveDay">Enregistrer</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <p class="hint">Astuce : enregistre après chaque journée. Les totaux hebdo se recalculent automatiquement.</p>
    </section>

    <section class="card">
      <h2>Récap hebdomadaire (paie)</h2>

      <div class="kpis">
        <div class="kpi"><div class="label">Salaire de base</div><div class="value">${money(payResult.base)}</div><div class="sub">Selon grade</div></div>
        <div class="kpi"><div class="label">Salaire convois</div><div class="value">${money(payResult.convoyPay)}</div><div class="sub">Max ${money(state.pay.convoyMax)}</div></div>
        <div class="kpi"><div class="label">Salaire sécurité</div><div class="value">${money(payResult.securityPay)}</div><div class="sub">Max ${money(state.pay.securityMax)}</div></div>
        <div class="kpi"><div class="label">Salaire évènements</div><div class="value">${money(payResult.eventPay)}</div><div class="sub">Pas de max</div></div>
      </div>

      <hr class="sep" />

      <div class="row">
        <div class="panel" style="flex:1">
          <h2>Détails</h2>
          <div class="muted">Prime max (convois + sécurité) : <b>${money(state.pay.primeMax)}</b></div>
          <div class="muted">Prime réelle : <b>${money(payResult.prime)}</b></div>
          <div class="muted">Total estimé : <b>${money(payResult.total)}</b></div>
          <div class="muted">Heures : <b>${hoursFmt(payResult.hoursTotal)}</b> h • Rapport : <b>${payResult.perHour ? money(payResult.perHour)+"/h" : "—"}</b></div>
        </div>

        <div class="panel" style="flex:1">
          <h2>Actions</h2>
          <button class="primary" id="btnOpenPayroll">Ouvrir bulletin (imprimable)</button>
          <button id="btnOpenContract">Ouvrir contrat CDI</button>
          <p class="hint">Le bulletin / contrat sont imprimables (Ctrl+P) en PDF.</p>
        </div>
      </div>
    </section>
  `;

  if (isAdminViewing){
    const pick = viewRoot.querySelector("#dashWeekPick");
    const prev = viewRoot.querySelector("#dashPrevWeek");
    const next = viewRoot.querySelector("#dashNextWeek");
    const today = viewRoot.querySelector("#dashThisWeek");

    const rerender = ()=>{ state.currentView = "dashboard"; route(); };

    pick?.addEventListener("change", (e)=>{
      const v = e.target.value;
      if (v){ state.weekDate = strToDate(v); rerender(); }
    });
    prev?.addEventListener("click", ()=>{ state.weekDate = addDays(state.weekDate || new Date(), -7); rerender(); });
    next?.addEventListener("click", ()=>{ state.weekDate = addDays(state.weekDate || new Date(), 7); rerender(); });
    today?.addEventListener("click", ()=>{ state.weekDate = new Date(); rerender(); });
  }


// Top 3 de la semaine (visible à tous)
const weekStartStr = dateToStr(s);
const top3 = await loadTop3(weekStartStr);
const topHtml = top3.length ? `
  <h3 style="margin-top:0">🏆 Top 3 de la semaine</h3>
  <ol style="margin:8px 0 0 18px">
    ${top3.map(x=>`
      <li>
        <b>${escapeHtml(x.name||"—")}</b>
        <span class="muted">• Convois: ${num(x.convoys)} • Sécurité: ${num(x.securityChecks)} • Events: ${num(x.securedEvents)} • Heures: ${hoursFmt(x.hoursTotal || 0)} h</span>
      </li>
    `).join("")}
  </ol>
` : `<h3 style="margin-top:0">🏆 Top 3 de la semaine</h3><p class="muted">Aucune donnée cette semaine (encore).</p>`;

const topPanel = el("#top3Panel");
if (topPanel) topPanel.innerHTML = topHtml;

// Mise à jour du tableau public (leaderboard)
await upsertPublicWeek(uid, profile, totals, weekStartStr);

  // bind save buttons
  viewRoot.querySelectorAll(".btnSaveDay").forEach(btn=>{
    btn.addEventListener("click", async (e)=>{
      const tr = e.currentTarget.closest("tr");
      const ds = tr.dataset.date;
      const convoys = tr.querySelector(".inConvoys").value;
      const securityChecks = tr.querySelector(".inSec").value;
      const securedEvents = tr.querySelector(".inEvt").value;

      try{
        await saveDay(uid, ds, { convoys, securityChecks, securedEvents });
        toast(`Enregistré: ${ds} ✅`);
        render(); // refresh totals
      }catch(err){
        toast(err?.message || "Erreur d'enregistrement", "error");
      }
    });
  });

  el("#btnOpenPayroll").addEventListener("click", ()=>{ state.currentView="payroll"; render(); });
  el("#btnOpenContract").addEventListener("click", ()=>{ state.currentView="contract"; render(); });
}

async function renderPayroll(forUid=null){
  const uid = forUid || state.user.uid;
  const profile = forUid ? await loadProfile(uid) : state.profile;

  const isAdminViewing = state.profile?.isAdmin && !!forUid;
  if (!isAdminViewing){ state.weekDate = new Date(); }
  if (!state.weekDate){ state.weekDate = new Date(); }

  const s = startOfWeek(state.weekDate);
  const e = endOfWeek(state.weekDate);
  const startStr = dateToStr(s);
  const endStr = dateToStr(e);

  const weekNavHtml = isAdminViewing ? `
    <section class="card">
      <div class="row">
        <div>
          <h2>Navigation semaines</h2>
          <div class="muted">Consultation des anciennes semaines (lecture seule).</div>
        </div>
        <div class="row" style="gap:8px; flex-wrap:wrap; justify-content:flex-end">
          <button class="btn" id="payPrevWeek">← Semaine -1</button>
          <button class="btn" id="payThisWeek">Semaine actuelle</button>
          <button class="btn" id="payNextWeek">Semaine +1 →</button>
          <label class="muted" style="display:flex; align-items:center; gap:8px">
            <span>Date</span>
            <input type="date" id="payWeekPick" value="${startStr}" />
          </label>
        </div>
      </div>
      <div class="muted">Semaine du <b>${startStr}</b> au <b>${endStr}</b></div>
    </section>
  ` : ``;

  const days = await loadWeekDays(uid, startStr, endStr);
  const totals = computeTotals(days);
  const payResult = computePay({ rank: profile.rank, totals, pay: state.pay });

  viewRoot.innerHTML = `
    ${renderViewAsBar()}
    ${weekNavHtml}
    <section class="card">
      <div class="row">
        <div>
          <h2>Bulletin de paie</h2>
          <div class="muted">Semaine du <b>${startStr}</b> au <b>${endStr}</b></div>
        </div>
        <div class="noPrint">
          <button class="primary" onclick="window.print()">Imprimer / PDF</button>
        </div>
      </div>

      <hr class="sep" />

      <div class="panel">
        <div class="row">
          <div>
            <div><b>Employé :</b> ${escapeHtml(profile.name || "—")}</div>
            <div class="muted"><b>Email :</b> ${escapeHtml(profile.email || "—")} • <b>UID :</b> <span style="font-family:var(--mono)">${escapeHtml(profile.uid || uid)}</span></div>
          </div>
          <div class="pills">
            <span class="pill neutral">Grade: <b>${escapeHtml(profile.rank)}</b></span>
            <span class="pill neutral">Taux grade $/h : <b>${money((state.pay.baseSalaries?.[profile.rank] ?? 0) || 0)}</b></span>
            <span class="pill ${profile.status==="Actif"?"good":"bad"}">Statut: <b>${escapeHtml(profile.status)}</b></span>
          </div>
        </div>
      </div>

      <div style="height:10px"></div>

      <table class="table">
        <thead>
          <tr>
            <th>Rubrique</th>
            <th>Détail</th>
            <th style="text-align:right">Montant</th>
          </tr>
        </thead>
        <tbody>
          ${(profile.rank==="Directeur"||profile.rank==="Co-directeur") ? `
            <tr><td><b>Salaire fixe hebdo</b></td><td>${escapeHtml(profile.rank)} (fixe)</td><td style="text-align:right">${money(payResult.base)}</td></tr>
            <tr><td><b>Total heures (activité)</b></td><td>Convois/2 + Sécurité/7 + Events×2</td><td style="text-align:right">${hoursFmt(payResult.hoursTotal)} h</td></tr>
            <tr><td><b>Rapport $/heure</b></td><td>Fixe / heures</td><td style="text-align:right"><b>${payResult.perHour ? money(payResult.perHour)+"/h" : "—"}</b></td></tr>
            <tr><td><b>TOTAL À PAYER</b></td><td></td><td style="text-align:right"><b>${money(payResult.total)}</b></td></tr>
          ` : `
            <tr><td><b>Convois</b></td><td>${totals.convoys} convois → ${hoursFmt(payResult.hoursConvoy)} h (÷2) × ${money(payResult.hourRate)}/h (max ${money(state.pay.convoyMax)})</td><td style="text-align:right">${money(payResult.convoyPay)}</td></tr>
            <tr><td><b>Sécurité</b></td><td>${totals.securityChecks} contrôles → ${hoursFmt(payResult.hoursSecurity)} h (÷7) × ${money(payResult.hourRate)}/h (max ${money(state.pay.securityMax)})</td><td style="text-align:right">${money(payResult.securityPay)}</td></tr>
            <tr><td><b>Prime (Convois + Sécurité)</b></td><td>Max ${money(state.pay.primeMax)}</td><td style="text-align:right">${money(payResult.prime)}</td></tr>
            <tr><td><b>Évènements</b></td><td>${totals.securedEvents} events → ${hoursFmt(payResult.hoursEvent)} h (×2) × ${money(payResult.hourRate)}/h (pas de max)</td><td style="text-align:right">${money(payResult.eventPay)}</td></tr>
            <tr><td><b>Total heures</b></td><td>Convois/2 + Sécurité/7 + Events×2</td><td style="text-align:right">${hoursFmt(payResult.hoursTotal)} h</td></tr>
            <tr><td><b>Rapport $/heure</b></td><td>Total / heures</td><td style="text-align:right"><b>${payResult.perHour ? money(payResult.perHour)+"/h" : "—"}</b></td></tr>
            <tr><td><b>TOTAL À PAYER</b></td><td></td><td style="text-align:right"><b>${money(payResult.total)}</b></td></tr>
          `}
        </tbody>
      </table>

      <p class="hint">Note : les montants sont calculés automatiquement selon le grade ($/h), les plafonds, et les règles : convois ÷ 2 • sécurité ÷ 7 • évènements × 2.</p>
    </section>
  `;

  if (isAdminViewing){
    const pick = viewRoot.querySelector("#payWeekPick");
    const prev = viewRoot.querySelector("#payPrevWeek");
    const next = viewRoot.querySelector("#payNextWeek");
    const today = viewRoot.querySelector("#payThisWeek");

    const rerender = ()=>{ state.currentView = "payroll"; route(); };

    pick?.addEventListener("change", (e)=>{ const v = e.target.value; if (v){ state.weekDate = strToDate(v); rerender(); }});
    prev?.addEventListener("click", ()=>{ state.weekDate = addDays(state.weekDate || new Date(), -7); rerender(); });
    next?.addEventListener("click", ()=>{ state.weekDate = addDays(state.weekDate || new Date(), 7); rerender(); });
    today?.addEventListener("click", ()=>{ state.weekDate = new Date(); rerender(); });
  }

}

async function renderContract(forUid=null){
  const uid = forUid || state.user.uid;
  const profile = forUid ? await loadProfile(uid) : state.profile;

  const weekNavHtml = ``;

  const today = dateToStr(new Date());
  const autoTpl = contractTemplate({
    name: profile.name || "$Name",
    birth: profile.birth || "$Birth",
    nationality: profile.nationality || "américaine / mexicaine",
    dateStr: today,
    rank: profile.rank || "novice"
  });

  const stored = (typeof profile.contractText === "string" && profile.contractText.trim().length) ? profile.contractText : null;
  const tpl = stored || autoTpl;

  const canEdit = !!state.profile?.isAdmin; // 🔒 seul admin peut modifier les contrats (même le sien)

  viewRoot.innerHTML = `
    ${renderViewAsBar()}
    ${weekNavHtml}
    <section class="card">
      <div class="row">
        <div>
          <h2>Contrat CDI</h2>
          <div class="muted">Employé : <b>${escapeHtml(profile.name || "—")}</b> • Généré le <b>${today}</b>${stored ? " • <b>Version admin</b>" : ""}</div>
        </div>
        <div class="noPrint">
          <button class="primary" onclick="window.print()">Imprimer / PDF</button>
        </div>
      </div>

      <hr class="sep" />

      <div class="contractWrap">
        <article class="contractPaper" aria-label="Contrat CDI">
          <pre id="contractDoc" class="contractDoc" aria-readonly="true"></pre>
        </article>
      </div>

      <div class="row noPrint" style="margin-top:10px">
        <button id="btnCopyContract">Copier</button>
        ${canEdit ? `<button id="btnToggleContractEdit">Éditer (admin)</button>` : ``}
      </div>

      ${canEdit ? `
        <div class="panel noPrint hidden" id="contractEditPanel" style="margin-top:12px">
          <div class="row">
            <div>
              <h2 style="margin:0">Édition admin</h2>
              <div class="muted">Ici tu peux personnaliser le contrat (stocké en base pour cet employé).</div>
            </div>
            <div>
              <button id="btnCloseContractEdit">Fermer</button>
            </div>
          </div>

          <label>Contrat (admin)
            <textarea id="contractEditor" class="contractEditor" spellcheck="false"></textarea>
          </label>

          <div class="row" style="margin-top:8px">
            <button class="primary" id="btnSaveContract">Enregistrer</button>
            <button id="btnResetContract">Revenir au contrat auto</button>
          </div>
        </div>
      ` : ``}
    </section>
  `;

  const docEl = el("#contractDoc");
  docEl.textContent = tpl;

  el("#btnCopyContract").addEventListener("click", async ()=>{
    await navigator.clipboard.writeText(docEl.textContent || "");
    toast("Contrat copié ✅");
  });

  if (canEdit){
    const panel = el("#contractEditPanel");
    const editor = el("#contractEditor");
    const open = ()=>{ panel.classList.remove("hidden"); editor.value = docEl.textContent || ""; editor.focus(); };
    const close = ()=> panel.classList.add("hidden");

    el("#btnToggleContractEdit").addEventListener("click", open);
    el("#btnCloseContractEdit").addEventListener("click", close);

    el("#btnSaveContract").addEventListener("click", async ()=>{
      const text = String(editor.value || "").trim();
      try{
        const ref = firebase.doc(db, "employees", uid);
        await firebase.updateDoc(ref, { contractText: text, contractUpdatedAt: firebase.serverTimestamp() });
        docEl.textContent = text || autoTpl;
        toast("Contrat sauvegardé ✅");
        close();
      }catch(err){
        toast(err?.message || "Erreur sauvegarde contrat", "error");
      }
    });

    el("#btnResetContract").addEventListener("click", async ()=>{
      try{
        const ref = firebase.doc(db, "employees", uid);
        await firebase.updateDoc(ref, { contractText: firebase.deleteField(), contractUpdatedAt: firebase.serverTimestamp() });
        docEl.textContent = autoTpl;
        editor.value = autoTpl;
        toast("Contrat réinitialisé ✅");
      }catch(err){
        toast(err?.message || "Erreur reset contrat", "error");
      }
    });
  }
}

async function renderAdmin(){
  if (!state.profile?.isAdmin){
    viewRoot.innerHTML = `<section class="card"><h2>Accès refusé</h2><p class="muted">Tu n'es pas admin.</p></section>`;
    return;
  }

  // load employees
  const employeesCol = firebase.collection(db, "employees");
  const q = firebase.query(employeesCol, firebase.orderBy("name"));
  const snap = await firebase.getDocs(q);

  const employees = [];
  snap.forEach(d=>employees.push({ uid: d.id, ...d.data() }));

  // Semaine sélectionnée (admin) — navigable
  const wd = state.adminWeekDate || new Date();
  const wsDate = startOfWeek(wd);
  const weDate = endOfWeek(wd);
  const weekStartStr = dateToStr(wsDate);
  const weekEndStr = dateToStr(weDate);
  const weekStats = new Map();
  await Promise.all(employees.map(async (emp)=>{
    // 1) Essayez de lire le résumé (si l’employé l’a déjà généré)
    try{
      const ref = firebase.doc(db, "weeks", weekStartStr, "public", emp.uid);
      const s = await firebase.getDoc(ref);
      if (s.exists()){
        weekStats.set(emp.uid, s.data());
        return;
      }
    }catch(_e){ /* ignore */ }

    // 2) Fallback : recalcul à partir des workDays (permet de consulter les anciennes semaines)
    try{
      const days = await loadWeekDays(emp.uid, weekStartStr, weekEndStr);
      const totals = computeTotals(days);
      await upsertPublicWeek(emp.uid, emp, totals, weekStartStr);
      const { hoursTotal } = computeWorkHours(totals);
      weekStats.set(emp.uid, {
        uid: emp.uid,
        name: emp.name || "—",
        rank: emp.rank || "—",
        status: emp.status || "—",
        convoys: num(totals.convoys),
        securityChecks: num(totals.securityChecks),
        securedEvents: num(totals.securedEvents),
        score: hoursTotal
      });
    }catch(_e2){
      weekStats.set(emp.uid, { convoys:0, securityChecks:0, securedEvents:0, score:0 });
    }
  }));

  const rowsData = employees.map(emp=>{
    const ws = weekStats.get(emp.uid) || { convoys:0, securityChecks:0, securedEvents:0 };
    const totals = { convoys:num(ws.convoys), securityChecks:num(ws.securityChecks), securedEvents:num(ws.securedEvents) };
    let pr = computePay({ rank: emp.rank || "—", totals, pay: state.pay });

    const payable = (emp.status || "Actif") === "Actif";
    if (!payable){
      pr = { ...pr, convoyPay:0, securityPay:0, prime:0, eventPay:0, total:0, fixedWeekly:0 };
    }
    return { emp, ws, totals, pr, payable };
  });

  const totalToPay = rowsData.reduce((a,r)=> a + (r.payable ? num(r.pr.total) : 0), 0);
  const totalPrime = rowsData.reduce((a,r)=> a + (r.payable ? num(r.pr.prime||0) : 0), 0);
  const totalEvents = rowsData.reduce((a,r)=> a + (r.payable ? num(r.pr.eventPay||0) : 0), 0);
  const totalHours = rowsData.reduce((a,r)=> a + (r.payable ? num(r.pr.hoursTotal||0) : 0), 0);
  const paidCount = rowsData.filter(r=>r.payable).length;

  viewRoot.innerHTML = `
    <section class="card">
      <div class="row">
        <div>
          <h2>Dashboard admin — Finance</h2>
          <p class="muted">Semaine du <b>${weekStartStr}</b> au <b>${weekEndStr}</b>. (Lecture : anciennes semaines OK — saisie verrouillée hors semaine en cours.)</p>
        </div>
        <div class="row" style="gap:8px; flex-wrap:wrap; justify-content:flex-end">
          <button class="btn" id="admPrevWeek">← Semaine -1</button>
          <button class="btn" id="admThisWeek">Semaine actuelle</button>
          <button class="btn" id="admNextWeek">Semaine +1 →</button>
          <label class="muted" style="display:flex; align-items:center; gap:8px">
            <span>Date</span>
            <input type="date" id="admWeekPick" value="${weekStartStr}" />
          </label>
        </div>
      </div>

      <div class="kpis">
        <div class="kpi">
          <div class="label">À retirer du coffre</div>
          <div class="value">${money(totalToPay)}</div>
          <div class="muted">${paidCount} employé(s) payés</div>
        </div>
        <div class="kpi">
          <div class="label">Prime (convois + sécurité)</div>
          <div class="value">${money(totalPrime)}</div>
          <div class="muted">plafonds appliqués</div>
        </div>
        <div class="kpi">
          <div class="label">Évènements</div>
          <div class="value">${money(totalEvents)}</div>
          <div class="muted">pas de max</div>
        </div>
        <div class="kpi">
          <div class="label">Heures totales</div>
          <div class="value">${hoursFmt(totalHours)}</div>
          <div class="muted">convois ÷2 • sécu ÷7 • events ×2</div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="row">
        <div>
          <h2>Gestion des employés</h2>
          <p class="muted">Créer des codes d’invitation • Modifier grade / statut / qualifications</p>
        </div>
        <div class="noPrint" style="display:flex; gap:10px; align-items:end">
          <label style="margin:0">Recherche
            <input id="empSearch" placeholder="Nom / email / UID" />
          </label>
        </div>
      </div>

      <hr class="sep"/>

      <div class="panel noPrint">
        <h2>Créer un code d’invitation</h2>
        <form id="inviteForm" class="grid2" style="align-items:end">
          <div>
            <label>Nom & Prénom
              <input name="name" required />
            </label>
            <label>Date de naissance
              <input name="birth" placeholder="JJ/MM/AAAA ou texte RP" />
            </label>
            <label>Nationalité
              <input name="nationality" placeholder="américaine / mexicaine" />
            </label>
          </div>
          <div>
            <label>Grade
              <select name="rank">${RANKS.filter(r=>r!=="Licencier").map(r=>`<option>${escapeHtml(r)}</option>`).join("")}</select>
            </label>
            <label>Statut
              <select name="status">${STATUSES.map(s=>`<option>${escapeHtml(s)}</option>`).join("")}</select>
            </label>
            <label>Qualifications
              <select name="qualifications" multiple size="5">
                ${QUALIFICATIONS.map(q=>`<option value="${escapeHtml(q)}">${escapeHtml(q)}</option>`).join("")}
              </select>
            </label>
            <button class="primary" type="submit">Générer code</button>
            <p class="hint">Le salarié créera son compte avec ce code + email/mot de passe.</p>
          </div>
        </form>

        <div id="inviteResult" class="hidden" style="margin-top:10px"></div>
      </div>

      <div style="height:8px"></div>

      <table class="table" id="empTable">
  <thead>
    <tr>
      <th>Employé</th>
      <th>Grade</th>
      <th>Statut</th>
      <th>Qualifications</th>
      <th>Convois</th>
      <th>Sécurité</th>
      <th>Events</th>
      <th>Heures</th>
      <th>Prime</th>
      <th>Events</th>
      <th>À payer</th>
      <th style="width:340px"></th>
    </tr>
  </thead>
  <tbody>
    ${rowsData.map(row=>`
      <tr data-uid="${row.emp.uid}">
        <td>
          <b>${escapeHtml(row.emp.name||"—")}</b>
          <div class="muted">${escapeHtml(row.emp.email||"—")} • <span style="font-family:var(--mono)">${escapeHtml(row.emp.uid)}</span></div>
        </td>
        <td>${escapeHtml(row.emp.rank||"—")}</td>
        <td>${escapeHtml(row.emp.status||"—")}${row.emp.isAdmin?` <span class="pill neutral">ADMIN</span>`:""}</td>
        <td>
          <div class="pills">
            ${(row.emp.qualifications||[]).slice(0,6).map(q=>`<span class="pill">${escapeHtml(q)}</span>`).join("")}
            ${(row.emp.qualifications||[]).length>6?`<span class="pill">+${(row.emp.qualifications||[]).length-6}</span>`:""}
          </div>
        </td>
        <td>${num(row.totals.convoys)}</td>
        <td>${num(row.totals.securityChecks)}</td>
        <td>${num(row.totals.securedEvents)}</td>
        <td>${hoursFmt(row.pr.hoursTotal || 0)}</td>
        <td>${money(row.pr.prime || 0)}</td>
        <td>${money(row.pr.eventPay || 0)}</td>
        <td><b>${money(row.pr.total)}</b></td>
        <td class="noPrint">
          <div class="actions">
            <button class="sm btnViewDash" data-uid="${row.emp.uid}" data-name="${escapeHtml(row.emp.name||"")}">Dashboard</button>
            <button class="sm btnViewPay" data-uid="${row.emp.uid}" data-name="${escapeHtml(row.emp.name||"")}">Bulletin</button>
            <button class="sm btnViewContract" data-uid="${row.emp.uid}" data-name="${escapeHtml(row.emp.name||"")}">Contrat</button>
            <button class="primary sm btnEditEmp">Modifier</button>
          </div>
        </td>
      </tr>
    `).join("")}
  </tbody>
</table>
    </section>

    <section class="card hidden" id="empEditCard"></section>
  `;


  // navigation semaines (admin finance)
  const weekPick = viewRoot.querySelector("#admWeekPick");
  const prevBtn = viewRoot.querySelector("#admPrevWeek");
  const nextBtn = viewRoot.querySelector("#admNextWeek");
  const thisBtn = viewRoot.querySelector("#admThisWeek");
  if (weekPick){
    weekPick.addEventListener("change", (e)=>{
      const v = e.target.value;
      if (v){
        state.adminWeekDate = strToDate(v);
        renderAdmin();
      }
    });
  }
  prevBtn?.addEventListener("click", ()=>{
    state.adminWeekDate = addDays(state.adminWeekDate || new Date(), -7);
    renderAdmin();
  });
  nextBtn?.addEventListener("click", ()=>{
    state.adminWeekDate = addDays(state.adminWeekDate || new Date(), 7);
    renderAdmin();
  });
  thisBtn?.addEventListener("click", ()=>{
    state.adminWeekDate = new Date();
    renderAdmin();
  });

  // actions: consulter tableau de bord / bulletin / contrat
viewRoot.querySelectorAll(".btnViewDash").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    state.viewAsUid = btn.dataset.uid;
    state.viewAsName = btn.dataset.name || null;
    state.weekDate = new Date();
    state.currentView = "dashboard";
    render();
  });
});
viewRoot.querySelectorAll(".btnViewPay").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    state.viewAsUid = btn.dataset.uid;
    state.viewAsName = btn.dataset.name || null;
    state.weekDate = new Date();
    state.currentView = "payroll";
    render();
  });
});
viewRoot.querySelectorAll(".btnViewContract").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    state.viewAsUid = btn.dataset.uid;
    state.viewAsName = btn.dataset.name || null;
    state.weekDate = new Date();
    state.currentView = "contract";
    render();
  });
});

// invite form
  el("#inviteForm").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name")||"").trim();
    const birth = String(fd.get("birth")||"").trim();
    const nationality = String(fd.get("nationality")||"").trim() || "américaine / mexicaine";
    const rank = String(fd.get("rank")||"Novice");
    const status = String(fd.get("status")||"Actif");
    const qualifications = [...e.currentTarget.querySelector('select[name="qualifications"]').selectedOptions].map(o=>o.value);

    const code = generateInviteCode();
    try{
      const ref = firebase.doc(db, "invites", code);
      await firebase.setDoc(ref, {
        code,
        name, birth, nationality,
        rank, status,
        qualifications,
        isAdmin: false,
        // champs "used*" explicitement à null : évite des règles trop strictes et clarifie l'état du code
        usedBy: null,
        usedEmail: null,
        usedAt: null,
        createdAt: firebase.serverTimestamp(),
        createdBy: state.user.uid
      });
      const box = el("#inviteResult");
      box.classList.remove("hidden");
      box.classList.add("panel");
      box.innerHTML = `
        <div><b>Code généré :</b> <span style="font-family:var(--mono);font-size:16px">${escapeHtml(code)}</span></div>
        <div class="muted">À donner à l'employé pour créer son compte.</div>
        <div style="margin-top:8px" class="noPrint">
          <button id="btnCopyCode">Copier le code</button>
        </div>
      `;
      el("#btnCopyCode").addEventListener("click", async ()=>{
        await navigator.clipboard.writeText(code);
        toast("Code copié ✅");
      });

      e.currentTarget.reset();
      toast("Invite créée ✅");
    }catch(err){
      toast(err?.message || "Erreur invite", "error");
    }
  });

  // search
  el("#empSearch").addEventListener("input", ()=>{
    const q = el("#empSearch").value.toLowerCase().trim();
    els("#empTable tbody tr").forEach(tr=>{
      const text = tr.textContent.toLowerCase();
      tr.style.display = text.includes(q) ? "" : "none";
    });
  });

  // edit buttons
  viewRoot.querySelectorAll(".btnEditEmp").forEach(btn=>{
    btn.addEventListener("click", async (e)=>{
      const uid = e.currentTarget.closest("tr").dataset.uid;
      const emp = employees.find(x=>x.uid===uid);
      await openEmployeeEditor(emp);
    });
  });
}

function generateInviteCode(){
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = (n)=>Array.from({length:n}, ()=>alphabet[Math.floor(Math.random()*alphabet.length)]).join("");
  return `BOB-${part(4)}-${part(4)}`;
}

async function openEmployeeEditor(emp){
  const card = el("#empEditCard");
  card.classList.remove("hidden");

  const rankOptions = RANKS.map(r=>`<option ${emp.rank===r?"selected":""}>${escapeHtml(r)}</option>`).join("");
  const statusOptions = STATUSES.map(s=>`<option ${emp.status===s?"selected":""}>${escapeHtml(s)}</option>`).join("");

  const quals = new Set(emp.qualifications || []);
  const qualOptions = QUALIFICATIONS.map(q=>`<option value="${escapeHtml(q)}" ${quals.has(q)?"selected":""}>${escapeHtml(q)}</option>`).join("");

  card.innerHTML = `
    <div class="row">
      <div>
        <h2>Modifier : ${escapeHtml(emp.name||emp.email||emp.uid)}</h2>
        <div class="muted">UID: <span style="font-family:var(--mono)">${escapeHtml(emp.uid)}</span></div>
      </div>
      <div class="noPrint">
        <button id="btnCloseEmp">Fermer</button>
      </div>
    </div>

    <hr class="sep" />

    <form id="empForm" class="grid2 noPrint">
      <div>
        <label>Nom
          <input name="name" value="${escapeHtml(emp.name||"")}" />
        </label>
        <label>Date de naissance
          <input name="birth" value="${escapeHtml(emp.birth||"")}" />
        </label>
        <label>Nationalité
          <input name="nationality" value="${escapeHtml(emp.nationality||"américaine / mexicaine")}" />
        </label>
      </div>
      <div>
        <label>Grade
          <select name="rank">${rankOptions}</select>
        </label>
        <label>Statut
          <select name="status">${statusOptions}</select>
        </label>
        <label>Qualifications (Ctrl+clic)
          <select name="qualifications" multiple size="7">${qualOptions}</select>
        </label>
        <label>
          <input type="checkbox" name="isAdmin" ${emp.isAdmin?"checked":""} />
          Admin
        </label>
        <button class="primary" type="submit">Enregistrer</button>
        <p class="hint">Astuce : statut “Suspendu” ou “Licencié” ne bloque pas techniquement la connexion, mais sert à gérer RP + paie.</p>
      </div>
    </form>

    <div class="row noPrint" style="margin-top:10px">
      <button id="btnViewPayrollEmp">Voir bulletin (semaine)</button>
      <button id="btnViewContractEmp">Voir contrat</button>
    </div>

    <div id="empPreview" style="margin-top:10px"></div>
  `;

  el("#btnCloseEmp").addEventListener("click", ()=>card.classList.add("hidden"));

  el("#empForm").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name")||"").trim();
    const birth = String(fd.get("birth")||"").trim();
    const nationality = String(fd.get("nationality")||"").trim();
    const rank = String(fd.get("rank")||"Novice");
    const status = String(fd.get("status")||"Actif");
    const isAdmin = !!fd.get("isAdmin");
    const qualifications = [...e.currentTarget.querySelector('select[name="qualifications"]').selectedOptions].map(o=>o.value);

    try{
      const ref = firebase.doc(db, "employees", emp.uid);
      await firebase.updateDoc(ref, { name, birth, nationality, rank, status, isAdmin, qualifications, updatedAt: firebase.serverTimestamp() });
      toast("Employé mis à jour ✅");
      render(); // refresh list
    }catch(err){
      toast(err?.message || "Erreur mise à jour", "error");
    }
  });

  el("#btnViewPayrollEmp").addEventListener("click", async ()=>{
    state.currentView = "payroll";
    render();
    await renderPayroll(emp.uid);
  });

  el("#btnViewContractEmp").addEventListener("click", async ()=>{
    state.currentView = "contract";
    render();
    await renderContract(emp.uid);
  });
}

async function renderSettings(){
  if (!state.profile?.isAdmin){
    viewRoot.innerHTML = `<section class="card"><h2>Accès refusé</h2><p class="muted">Tu n'es pas admin.</p></section>`;
    return;
  }

  const p = state.pay;

  const wd = state.adminWeekDate || new Date();
  const wsDate = startOfWeek(wd);
  const weDate = endOfWeek(wd);
  const weekStartStr = dateToStr(wsDate);
  const weekEndStr = dateToStr(weDate);

  viewRoot.innerHTML = `
    <section class="card">
      <div class="row">
        <div>
          <h2>Dashboard admin — Finance</h2>
          <p class="muted">Semaine du <b>${weekStartStr}</b> au <b>${weekEndStr}</b>. (Lecture : anciennes semaines OK — saisie verrouillée hors semaine en cours.)</p>
        </div>
        <div class="row" style="gap:8px; flex-wrap:wrap; justify-content:flex-end">
          <button class="btn" id="admPrevWeek">← Semaine -1</button>
          <button class="btn" id="admThisWeek">Semaine actuelle</button>
          <button class="btn" id="admNextWeek">Semaine +1 →</button>
          <label class="muted" style="display:flex; align-items:center; gap:8px">
            <span>Date</span>
            <input type="date" id="admWeekPick" value="${weekStartStr}" />
          </label>
        </div>
      </div>

      <div class="kpis">
        <div class="kpi">
          <div class="label">À retirer du coffre</div>
          <div class="value">${money(totalToPay)}</div>
          <div class="muted">${paidCount} employé(s) payés</div>
        </div>
        <div class="kpi">
          <div class="label">Prime (convois + sécurité)</div>
          <div class="value">${money(totalPrime)}</div>
          <div class="muted">plafonds appliqués</div>
        </div>
        <div class="kpi">
          <div class="label">Évènements</div>
          <div class="value">${money(totalEvents)}</div>
          <div class="muted">pas de max</div>
        </div>
        <div class="kpi">
          <div class="label">Heures totales</div>
          <div class="value">${hoursFmt(totalHours)}</div>
          <div class="muted">convois ÷2 • sécu ÷7 • events ×2</div>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>Paramètres de paie</h2>
      <p class="muted">Configure les plafonds + le taux $/h par grade. (Règles fixes : convois ÷ 2 • sécurité ÷ 7 • évènements × 2).</p>

      <form id="settingsForm" class="grid2 noPrint">
        <div class="panel" style="grid-column:1/-1">
          <h2>Règles de conversion (temps)</h2>
          <div class="muted">Ces règles sont fixes :</div>
          <ul class="muted" style="margin:8px 0 0 18px">
            <li><b>Convois</b> : heures = convois ÷ 2</li>
            <li><b>Sécurité</b> : heures = contrôles ÷ 7</li>
            <li><b>Évènements</b> : heures = events × 2</li>
          </ul>
          <div class="hint">La paie est calculée avec le <b>taux $/h</b> du grade + plafonds.</div>
        </div>

        <div class="panel">
          <h2>Fixe direction</h2>
          <label>Salaire hebdo Directeur / Co-directeur
            <input name="directorWeekly" inputmode="numeric" value="${num(p.directorWeekly ?? 8500000)}" />
          </label>
        </div>

        <div class="panel">
          <h2>Plafonds hebdo</h2>
          <label>Max convois
            <input name="convoyMax" inputmode="numeric" value="${num(p.convoyMax)}" />
          </label>
          <label>Max sécurité
            <input name="securityMax" inputmode="numeric" value="${num(p.securityMax)}" />
          </label>
          <label>Max prime (convois + sécurité)
            <input name="primeMax" inputmode="numeric" value="${num(p.primeMax)}" />
          </label>
        </div>

        <div class="panel" style="grid-column:1/-1">
          <h2>Taux $/heure par grade</h2>
          <div class="muted">C'est ce taux qui sert pour calculer la paie des convois / sécurité / évènements.</div>
          <div style="height:8px"></div>
          <table class="table">
            <thead><tr><th>Grade</th><th style="width:260px">Taux $/h</th></tr></thead>
            <tbody>
              ${Object.keys(DEFAULT_PAY_SETTINGS.baseSalaries).map(rank=>`
                <tr>
                  <td><b>${escapeHtml(rank)}</b></td>
                  <td><input inputmode="numeric" name="base_${escapeHtml(rank)}" value="${num(p.baseSalaries?.[rank] ?? DEFAULT_PAY_SETTINGS.baseSalaries[rank])}" /></td>
                </tr>
              `).join("")}
            </tbody>
          </table>

          <div class="row" style="margin-top:10px">
            <button class="primary" type="submit">Sauvegarder</button>
          </div>
        </div>
      </form>

      <div class="hint">Après sauvegarde, tous les calculs se mettent à jour automatiquement.</div>
    </section>
  `;

  el("#settingsForm").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const baseSalaries = { ...p.baseSalaries };

    for (const rank of Object.keys(DEFAULT_PAY_SETTINGS.baseSalaries)){
      baseSalaries[rank] = num(fd.get(`base_${rank}`));
    }

    const next = {
      directorWeekly: num(fd.get("directorWeekly")),
      convoyMax: num(fd.get("convoyMax")),
      securityMax: num(fd.get("securityMax")),
      primeMax: num(fd.get("primeMax")),
      baseSalaries
    };

    try{
      await setPaySettings(next);
      state.pay = next;
      toast("Paramètres sauvegardés ✅");
      render();
    }catch(err){
      toast(err?.message || "Erreur sauvegarde", "error");
    }
  });
}


/** ---------- Profil manquant : réparation ---------- */
async function renderMissingProfile(){
  // On masque la navigation pour éviter des vues qui dépendent du profil
  nav.classList.add("hidden");
  setActiveNav("dashboard");

  viewTitle.textContent = "Profil manquant";
  viewSubtitle.textContent = "Rattache ton compte à un employé via un code d’invitation";

  viewRoot.innerHTML = `
    <section class="card">
      <div class="row">
        <div>
          <h2>Dashboard admin — Finance</h2>
          <p class="muted">Semaine du <b>${weekStartStr}</b> au <b>${weekEndStr}</b>. (Lecture : anciennes semaines OK — saisie verrouillée hors semaine en cours.)</p>
        </div>
        <div class="row" style="gap:8px; flex-wrap:wrap; justify-content:flex-end">
          <button class="btn" id="admPrevWeek">← Semaine -1</button>
          <button class="btn" id="admThisWeek">Semaine actuelle</button>
          <button class="btn" id="admNextWeek">Semaine +1 →</button>
          <label class="muted" style="display:flex; align-items:center; gap:8px">
            <span>Date</span>
            <input type="date" id="admWeekPick" value="${weekStartStr}" />
          </label>
        </div>
      </div>

      <div class="kpis">
        <div class="kpi">
          <div class="label">À retirer du coffre</div>
          <div class="value">${money(totalToPay)}</div>
          <div class="muted">${paidCount} employé(s) payés</div>
        </div>
        <div class="kpi">
          <div class="label">Prime (convois + sécurité)</div>
          <div class="value">${money(totalPrime)}</div>
          <div class="muted">plafonds appliqués</div>
        </div>
        <div class="kpi">
          <div class="label">Évènements</div>
          <div class="value">${money(totalEvents)}</div>
          <div class="muted">pas de max</div>
        </div>
        <div class="kpi">
          <div class="label">Heures totales</div>
          <div class="value">${hoursFmt(totalHours)}</div>
          <div class="muted">convois ÷2 • sécu ÷7 • events ×2</div>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>Profil employé non trouvé</h2>
      <p class="muted">Ton compte est bien connecté : <b>${escapeHtml(state.user?.email || "—")}</b></p>
      <p class="muted">Entre un code d’invitation fourni par un admin pour créer ton profil.</p>

      <form id="repairForm" class="grid2" style="align-items:end;margin-top:12px">
        <label>Code d’invitation
          <input name="invite" required placeholder="XXXXXX-XXXX" />
        </label>
        <button>Créer mon profil</button>
      </form>

      <p class="muted" style="margin-top:10px">Si tu n’as pas de code, contacte un admin.</p>
    </section>
  `;

  el("#repairForm").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("invite")||"").trim();
    if (!code) return toast("Code requis.", "error");
    try{
      await createEmployeeProfileFromInvite(state.user.uid, state.user.email, code);
      // Recharge le profil
      state.profile = await loadProfile(state.user.uid);
      nav.classList.remove("hidden");
      state.currentView = "dashboard";
      toast("Profil créé ✅");
      render();
    }catch(err){
      console.error(err);
      toast(err?.message || "Erreur création profil", "error");
    }
  });
}

/** ---------- Main render ---------- */
async function render(){
  setActiveNav(state.currentView);

  if (!state.user){
    authView.classList.remove("hidden");
    appView.classList.add("hidden");
    nav.classList.add("hidden");
    return;
  }

  nav.classList.remove("hidden");
  authView.classList.add("hidden");
  appView.classList.remove("hidden");

  enforceAdminUI();
  me.textContent = state.user?.email ? `${state.user.email}` : "";

  if (!state.profile){
    await renderMissingProfile();
    return;
  }

  // Semaine verrouillée (semaine en cours)
  state.weekDate = new Date();

  // Week input default
  weekDateInput.value = dateToStr(state.weekDate);

  // titles
  if (state.currentView === "dashboard"){ viewTitle.textContent = "Tableau de bord"; viewSubtitle.textContent = "Saisie par jour + récap hebdomadaire"; }
  if (state.currentView === "payroll"){ viewTitle.textContent = "Bulletin"; viewSubtitle.textContent = "Récap hebdo imprimable"; }
  if (state.currentView === "contract"){ viewTitle.textContent = "Contrat"; viewSubtitle.textContent = "CDI généré automatiquement"; }
  if (state.currentView === "admin"){ viewTitle.textContent = "Admin"; viewSubtitle.textContent = "Gestion employés + invites"; }
  if (state.currentView === "settings"){ viewTitle.textContent = "Paramètres"; viewSubtitle.textContent = "Rates + plafonds + salaires"; }

  
// Mode "consulter un autre employé" : ajuster sous-titre
if (state.profile?.isAdmin && state.viewAsUid){
  const who = state.viewAsName ? state.viewAsName : state.viewAsUid;
  viewSubtitle.textContent = `${viewSubtitle.textContent} • Consultation: ${who}`;
}
// prevent access to admin views
  if ((state.currentView === "admin" || state.currentView === "settings") && !state.profile?.isAdmin){
    state.currentView = "dashboard";
  }

  try{
    if (state.currentView === "dashboard") await renderDashboard(state.profile?.isAdmin ? state.viewAsUid : null);
    else if (state.currentView === "payroll") await renderPayroll(state.profile?.isAdmin ? state.viewAsUid : null);
    else if (state.currentView === "contract") await renderContract(state.profile?.isAdmin ? state.viewAsUid : null);
    else if (state.currentView === "admin") await renderAdmin();
    else if (state.currentView === "settings") await renderSettings();
    else await renderDashboard();

    // Bind 'Retour à moi' (mode admin)
    const btnExit = document.querySelector('#btnExitViewAs');
    if (btnExit){
      btnExit.addEventListener('click', ()=>{
        state.viewAsUid = null;
        state.viewAsName = null;
        state.currentView = 'dashboard';
        render();
      });
    }

  }catch(err){
    console.error(err);
    toast(err?.message || "Erreur d'affichage", "error");
  }
}

/** ---------- Boot ---------- */
firebase.onAuthStateChanged(auth, async (user)=>{
  state.user = user;

  if (!user){
    state.profile = null;
    state.pay = null;
    state.currentView = "dashboard";
    render();
    return;
  }

  state.pay = await getPaySettings();

  // load profile (must exist after invite signup)
  state.profile = await loadProfile(user.uid);

  if (!state.profile){
    state.currentView = "dashboard";
    render();
    return;
  }

  // UI admin fallback
  if (isUiAdmin(user.email) && !state.profile.isAdmin){
    // UI-only: we don't auto-promote in DB for security reasons.
    console.warn("UI admin email detected, but profile.isAdmin is false. Set isAdmin in Firestore if needed.");
  }

  render();
});
