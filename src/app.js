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

function computePay({rank, totals, pay}){
  const base = (pay.baseSalaries?.[rank] ?? 0) || 0;

  const convoyPayRaw = totals.convoys * pay.convoyRate;
  const securityPayRaw = totals.securityChecks * pay.securityRate;

  const convoyPay = Math.min(convoyPayRaw, pay.convoyMax);
  const securityPay = Math.min(securityPayRaw, pay.securityMax);

  // Prime = convois + sécurité (max 8.5M car 5M + 3.5M)
  const prime = Math.min(convoyPay + securityPay, pay.primeMax);

  const eventPay = totals.securedEvents * pay.eventRate; // pas de max

  const total = base + prime + eventPay;

  const hours = totals.convoys / 2; // règle demandée
  const perHour = hours > 0 ? total / hours : null;

  return { base, convoyPay, securityPay, prime, eventPay, total, hours, perHour };
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
  weekDate: new Date()
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
  const invite = String(fd.get("invite")||"").trim();
  const email = String(fd.get("email")||"").trim();
  const password = String(fd.get("password")||"");
  if (!invite) return toast("Code d’invitation requis.", "error");
  try{
    // Option: vérifier d'abord l'invite (get) pour éviter de créer un compte inutile.
    const inviteRef = firebase.doc(db, "invites", invite);
    const inviteSnap = await firebase.getDoc(inviteRef);
    if (!inviteSnap.exists()){
      return toast("Code d’invitation invalide.", "error");
    }
    if (inviteSnap.data()?.usedBy){
      return toast("Code déjà utilisé.", "error");
    }

    let cred;
    cred = await firebase.createUserWithEmailAndPassword(auth, email, password);
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

/** ---------- Profil via invitation (utilisé à l'inscription + réparation) ---------- */
async function createEmployeeProfileFromInvite(uid, email, inviteCode){
  const inviteRef = firebase.doc(db, "invites", inviteCode);
  const inviteSnap = await firebase.getDoc(inviteRef);
  if (!inviteSnap.exists()) throw new Error("Code d’invitation invalide.");
  if (inviteSnap.data()?.usedBy) throw new Error("Code déjà utilisé.");

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
      usedEmail: email,
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
  if (!weekDateInput.value) return;
  state.weekDate = strToDate(weekDateInput.value);
  render();
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

/** ---------- Views ---------- */
async function renderDashboard(){
  const uid = state.user.uid;
  const s = startOfWeek(state.weekDate);
  const e = endOfWeek(state.weekDate);
  const startStr = dateToStr(s);
  const endStr = dateToStr(e);

  const days = await loadWeekDays(uid, startStr, endStr);
  const totals = computeTotals(days);
  const payResult = computePay({ rank: state.profile.rank, totals, pay: state.pay });

  const rows = [];
  for (let i=0;i<7;i++){
    const d = new Date(s);
    d.setDate(s.getDate()+i);
    const ds = dateToStr(d);
    const data = days.get(ds) || { convoys:0, securityChecks:0, securedEvents:0 };
    rows.push({ ds, label: d.toLocaleDateString("fr-FR",{weekday:"long", day:"2-digit", month:"2-digit"}), data });
  }

  viewRoot.innerHTML = `
    <section class="card">
      <div class="row">
        <div class="pills">
          <span class="pill neutral">Grade: <b>${escapeHtml(state.profile.rank)}</b></span>
          <span class="pill ${state.profile.status==="Actif"?"good":(state.profile.status==="Suspendu"?"bad":"bad")}">Statut: <b>${escapeHtml(state.profile.status)}</b></span>
        </div>
        <div class="pills">
          ${(state.profile.qualifications||[]).map(q=>`<span class="pill">${escapeHtml(q)}</span>`).join("") || `<span class="pill">Aucune qualification</span>`}
        </div>
      </div>

      <hr class="sep" />

      <div class="kpis">
        <div class="kpi"><div class="label">Convois (hebdo)</div><div class="value">${totals.convoys}</div><div class="sub">Heures = convois / 2 → <b>${payResult.hours}</b> h</div></div>
        <div class="kpi"><div class="label">Contrôles sécurité (hebdo)</div><div class="value">${totals.securityChecks}</div><div class="sub">Plafond sécurité: ${money(state.pay.securityMax)}</div></div>
        <div class="kpi"><div class="label">Évènements sécurisés (hebdo)</div><div class="value">${totals.securedEvents}</div><div class="sub">Pas de max</div></div>
        <div class="kpi"><div class="label">Total estimé</div><div class="value">${money(payResult.total)}</div><div class="sub">Rapport $/h: <b>${payResult.perHour ? money(payResult.perHour) + "/h" : "—"}</b></div></div>
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
              <td><input inputmode="numeric" class="inConvoys" value="${num(r.data.convoys)}" /></td>
              <td><input inputmode="numeric" class="inSec" value="${num(r.data.securityChecks)}" /></td>
              <td><input inputmode="numeric" class="inEvt" value="${num(r.data.securedEvents)}" /></td>
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
          <div class="muted">Heures : <b>${payResult.hours}</b> h • Rapport : <b>${payResult.perHour ? money(payResult.perHour)+"/h" : "—"}</b></div>
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

  const s = startOfWeek(state.weekDate);
  const e = endOfWeek(state.weekDate);
  const startStr = dateToStr(s);
  const endStr = dateToStr(e);

  const days = await loadWeekDays(uid, startStr, endStr);
  const totals = computeTotals(days);
  const payResult = computePay({ rank: profile.rank, totals, pay: state.pay });

  viewRoot.innerHTML = `
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
          <tr><td><b>Salaire de base</b></td><td>Selon grade (${escapeHtml(profile.rank)})</td><td style="text-align:right">${money(payResult.base)}</td></tr>
          <tr><td><b>Convois</b></td><td>${totals.convoys} × ${money(state.pay.convoyRate)} (max ${money(state.pay.convoyMax)})</td><td style="text-align:right">${money(payResult.convoyPay)}</td></tr>
          <tr><td><b>Sécurité</b></td><td>${totals.securityChecks} × ${money(state.pay.securityRate)} (max ${money(state.pay.securityMax)})</td><td style="text-align:right">${money(payResult.securityPay)}</td></tr>
          <tr><td><b>Prime (Convois + Sécurité)</b></td><td>Max ${money(state.pay.primeMax)}</td><td style="text-align:right">${money(payResult.prime)}</td></tr>
          <tr><td><b>Évènements</b></td><td>${totals.securedEvents} × ${money(state.pay.eventRate)} (pas de max)</td><td style="text-align:right">${money(payResult.eventPay)}</td></tr>
          <tr><td><b>Total heures</b></td><td>Convois / 2</td><td style="text-align:right">${payResult.hours} h</td></tr>
          <tr><td><b>Rapport $/heure</b></td><td>Total / heures</td><td style="text-align:right"><b>${payResult.perHour ? money(payResult.perHour)+"/h" : "—"}</b></td></tr>
          <tr><td><b>TOTAL À PAYER</b></td><td></td><td style="text-align:right"><b>${money(payResult.total)}</b></td></tr>
        </tbody>
      </table>

      <p class="hint">Note : les montants sont calculés automatiquement selon les paramètres (rates + plafonds) et la règle heures = convois / 2.</p>
    </section>
  `;
}

async function renderContract(forUid=null){
  const uid = forUid || state.user.uid;
  const profile = forUid ? await loadProfile(uid) : state.profile;

  const today = dateToStr(new Date());
  const tpl = contractTemplate({
    name: profile.name || "$Name",
    birth: profile.birth || "$Birth",
    nationality: profile.nationality || "américaine / mexicaine",
    dateStr: today,
    rank: profile.rank || "novice"
  });

  viewRoot.innerHTML = `
    <section class="card">
      <div class="row">
        <div>
          <h2>Contrat CDI (auto)</h2>
          <div class="muted">Généré à partir du profil employé</div>
        </div>
        <div class="noPrint">
          <button class="primary" onclick="window.print()">Imprimer / PDF</button>
        </div>
      </div>

      <hr class="sep" />

      <div class="panel">
        <label>Contrat (modifiable avant impression)
          <textarea id="contractText">${escapeHtml(tpl)}</textarea>
        </label>
        <div class="row noPrint">
          <button id="btnCopyContract">Copier</button>
          <button class="primary" onclick="window.print()">Imprimer</button>
        </div>
      </div>
    </section>
  `;

  el("#btnCopyContract").addEventListener("click", async ()=>{
    const t = el("#contractText").value;
    await navigator.clipboard.writeText(t);
    toast("Contrat copié ✅");
  });
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

  viewRoot.innerHTML = `
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
            <th style="width:160px"></th>
          </tr>
        </thead>
        <tbody>
          ${employees.map(emp=>`
            <tr data-uid="${emp.uid}">
              <td>
                <b>${escapeHtml(emp.name||"—")}</b>
                <div class="muted">${escapeHtml(emp.email||"—")} • <span style="font-family:var(--mono)">${emp.uid}</span></div>
              </td>
              <td>${escapeHtml(emp.rank||"—")}</td>
              <td>${escapeHtml(emp.status||"—")}${emp.isAdmin?` <span class="pill neutral">ADMIN</span>`:""}</td>
              <td>
                <div class="pills">
                  ${(emp.qualifications||[]).slice(0,6).map(q=>`<span class="pill">${escapeHtml(q)}</span>`).join("")}
                  ${(emp.qualifications||[]).length>6?`<span class="pill">+${(emp.qualifications||[]).length-6}</span>`:""}
                </div>
              </td>
              <td class="noPrint"><button class="primary btnEditEmp">Modifier</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </section>

    <section class="card hidden" id="empEditCard"></section>
  `;

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

  viewRoot.innerHTML = `
    <section class="card">
      <h2>Paramètres de paie</h2>
      <p class="muted">Tu peux adapter les rates au RP. Les plafonds sont ceux que tu as donnés (convois 5M / sécurité 3.5M / prime 8.5M).</p>

      <form id="settingsForm" class="grid2 noPrint">
        <div class="panel">
          <h2>Rates</h2>
          <label>$ par convoi
            <input name="convoyRate" inputmode="numeric" value="${num(p.convoyRate)}" />
          </label>
          <label>$ par contrôle sécurité
            <input name="securityRate" inputmode="numeric" value="${num(p.securityRate)}" />
          </label>
          <label>$ par événement sécurisé
            <input name="eventRate" inputmode="numeric" value="${num(p.eventRate)}" />
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
          <h2>Salaires de base (hebdo)</h2>
          <div class="muted">Édite si besoin (sinon tu peux laisser les valeurs par défaut).</div>
          <div style="height:8px"></div>
          <table class="table">
            <thead><tr><th>Grade</th><th style="width:260px">Salaire</th></tr></thead>
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
      convoyRate: num(fd.get("convoyRate")),
      securityRate: num(fd.get("securityRate")),
      eventRate: num(fd.get("eventRate")),
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

  // Week input default
  weekDateInput.value = dateToStr(state.weekDate);

  // titles
  if (state.currentView === "dashboard"){ viewTitle.textContent = "Tableau de bord"; viewSubtitle.textContent = "Saisie par jour + récap hebdomadaire"; }
  if (state.currentView === "payroll"){ viewTitle.textContent = "Bulletin"; viewSubtitle.textContent = "Récap hebdo imprimable"; }
  if (state.currentView === "contract"){ viewTitle.textContent = "Contrat"; viewSubtitle.textContent = "CDI généré automatiquement"; }
  if (state.currentView === "admin"){ viewTitle.textContent = "Admin"; viewSubtitle.textContent = "Gestion employés + invites"; }
  if (state.currentView === "settings"){ viewTitle.textContent = "Paramètres"; viewSubtitle.textContent = "Rates + plafonds + salaires"; }

  // prevent access to admin views
  if ((state.currentView === "admin" || state.currentView === "settings") && !state.profile?.isAdmin){
    state.currentView = "dashboard";
  }

  try{
    if (state.currentView === "dashboard") await renderDashboard();
    else if (state.currentView === "payroll") await renderPayroll();
    else if (state.currentView === "contract") await renderContract();
    else if (state.currentView === "admin") await renderAdmin();
    else if (state.currentView === "settings") await renderSettings();
    else await renderDashboard();
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
