// Oberfläche der Adressverwaltung (Master-PC und Offline-App).
"use strict";

const Z = {
  speicher: null, status: null, ansicht: "kontakte",
  kontakte: [], papierkorb: [], pruefung: [], konflikte: [],
  gewaehlt: null, maske: null, suche: "",
  sortierung: "name", filter: { label: "", land: "", merkmal: "", zeit: "" },
};

// Sortierung und Filter pro Gerät merken (nur Bequemlichkeit, darf fehlen)
function ansichtMerken() {
  try { localStorage.setItem("adressen-ansicht", JSON.stringify({ sortierung: Z.sortierung, filter: Z.filter })); } catch (e) { /* egal */ }
}
function ansichtLaden() {
  try {
    const a = JSON.parse(localStorage.getItem("adressen-ansicht") || "null");
    if (a) { Z.sortierung = a.sortierung || "name"; Object.assign(Z.filter, a.filter || {}); }
  } catch (e) { /* egal */ }
}

// --- Hilfen ---------------------------------------------------------------

function el(tag, attr = {}, ...kinder) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attr || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "text") e.textContent = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const kind of kinder.flat()) {
    if (kind === null || kind === undefined || kind === false) continue;
    e.append(kind instanceof Node ? kind : document.createTextNode(String(kind)));
  }
  return e;
}
const $ = (id) => document.getElementById(id);

function meldung(text, dauer = 3500) {
  const m = $("meldung");
  m.textContent = text; m.hidden = false;
  clearTimeout(meldung.t);
  meldung.t = setTimeout(() => (m.hidden = true), dauer);
}

function frage(titel, inhalt, ja = "OK", nein = "Abbrechen", gefahr = false) {
  const d = $("dialog");
  $("dialog-titel").textContent = titel;
  const text = $("dialog-text");
  text.replaceChildren(inhalt instanceof Node ? inhalt : el("p", { text: inhalt }));
  $("dialog-ja").textContent = ja;
  $("dialog-ja").className = "knopf " + (gefahr ? "gefahr" : "haupt");
  $("dialog-nein").textContent = nein;
  $("dialog-nein").hidden = !nein;
  d.returnValue = "";
  d.showModal();
  return new Promise((ok) => d.addEventListener("close", () => ok(d.returnValue === "ja"), { once: true }));
}

const zeitText = (iso) => iso ? new Date(iso).toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" }) : "nie";

function geburtstagText(w) {
  if (!w) return "";
  let m = w.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  m = w.match(/^--(\d{2})-(\d{2})$/);
  return m ? `${m[2]}.${m[1]}.` : w;
}

const initialen = (k) => {
  const n = Pruefung.anzeigename(k).replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/);
  return ((n[0] || "?")[0] + (n.length > 1 ? n[n.length - 1][0] : "")).toUpperCase();
};

function unterzeile(k) {
  const teile = [];
  if (k.firma && (k.vorname || k.nachname)) teile.push(k.firma);
  if (k.telefone && k.telefone[0]) teile.push(k.telefone[0].nummer);
  else if (k.emails && k.emails[0]) teile.push(k.emails[0].adresse);
  return teile.join(" · ");
}

function passtZurSuche(k, q) {
  if (!q) return true;
  const text = [Pruefung.anzeigename(k), k.firma, k.funktion, k.abteilung, k.notiz,
    ...(k.emails || []).map((e) => e.adresse), ...(k.adressen || []).flatMap((a) => [a.strasse, a.plz, a.ort]),
    ...(k.labels || [])].join(" ").toLowerCase();
  const woerter = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (woerter.every((w) => text.includes(w))) return true;
  const ziffern = q.replace(/\D/g, "");
  if (ziffern.length >= 3) {
    const varianten = [ziffern];
    if (ziffern.startsWith("00")) varianten.push(ziffern.slice(2));
    else if (ziffern.startsWith("0")) varianten.push("41" + ziffern.slice(1), "49" + ziffern.slice(1));
    return (k.telefone || []).some((t) => varianten.some((v) => t.nummer.replace(/\D/g, "").includes(v)));
  }
  return false;
}

// --- Laden ----------------------------------------------------------------

async function waehleSpeicher() {
  try {
    const r = await fetch("/api/status", { cache: "no-store" });
    if (r.ok && (await r.json()).modus === "master") return new MasterSpeicher();
  } catch (e) { /* kein Master erreichbar */ }
  return new OfflineSpeicher();
}

async function laden() {
  Z.status = await Z.speicher.status();
  [Z.kontakte, Z.papierkorb, Z.konflikte] = await Promise.all([
    Z.speicher.liste(false), Z.speicher.liste(true), Z.speicher.konflikte()]);
  Z.pruefung = await Z.speicher.pruefungListe();
  const s = Z.status;
  $("modus").textContent = s.modus === "master"
    ? `Master-PC · letzte Sync ${zeitText(s.letzte_sync && s.letzte_sync.zeit)}${s.google_eingerichtet ? "" : " · Google nicht eingerichtet"}`
    : `${s.geraet || "Offline-App"} · Stand ${zeitText(s.stand_vom)}${s.offen ? ` · ${s.offen} Änderung(en) offen` : ""}`;
  $("z-kontakte").textContent = Z.kontakte.length;
  $("z-pruefung").textContent = Z.pruefung.filter((p) => p.fehler.length).length || "";
  $("z-papierkorb").textContent = Z.papierkorb.length || "";
  $("z-konflikte").textContent = Z.konflikte.length || "";
  const labels = [...new Set(Z.kontakte.flatMap((k) => k.labels || []))].sort((a, b) => a.localeCompare(b, "de"));
  Z.alleLabels = labels;
  $("filter-label").replaceChildren(el("option", { value: "", text: "Alle" }),
    el("option", { value: "*fav", text: "★ Favoriten" }),
    el("option", { value: "*ohne", text: "ohne Label" }),
    ...labels.map((l) => el("option", { value: l, text: l })));
  const laender = [...new Set(Z.kontakte.flatMap((k) => (k.adressen || []).map((a) => a.land)).filter(Boolean))]
    .map((c) => [c, Pruefung.LAENDER[c] || c]).sort((a, b) => a[1].localeCompare(b[1], "de"));
  $("filter-land").replaceChildren(el("option", { value: "", text: "Alle" }),
    ...laender.map(([c, n]) => el("option", { value: c, text: n })));
  zeigeFilterWerte();
  zeigeAnsicht();
}

// --- Ansichten --------------------------------------------------------------

function setzeReiter(ansicht) {
  Z.ansicht = ansicht;
  for (const b of $("reiter").children) b.classList.toggle("aktiv", b.dataset.ansicht === ansicht);
  $("suchleiste").hidden = !["kontakte", "papierkorb"].includes(ansicht);
  $("trefferzahl").hidden = $("suchleiste").hidden;
  $("btn-neu").hidden = ansicht !== "kontakte";
  schliesseDetail();
  zeigeAnsicht();
}

function zeigeAnsicht() {
  const fn = { kontakte: zeigeListe, papierkorb: zeigeListe, pruefung: zeigePruefung,
    konflikte: zeigeKonflikte, protokoll: zeigeProtokoll }[Z.ansicht];
  fn();
}

// --- Sortieren und Filtern ---------------------------------------------------

const vergleich = (a, b) => (a || "").trim().localeCompare((b || "").trim(), "de", { sensitivity: "base" });
const ersterOrt = (k) => ((k.adressen || []).find((a) => a.ort) || {}).ort || "";
const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function tageBisGeburtstag(k) {
  const m = (k.geburtstag || "").match(/(\d{2})-(\d{2})$/);
  if (!m) return null;
  const heute = new Date(); heute.setHours(0, 0, 0, 0);
  let n = new Date(heute.getFullYear(), +m[1] - 1, +m[2]);
  if (n < heute) n = new Date(heute.getFullYear() + 1, +m[1] - 1, +m[2]);
  return Math.round((n - heute) / 86400000);
}

function alterBeiGeburtstag(k) {
  const m = (k.geburtstag || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const naechster = new Date(Date.now() + tageBisGeburtstag(k) * 86400000);
  return naechster.getFullYear() - +m[1];
}

function buchstabe(text) {
  const b = (text || "").trim().charAt(0).toUpperCase();
  return /\p{L}/u.test(b) ? b.normalize("NFD")[0] : "#";
}

const monatJahr = (iso) => { const d = new Date(iso); return isNaN(d) ? "unbekannt" : `${MONATE[d.getMonth()]} ${d.getFullYear()}`; };
const nachName = (a, b) => vergleich(Pruefung.anzeigename(a), Pruefung.anzeigename(b));

// Je Sortierung: Reihenfolge, Gruppenüberschrift, optional Name und Zusatzzeile
const SORTIERUNGEN = {
  name: { sort: nachName, gruppe: (k) => buchstabe(Pruefung.anzeigename(k)) },
  nachname: {
    sort: (a, b) => vergleich(a.nachname || a.firma || a.vorname, b.nachname || b.firma || b.vorname) || vergleich(a.vorname, b.vorname),
    gruppe: (k) => buchstabe(k.nachname || k.firma || k.vorname),
    name: (k) => [k.nachname, k.vorname].filter(Boolean).join(", ") || k.firma || "(ohne Namen)",
  },
  firma: {
    sort: (a, b) => (!a.firma - !b.firma) || vergleich(a.firma, b.firma) || nachName(a, b),
    gruppe: (k) => (k.firma || "").trim() || "ohne Firma",
    unter: (k) => [k.funktion, ((k.telefone || [])[0] || {}).nummer].filter(Boolean).join(" · "),
  },
  ort: {
    sort: (a, b) => (!ersterOrt(a) - !ersterOrt(b)) || vergleich(ersterOrt(a), ersterOrt(b)) || nachName(a, b),
    gruppe: (k) => ersterOrt(k) || "ohne Ort",
    unter: (k) => {
      const a = (k.adressen || []).find((x) => x.ort) || {};
      return [a.strasse, [a.plz, a.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ") || unterzeile(k);
    },
  },
  geaendert: {
    sort: (a, b) => (b.geaendert || "").localeCompare(a.geaendert || ""),
    gruppe: (k) => monatJahr(k.geaendert),
    unter: (k) => `geändert ${zeitText(k.geaendert)}${k.quelle ? ` (${k.quelle})` : ""}`,
  },
  erstellt: {
    sort: (a, b) => (b.erstellt || "").localeCompare(a.erstellt || ""),
    gruppe: (k) => monatJahr(k.erstellt),
    unter: (k) => `erfasst ${zeitText(k.erstellt)}`,
  },
  geburtstag: {
    sort: (a, b) => {
      const x = tageBisGeburtstag(a), y = tageBisGeburtstag(b);
      return ((x === null) - (y === null)) || ((x || 0) - (y || 0)) || nachName(a, b);
    },
    gruppe: (k) => { const m = (k.geburtstag || "").match(/(\d{2})-\d{2}$/); return m ? MONATE[+m[1] - 1] : "ohne Geburtstag"; },
    unter: (k) => {
      const t = tageBisGeburtstag(k);
      if (t === null) return unterzeile(k);
      const alter = alterBeiGeburtstag(k);
      const wann = t === 0 ? "heute" : t === 1 ? "morgen" : `in ${t} Tagen`;
      return `${geburtstagText(k.geburtstag)} · ${wann}${alter ? `, wird ${alter}` : ""}`;
    },
  },
};

const aktiveFilter = () => Object.values(Z.filter).filter(Boolean).length;

function passtZumFilter(k, fehlerIds) {
  const f = Z.filter;
  if (f.label === "*fav" && !k.favorit) return false;
  if (f.label === "*ohne" && (k.labels || []).length) return false;
  if (f.label && !f.label.startsWith("*") && !(k.labels || []).includes(f.label)) return false;
  if (f.land && !(k.adressen || []).some((a) => a.land === f.land)) return false;
  const hat = { tel: (k.telefone || []).length, mail: (k.emails || []).length, adr: (k.adressen || []).length };
  switch (f.merkmal) {
    case "tel": case "mail": case "adr": if (!hat[f.merkmal]) return false; break;
    case "ohne-tel": case "ohne-mail": case "ohne-adr": if (hat[f.merkmal.slice(5)]) return false; break;
    case "gb": if (!k.geburtstag) return false; break;
    case "firma": if (!k.firma) return false; break;
    case "fehler": if (!fehlerIds.has(k.id)) return false; break;
  }
  if (f.zeit) {
    const grenze = new Date();
    if (f.zeit === "1") grenze.setHours(0, 0, 0, 0);
    else grenze.setTime(Date.now() - +f.zeit * 86400000);
    if (!(new Date(k.geaendert) >= grenze)) return false;
  }
  return true;
}

function zeigeFilterWerte() {
  $("sortierung").value = Z.sortierung;
  if ($("sortierung").value !== Z.sortierung) { Z.sortierung = "name"; $("sortierung").value = "name"; }
  for (const [feld, wert] of Object.entries(Z.filter)) {
    const sel = $("filter-" + feld);
    sel.value = wert;
    if (sel.value !== wert) { Z.filter[feld] = ""; sel.value = ""; }
  }
  $("z-filter").textContent = aktiveFilter() || "";
}

function zeigeListe() {
  const papier = Z.ansicht === "papierkorb";
  const fehlerIds = new Set(Z.pruefung.filter((p) => p.fehler.length).map((p) => p.id));
  const basis = papier ? Z.papierkorb : Z.kontakte;
  const art = SORTIERUNGEN[Z.sortierung] || SORTIERUNGEN.name;
  const liste = basis.filter((k) => passtZurSuche(k, Z.suche) && passtZumFilter(k, fehlerIds)).sort(art.sort);
  const wort = papier ? "im Papierkorb" : "Kontakte";
  $("trefferzahl").textContent = liste.length === basis.length ? `${basis.length} ${wort}`
    : `${liste.length} von ${basis.length} ${papier ? "im Papierkorb" : "Kontakten"}`;
  const box = $("liste");
  box.replaceChildren();
  if (!liste.length) {
    box.append(el("div", { class: "leer", text: papier && !basis.length ? "Der Papierkorb ist leer." : "Keine Kontakte gefunden." }));
    return;
  }
  let gruppeVorher = null;
  for (const k of liste) {
    const gruppe = art.gruppe(k);
    if (gruppe !== gruppeVorher) { gruppeVorher = gruppe; box.append(el("div", { class: "buchstabe", text: gruppe })); }
    box.append(el("div", {
      class: "eintrag" + (Z.gewaehlt && Z.gewaehlt.id === k.id ? " gewaehlt" : ""), role: "listitem", tabindex: "0",
      "data-id": k.id,
      onclick: () => zeigeDetail(k), onkeydown: (e) => e.key === "Enter" && zeigeDetail(k),
    },
      el("div", { class: "avatar", text: initialen(k) }),
      el("div", { class: "text" },
        el("div", { class: "name", text: (k.favorit ? "★ " : "") + (art.name ? art.name(k) : Pruefung.anzeigename(k)) }),
        el("div", { class: "unter", text: papier ? `gelöscht ${zeitText(k.geloescht)}` : (art.unter ? art.unter(k) : unterzeile(k)) })),
      k.lokal ? el("span", { class: "marke lokal", text: "lokal" }) : null,
      fehlerIds.has(k.id) ? el("span", { class: "marke fehler", text: "prüfen" }) : null));
  }
  // Gewählten Kontakt nach dem Neuzeichnen sichtbar halten (z. B. nach dem Speichern)
  const gewaehlt = Z.gewaehlt && box.querySelector(`[data-id="${Z.gewaehlt.id}"]`);
  if (gewaehlt && !schmal()) gewaehlt.scrollIntoView({ block: "nearest" });
}

function zeigePruefung() {
  const box = $("liste");
  box.replaceChildren();
  if (!Z.pruefung.length) return box.append(el("div", { class: "leer", text: "Keine Auffälligkeiten." }));
  const sortiert = [...Z.pruefung].sort((a, b) => b.fehler.length - a.fehler.length);
  box.append(el("div", { class: "buchstabe", text: `${sortiert.filter((p) => p.fehler.length).length} mit Fehlern, ${sortiert.filter((p) => !p.fehler.length).length} mit Hinweisen` }));
  for (const p of sortiert) {
    const k = Z.kontakte.find((x) => x.id === p.id);
    box.append(el("div", { class: "eintrag pruef-eintrag", onclick: () => k && zeigeMaske(k) },
      el("div", { class: "text" },
        el("div", { class: "name" }, p.name, " ",
          p.fehler.length ? el("span", { class: "marke fehler", text: `${p.fehler.length} Fehler` }) : null,
          p.hinweise.length ? el("span", { class: "marke hinweis", text: `${p.hinweise.length} Hinweis(e)` }) : null),
        el("ul", {}, [...p.fehler, ...p.hinweise].map((x) => el("li", { text: `${feldName(x.feld)}: ${x.meldung}` }))))));
  }
}

function feldName(feld) {
  const [teil, nr, unter] = feld.split(".");
  const namen = { vorname: "Vorname", nachname: "Nachname", firma: "Firma", funktion: "Funktion",
    abteilung: "Abteilung", telefone: "Telefon", emails: "E-Mail", adressen: "Adresse", geburtstag: "Geburtstag",
    websites: "Website", notiz: "Notiz", plz: "PLZ", ort: "Ort", land: "Land" };
  let n = namen[teil] || teil;
  if (nr !== undefined) n += ` ${+nr + 1}`;
  if (unter && namen[unter]) n += ` (${namen[unter]})`;
  return n;
}

function zeigeKonflikte() {
  const box = $("liste");
  box.replaceChildren();
  if (!Z.konflikte.length) return box.append(el("div", { class: "leer", text: "Keine offenen Konflikte." }));
  for (const k of Z.konflikte) {
    const master = [...Z.kontakte, ...Z.papierkorb].find((x) => x.id === k.kontakt_id);
    const kurz = (x) => x ? [Pruefung.anzeigename(x), ...(x.telefone || []).map((t) => t.nummer),
      ...(x.emails || []).map((e) => e.adresse), ...(x.adressen || []).map((a) => [a.strasse, a.plz, a.ort].filter(Boolean).join(" ")),
      x.geloescht ? "(gelöscht)" : ""].filter(Boolean).join("\n") : "(nicht vorhanden)";
    box.append(el("div", { class: "eintrag konflikt", style: "display:block;cursor:default" },
      el("div", { class: "name", text: master ? Pruefung.anzeigename(master) : (k.daten ? Pruefung.anzeigename(k.daten) : "Kontakt") }),
      el("div", { class: "unter", text: `${k.quelle} · ${zeitText(k.zeit)} · ${k.grund}` }),
      el("div", { class: "vergleich" },
        el("div", {}, el("h3", { text: "Master (gilt)" }), el("div", { class: "notiz", text: kurz(master) })),
        el("div", {}, el("h3", { text: `Fassung ${k.quelle}` }), el("div", { class: "notiz", text: kurz(k.daten) }))),
      el("div", { class: "zeile-knoepfe", style: "display:flex;gap:8px;margin-top:8px" },
        el("button", { class: "knopf", type: "button", text: "Master behalten", onclick: () => konfliktLoesen(k, "verwerfen") }),
        el("button", { class: "knopf haupt", type: "button", text: "Andere Fassung übernehmen", onclick: () => konfliktLoesen(k, "uebernehmen") }))));
  }
}

async function konfliktLoesen(k, aktion) {
  try { await Z.speicher.konfliktLoesen(k.id, aktion); meldung("Konflikt erledigt"); await laden(); }
  catch (e) { meldung(e.message); }
}

async function zeigeProtokoll() {
  const box = $("liste");
  box.replaceChildren(el("div", { class: "leer", text: "Lade …" }));
  const liste = await Z.speicher.protokoll();
  box.replaceChildren();
  box.classList.add("protokoll");
  if (!liste.length) box.append(el("div", { class: "leer", text: "Keine Einträge." }));
  for (const p of liste) {
    box.append(el("div", { class: "eintrag" }, el("div", { class: "unter", text: zeitText(p.zeit) }),
      el("div", {}, el("b", { text: p.art + " " }), p.text)));
  }
}

// --- Detail -----------------------------------------------------------------

const schmal = () => window.matchMedia("(max-width: 760px)").matches;

function oeffneDetail(inhalt) {
  const rahmen = document.querySelector(".rahmen");
  // Auf dem Handy ersetzt das Detail die Liste: Scrollposition merken für «Zurück»
  if (schmal() && !rahmen.classList.contains("detail-offen")) Z.listenPosition = window.scrollY;
  $("detail").replaceChildren(inhalt);
  $("spalte-detail").hidden = false;
  $("spalte-detail").scrollTop = 0;
  rahmen.classList.add("detail-offen");
  if (schmal()) window.scrollTo(0, 0);
}
function schliesseDetail() {
  Z.gewaehlt = null; Z.maske = null;
  const warOffen = document.querySelector(".rahmen").classList.contains("detail-offen");
  $("spalte-detail").hidden = true;
  document.querySelector(".rahmen").classList.remove("detail-offen");
  $("liste").classList.remove("protokoll");
  if (warOffen && schmal() && Z.listenPosition !== undefined) {
    const y = Z.listenPosition;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }
}
const zurueckKnopf = () => el("button", { class: "knopf leise zurueck", type: "button", text: "← Zurück",
  onclick: async () => { if (await maskeVerlassen()) { schliesseDetail(); zeigeAnsicht(); } } });

async function zeigeDetail(k) {
  if (!(await maskeVerlassen())) return;
  Z.gewaehlt = k; Z.maske = null;
  zeigeAnsicht();
  const dl = el("dl", { class: "feldliste" });
  const zeile = (titel, ...inhalt) => dl.append(el("dt", { text: titel }), el("dd", {}, ...inhalt));
  for (const t of k.telefone || []) zeile(t.typ || "Telefon", el("a", { href: "tel:" + t.nummer.replace(/[^\d+]/g, ""), text: t.nummer }));
  for (const e of k.emails || []) zeile(`E-Mail ${e.typ || ""}`.trim(), el("a", { href: "mailto:" + e.adresse, text: e.adresse }));
  for (const a of k.adressen || []) {
    const text = [a.strasse, [a.plz, a.ort].filter(Boolean).join(" "), a.region, Pruefung.LAENDER[a.land] || a.land].filter(Boolean).join(", ");
    zeile(`Adresse ${a.typ || ""}`.trim(), el("a", { href: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(text), target: "_blank", rel: "noopener", text }));
  }
  if (k.geburtstag) zeile("Geburtstag", geburtstagText(k.geburtstag));
  for (const w of k.websites || []) zeile("Website", el("a", { href: w, target: "_blank", rel: "noopener noreferrer", text: w }));
  if ((k.labels || []).length) zeile("Labels", el("div", { class: "chips" }, k.labels.map((l) => el("span", { class: "chip", text: l }))));
  if (k.notiz) zeile("Notiz", el("div", { class: "notiz", text: k.notiz }));
  zeile("Geändert", `${zeitText(k.geaendert)}${k.quelle ? ` (${k.quelle})` : ""}`);

  const knoepfe = el("div", { class: "zeile-knoepfe" });
  if (k.geloescht) {
    knoepfe.append(el("button", { class: "knopf haupt", type: "button", text: "Wiederherstellen", onclick: () => wiederherstellen(k) }));
    if (Z.speicher.modus === "master") knoepfe.append(el("button", { class: "knopf gefahr", type: "button", text: "Endgültig löschen", onclick: () => endgueltig(k) }));
  } else {
    knoepfe.append(el("button", { class: "knopf haupt", type: "button", text: "Bearbeiten", onclick: () => zeigeMaske(k) }),
      el("button", { class: "knopf gefahr", type: "button", text: "Löschen", onclick: () => loeschen(k) }));
  }
  const firmaZeile = [k.funktion, k.abteilung, (k.vorname || k.nachname) ? k.firma : ""].filter(Boolean).join(" · ");
  oeffneDetail(el("article", { class: "karte" }, zurueckKnopf(),
    el("h2", { text: (k.favorit ? "★ " : "") + Pruefung.anzeigename(k) }),
    firmaZeile ? el("p", { class: "unterzeile", text: firmaZeile }) : null,
    k.lokal ? el("p", { class: "msg hinweis", text: "Lokale Änderung, wird beim nächsten Sync an den Master übertragen." }) : null,
    dl, knoepfe));
}

async function loeschen(k) {
  const ok = await frage("Kontakt löschen?", `«${Pruefung.anzeigename(k)}» kommt in den Papierkorb und wird beim nächsten Sync auch in Google Kontakte gelöscht. Wiederherstellen ist ${Z.status.modus === "master" ? 30 : "am Master 30"} Tage lang möglich.`, "Löschen", "Abbrechen", true);
  if (!ok) return;
  try { await Z.speicher.loeschen(k.id); meldung("In den Papierkorb verschoben"); schliesseDetail(); await laden(); }
  catch (e) { meldung(e.message); }
}
async function wiederherstellen(k) {
  try { await Z.speicher.wiederherstellen(k.id); meldung("Wiederhergestellt"); schliesseDetail(); await laden(); }
  catch (e) { meldung(e.message); }
}
async function endgueltig(k) {
  const ok = await frage("Endgültig löschen?", `«${Pruefung.anzeigename(k)}» wird aus der Master-DB entfernt. Das kann nicht rückgängig gemacht werden (ausser über eine Sicherung).`, "Endgültig löschen", "Abbrechen", true);
  if (!ok) return;
  try { await Z.speicher.endgueltig(k.id); meldung("Endgültig gelöscht"); schliesseDetail(); await laden(); }
  catch (e) { meldung(e.message); }
}

// --- Eingabemaske -----------------------------------------------------------

function optionen(liste, wert) {
  const alle = wert && !liste.includes(wert) ? [...liste, wert] : liste;
  return alle.map((x) => el("option", { value: x, text: x, selected: x === wert }));
}

function landOptionen(wert) {
  const laender = Object.entries(Pruefung.LAENDER).sort((a, b) => a[1].localeCompare(b[1], "de"));
  const opts = [el("option", { value: "", text: "(kein Land)" })];
  for (const code of ["CH", "DE", "AT"]) opts.push(el("option", { value: code, text: Pruefung.LAENDER[code], selected: code === wert }));
  opts.push(el("option", { disabled: true, text: "──────────" }));
  for (const [code, name] of laender) if (!["CH", "DE", "AT"].includes(code)) opts.push(el("option", { value: code, text: name, selected: code === wert }));
  if (wert && !Pruefung.LAENDER[wert]) opts.push(el("option", { value: wert, text: wert, selected: true }));
  return opts;
}

function feld(name, titel, wert, attr = {}) {
  const id = "f-" + name.replace(/\./g, "-");
  const eingabe = attr.mehrzeilig
    ? el("textarea", { id, "data-feld": name, rows: 4 }, wert || "")
    : el("input", { id, "data-feld": name, value: wert || "", type: attr.type || "text", inputmode: attr.inputmode,
      autocomplete: attr.autocomplete || "off", placeholder: attr.placeholder });
  return el("div", { class: "feld" + (attr.breit ? " breit" : "") },
    el("label", { for: id, class: attr.pflicht ? "pflicht" : null, text: titel }), eingabe,
    el("div", { class: "msg", "data-msg": name }));
}

function zeigeMaske(k) {
  const neu = !k || !k.id;
  const daten = JSON.parse(JSON.stringify(k ? { ...Pruefung.leererKontakt(), ...k } : Pruefung.leererKontakt()));
  if (!daten.telefone.length) daten.telefone.push({ nummer: "", typ: "Mobil" });
  if (!daten.emails.length) daten.emails.push({ adresse: "", typ: "Privat" });
  daten.geburtstag = geburtstagText(daten.geburtstag);
  Z.maske = { id: neu ? null : k.id, version: neu ? null : k.version, daten, geaendert: false, original: k };
  Z.gewaehlt = k || null;
  zeichneMaske();
}

function zeichneMaske() {
  const m = Z.maske, d = m.daten, s = Z.status;
  const form = el("form", { class: "maske", novalidate: true, onsubmit: (e) => { e.preventDefault(); speichern(false); },
    oninput: () => { m.geaendert = true; leseMaske(); validiereSpaeter(); } });

  form.append(el("fieldset", {}, el("legend", { text: "Person und Firma" }),
    el("div", { class: "raster" },
      feld("vorname", "Vorname", d.vorname, { pflicht: true, autocomplete: "off" }),
      feld("nachname", "Nachname", d.nachname),
      feld("firma", "Firma", d.firma, { breit: true }),
      feld("funktion", "Funktion", d.funktion),
      feld("abteilung", "Abteilung", d.abteilung))));

  const tel = el("div", { class: "mehrfach" });
  d.telefone.forEach((t, i) => {
    const id = `f-telefone-${i}-nummer`;
    tel.append(el("div", {},
      el("div", { class: "mehrfach-zeile" },
        el("input", { id, "data-feld": `telefone.${i}.nummer`, value: t.nummer, type: "tel", inputmode: "tel",
          placeholder: "+41 79 123 45 67", "aria-label": `Telefon ${i + 1}` }),
        el("select", { "data-feld": `telefone.${i}.typ`, "aria-label": "Typ" }, optionen(s.telefon_typen, t.typ)),
        el("button", { class: "weg", type: "button", title: "Entfernen", text: "×", onclick: () => zeileWeg("telefone", i) })),
      el("div", { class: "msg", "data-msg": `telefone.${i}.nummer` })));
  });
  tel.append(el("button", { class: "dazu", type: "button", text: "+ Telefon", onclick: () => zeileDazu("telefone", { nummer: "", typ: "Mobil" }) }));
  form.append(el("fieldset", {}, el("legend", { text: "Telefon" }), tel));

  const mail = el("div", { class: "mehrfach" });
  d.emails.forEach((e, i) => {
    mail.append(el("div", {},
      el("div", { class: "mehrfach-zeile" },
        el("input", { "data-feld": `emails.${i}.adresse`, value: e.adresse, type: "email", inputmode: "email",
          placeholder: "name@domain.ch", "aria-label": `E-Mail ${i + 1}`, autocomplete: "off" }),
        el("select", { "data-feld": `emails.${i}.typ`, "aria-label": "Typ" }, optionen(s.email_typen, e.typ)),
        el("button", { class: "weg", type: "button", title: "Entfernen", text: "×", onclick: () => zeileWeg("emails", i) })),
      el("div", { class: "msg", "data-msg": `emails.${i}.adresse` })));
  });
  mail.append(el("button", { class: "dazu", type: "button", text: "+ E-Mail", onclick: () => zeileDazu("emails", { adresse: "", typ: "Privat" }) }));
  form.append(el("fieldset", {}, el("legend", { text: "E-Mail" }), mail));

  const adr = el("div", { class: "mehrfach" });
  d.adressen.forEach((a, i) => {
    const f = (x) => `adressen.${i}.${x}`;
    adr.append(el("div", { class: "adress-zeile" },
      el("div", { class: "strasse" }, el("input", { "data-feld": f("strasse"), value: a.strasse, placeholder: "Strasse und Nr.", "aria-label": "Strasse" })),
      el("button", { class: "weg", type: "button", title: "Entfernen", text: "×", onclick: () => zeileWeg("adressen", i) }),
      el("div", {}, el("input", { "data-feld": f("plz"), value: a.plz, placeholder: "PLZ", inputmode: "numeric", "aria-label": "PLZ" }),
        el("div", { class: "msg", "data-msg": f("plz") })),
      el("div", { style: "grid-column: span 2" }, el("input", { "data-feld": f("ort"), value: a.ort, placeholder: "Ort", "aria-label": "Ort" }),
        el("div", { class: "msg", "data-msg": f("ort") })),
      el("div", { class: "land" }, el("select", { "data-feld": f("land"), "aria-label": "Land" }, landOptionen(a.land)),
        el("div", { class: "msg", "data-msg": f("land") })),
      el("div", { class: "typ" }, el("select", { "data-feld": f("typ"), "aria-label": "Typ" }, optionen(s.adress_typen, a.typ))),
      el("input", { type: "hidden", "data-feld": f("region"), value: a.region || "" })));
  });
  adr.append(el("button", { class: "dazu", type: "button", text: "+ Adresse",
    onclick: () => zeileDazu("adressen", { strasse: "", plz: "", ort: "", region: "", land: "CH", typ: "Privat" }) }));
  form.append(el("fieldset", {}, el("legend", { text: "Adresse" }), adr));

  const web = el("div", { class: "mehrfach" });
  d.websites.forEach((w, i) => {
    web.append(el("div", {}, el("div", { class: "mehrfach-zeile", style: "grid-template-columns: minmax(0,1fr) 36px" },
      el("input", { "data-feld": `websites.${i}`, value: w, type: "url", inputmode: "url", placeholder: "www.beispiel.ch", "aria-label": "Website" }),
      el("button", { class: "weg", type: "button", title: "Entfernen", text: "×", onclick: () => zeileWeg("websites", i) })),
      el("div", { class: "msg", "data-msg": `websites.${i}` })));
  });
  web.append(el("button", { class: "dazu", type: "button", text: "+ Website", onclick: () => zeileDazu("websites", "") }));

  const labelBox = el("div", { class: "chips" });
  const alle = [...new Set([...(Z.alleLabels || []), ...d.labels])].sort((a, b) => a.localeCompare(b, "de"));
  for (const l of alle) {
    labelBox.append(el("button", { type: "button", class: "chip" + (d.labels.includes(l) ? " an" : ""), text: l,
      onclick: () => { leseMaske(); d.labels = d.labels.includes(l) ? d.labels.filter((x) => x !== l) : [...d.labels, l]; m.geaendert = true; zeichneMaske(); } }));
  }
  const neuLabel = el("input", { placeholder: "Neues Label + Enter", style: "max-width: 200px; min-height: 30px; padding: 3px 8px",
    onkeydown: (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const wert = e.target.value.trim();
      if (wert) { leseMaske(); d.labels = [...d.labels, wert]; m.geaendert = true; zeichneMaske(); }
    } });
  labelBox.append(neuLabel);

  form.append(el("fieldset", {}, el("legend", { text: "Weiteres" }),
    el("div", { class: "raster" },
      feld("geburtstag", "Geburtstag (TT.MM.JJJJ oder TT.MM.)", d.geburtstag, { placeholder: "07.01.1962", inputmode: "numeric" }),
      el("div", { class: "feld" }, el("label", { text: " " }),
        el("label", { class: "checkzeile" }, el("input", { type: "checkbox", "data-feld": "favorit", checked: d.favorit }), "Favorit")),
      el("div", { class: "feld breit" }, el("label", { text: "Websites" }), web),
      el("div", { class: "feld breit" }, el("label", { text: "Labels" }), labelBox),
      feld("notiz", "Notiz", d.notiz, { breit: true, mehrzeilig: true }))));

  form.append(el("div", { class: "zeile-knoepfe" },
    el("button", { class: "knopf haupt", type: "submit", text: "Speichern" }),
    el("button", { class: "knopf", type: "button", text: "Abbrechen", onclick: abbrechen }),
    m.id ? el("button", { class: "knopf gefahr", type: "button", text: "Löschen", onclick: () => loeschen(m.original) }) : null));

  oeffneDetail(el("article", { class: "karte" }, zurueckKnopf(),
    el("h2", { text: m.id ? "Kontakt bearbeiten" : "Neuer Kontakt" }),
    el("p", { class: "unterzeile", text: "Felder mit * : mindestens Vorname, Nachname oder Firma." }),
    el("div", { id: "zusammenfassung" }), form));
  validiere();
}

function leseMaske() {
  const d = Z.maske.daten;
  for (const e of document.querySelectorAll(".maske [data-feld]")) {
    const pfad = e.dataset.feld.split(".");
    const wert = e.type === "checkbox" ? e.checked : e.value;
    if (pfad.length === 1) d[pfad[0]] = wert;
    else if (pfad.length === 2) d[pfad[0]][+pfad[1]] = wert;
    else d[pfad[0]][+pfad[1]][pfad[2]] = wert;
  }
}

function zeileDazu(liste, leer) { leseMaske(); Z.maske.daten[liste].push(leer); Z.maske.geaendert = true; zeichneMaske(); }
function zeileWeg(liste, i) { leseMaske(); Z.maske.daten[liste].splice(i, 1); Z.maske.geaendert = true; zeichneMaske(); }

function validiereSpaeter() { clearTimeout(validiereSpaeter.t); validiereSpaeter.t = setTimeout(validiere, 250); }

// Zeigt Fehler, Hinweise und die vereinheitlichte Schreibweise direkt unter den Feldern
function validiere() {
  if (!Z.maske) return null;
  const erg = Pruefung.pruefeKontakt(Z.maske.daten);
  const d = Z.maske.daten;
  for (const m of document.querySelectorAll(".maske [data-msg]")) { m.textContent = ""; m.className = "msg"; }
  for (const e of document.querySelectorAll(".maske [data-feld]")) e.classList.remove("feld-fehler", "feld-hinweis");
  const setze = (feld, text, art) => {
    const m = document.querySelector(`.maske [data-msg="${feld}"]`);
    const e = document.querySelector(`.maske [data-feld="${feld}"]`);
    if (m && !m.textContent) { m.textContent = text; m.className = "msg " + art; }
    if (e && art !== "vorschau") e.classList.add(art === "fehler" ? "feld-fehler" : "feld-hinweis");
  };
  for (const x of erg.fehler) setze(x.feld, x.meldung, "fehler");
  for (const x of erg.hinweise) setze(x.feld, x.meldung, "hinweis");
  // Vorschau der Schreibweise, wie sie gespeichert wird
  let j = 0;
  d.telefone.forEach((t, i) => {
    if (!String(t.nummer).trim()) return;
    const n = erg.kontakt.telefone[j++];
    if (n && n.nummer !== t.nummer.trim() && !erg.fehler.some((x) => x.feld === `telefone.${i}.nummer`))
      setze(`telefone.${i}.nummer`, `wird gespeichert als ${n.nummer}${n.typ !== t.typ ? ` (${n.typ})` : ""}`, "vorschau");
  });
  const zf = $("zusammenfassung");
  if (zf) zf.replaceChildren();
  return erg;
}

async function speichern(bestaetigt) {
  leseMaske();
  const erg = validiere();
  const m = Z.maske;
  if (erg.fehler.length) {
    $("zusammenfassung").replaceChildren(el("div", { class: "zusammenfassung fehler" },
      el("b", { text: `Bitte ${erg.fehler.length} Fehler korrigieren:` }),
      el("ul", {}, erg.fehler.map((x) => el("li", { text: `${feldName(x.feld)}: ${x.meldung}` })))));
    const erstes = document.querySelector(".maske .feld-fehler");
    if (erstes) erstes.focus();
    return;
  }
  const daten = { ...m.daten };
  try {
    const k = await Z.speicher.speichern(daten, m.id, m.version, bestaetigt);
    m.geaendert = false;
    meldung(Z.speicher.modus === "master" ? "Gespeichert" : "Gespeichert, wird beim nächsten Sync übertragen");
    Z.maske = null;
    await laden();
    const neu = [...Z.kontakte].find((x) => x.id === k.id);
    if (neu) zeigeDetail(neu); else schliesseDetail();
  } catch (e) {
    if (!(e instanceof EingabeFehler)) return meldung(e.message, 6000);
    const r = e.ergebnis;
    if (r.fehler && r.fehler.length) {
      $("zusammenfassung").replaceChildren(el("div", { class: "zusammenfassung fehler" },
        el("ul", {}, r.fehler.map((x) => el("li", { text: `${feldName(x.feld)}: ${x.meldung}` })))));
      return;
    }
    const ok = await frage("Bitte prüfen", el("div", {}, el("p", { text: "Die Eingabe ist gültig, aber:" }),
      el("ul", {}, r.hinweise.map((x) => el("li", { text: `${feldName(x.feld)}: ${x.meldung}` })))),
    "Trotzdem speichern", "Zurück zur Maske");
    if (ok) speichern(true);
  }
}

async function maskeVerlassen() {
  if (!Z.maske || !Z.maske.geaendert) return true;
  return frage("Änderungen verwerfen?", "Die Eingaben in der Maske sind noch nicht gespeichert.", "Verwerfen", "Weiter bearbeiten", true);
}

async function abbrechen() {
  if (!(await maskeVerlassen())) return;
  const k = Z.maske && Z.maske.original;
  Z.maske = null;
  if (k && k.id) zeigeDetail(k); else { schliesseDetail(); zeigeAnsicht(); }
}

// --- Synchronisation --------------------------------------------------------

function syncText(r) {
  if (Z.speicher.modus !== "master") {
    return r.hinweis || `${r.hochgeladen} Änderung(en) hochgeladen, ${r.kontakte} Kontakte geladen`;
  }
  const teile = [];
  if (r.geraete) teile.push(r.geraete.uebersprungen ? `Geräte: ${r.geraete.uebersprungen}` : `Geräte: ${r.geraete.uebernommen} übernommen, ${r.geraete.konflikte} Konflikt(e)`);
  if (r.google) teile.push(r.google.uebersprungen ? `Google: ${r.google.uebersprungen}` : `Google: ${r.google.zusammenfassung}`);
  if (r.sicherung) teile.push(r.sicherung.uebersprungen ? `Sicherung: ${r.sicherung.uebersprungen}` : "Sicherung in Google Drive geschrieben");
  if (r.fehler && r.fehler.length) teile.push("Fehler: " + r.fehler.join("; "));
  return teile.join(" · ");
}

async function sync() {
  const b = $("btn-sync");
  if (b.disabled) return;
  b.disabled = true; b.classList.add("dreht");
  try {
    const r = await Z.speicher.sync();
    meldung(syncText(r), 9000);
    await laden();
  } catch (e) {
    meldung("Sync fehlgeschlagen: " + e.message, 9000);
  } finally {
    b.disabled = false; b.classList.remove("dreht");
  }
}

// --- Start ------------------------------------------------------------------

async function start() {
  ansichtLaden();
  Z.speicher = await waehleSpeicher();
  $("reiter").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-ansicht]");
    if (b && (await maskeVerlassen())) setzeReiter(b.dataset.ansicht);
  });
  $("suche").addEventListener("input", (e) => { Z.suche = e.target.value.trim(); zeigeListe(); });
  $("sortierung").addEventListener("change", (e) => { Z.sortierung = e.target.value; ansichtMerken(); zeigeListe(); });
  for (const feld of Object.keys(Z.filter)) {
    $("filter-" + feld).addEventListener("change", (e) => {
      Z.filter[feld] = e.target.value; ansichtMerken(); zeigeFilterWerte(); zeigeListe();
    });
  }
  $("btn-filter").addEventListener("click", () => {
    const offen = $("filterfeld").hidden;
    $("filterfeld").hidden = !offen;
    $("btn-filter").setAttribute("aria-expanded", String(offen));
  });
  $("btn-filter-weg").addEventListener("click", () => {
    for (const feld of Object.keys(Z.filter)) Z.filter[feld] = "";
    ansichtMerken(); zeigeFilterWerte(); zeigeListe();
  });
  // Höhe des Kopfbereichs für die mitlaufende Detailspalte
  const kopf = document.querySelector(".kopf");
  const kopfHoehe = () => document.documentElement.style.setProperty("--kopf-h", kopf.offsetHeight + "px");
  kopfHoehe();
  if (window.ResizeObserver) new ResizeObserver(kopfHoehe).observe(kopf);
  $("btn-neu").addEventListener("click", async () => { if (await maskeVerlassen()) zeigeMaske(null); });
  $("btn-sync").addEventListener("click", sync);
  window.addEventListener("beforeunload", (e) => { if (Z.maske && Z.maske.geaendert) e.preventDefault(); });
  if ("serviceWorker" in navigator && Z.speicher.modus === "offline" && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  await laden();
}

start().catch((e) => meldung("Fehler beim Start: " + e.message, 10000));
