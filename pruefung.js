// Prüfung und Vereinheitlichung der Kontaktfelder.
// Gleiche Regeln wie app/pruefung.py; beide werden mit tests/pruefung_faelle.json getestet.
"use strict";

const Pruefung = (() => {
  const TELEFON_TYPEN = ["Mobil", "Privat", "Arbeit", "Haupt", "Fax Arbeit", "Fax Privat", "Pager", "Intern", "Andere"];
  const EMAIL_TYPEN = ["Privat", "Arbeit", "Andere"];
  const ADRESS_TYPEN = ["Privat", "Arbeit", "Andere"];
  const LAENDER = {
    CH: "Schweiz", DE: "Deutschland", AT: "Österreich", LI: "Liechtenstein", FR: "Frankreich",
    IT: "Italien", ES: "Spanien", PT: "Portugal", NL: "Niederlande", BE: "Belgien", LU: "Luxemburg",
    GB: "Vereinigtes Königreich", US: "USA", CA: "Kanada", BR: "Brasilien", CO: "Kolumbien",
    ID: "Indonesien", PL: "Polen", CZ: "Tschechien", HU: "Ungarn", HR: "Kroatien", GR: "Griechenland",
    TR: "Türkei", SE: "Schweden", NO: "Norwegen", DK: "Dänemark", FI: "Finnland", IE: "Irland",
    TH: "Thailand", AU: "Australien",
  };
  const LANDESVORWAHL = { CH: "41", DE: "49", AT: "43", LI: "423", FR: "33", IT: "39", ES: "34",
    NL: "31", BE: "32", LU: "352", GB: "44", PT: "351" };
  const CC1 = new Set(["1", "7"]);
  const CC2 = new Set(("20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 " +
    "60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98").split(" "));
  const PLZ_MUSTER = {
    CH: [/^[1-9]\d{3}$/, "4 Ziffern, z. B. 3007"], LI: [/^94\d{2}$/, "4 Ziffern, z. B. 9490"],
    AT: [/^[1-9]\d{3}$/, "4 Ziffern, z. B. 1010"], DE: [/^\d{5}$/, "5 Ziffern, z. B. 80331"],
    FR: [/^\d{5}$/, "5 Ziffern"], IT: [/^\d{5}$/, "5 Ziffern"], ES: [/^\d{5}$/, "5 Ziffern"],
    NL: [/^\d{4} ?[A-Z]{2}$/, "z. B. 1012 AB"],
  };
  const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
  const EMAIL_TIPPFEHLER = { "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmail.co": "gmail.com",
    "gmail.ch": "gmail.com", "gmail.de": "gmail.com", "gmx.c": "gmx.ch", "hotmial.com": "hotmail.com",
    "bluewin.com": "bluewin.ch", "yahooo.com": "yahoo.com", "googlemail.co": "googlemail.com" };
  const URL_MUSTER = /^https?:\/\/[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:\d+)?([/?#]\S*)?$/;
  const MAX_LAENGE = { vorname: 80, nachname: 80, firma: 120, funktion: 120, abteilung: 120, notiz: 20000 };

  const s = (w) => (w === null || w === undefined ? "" : String(w).trim());
  const ws = (w) => s(w).replace(/\s+/g, " ");

  function abschneiden(gruppen, anzahl) {
    gruppen = gruppen.slice();
    while (anzahl > 0 && gruppen.length) {
      const g = gruppen[0];
      if (g.length <= anzahl) { anzahl -= g.length; gruppen.shift(); }
      else { gruppen[0] = g.slice(anzahl); anzahl = 0; }
    }
    return gruppen;
  }
  function kennzahl(z) {
    if (CC1.has(z.slice(0, 1))) return z.slice(0, 1);
    if (CC2.has(z.slice(0, 2))) return z.slice(0, 2);
    return z.slice(0, 3);
  }
  function formatCH(n) {
    if ("89".includes(n[0])) return `+41 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
    return `+41 ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5, 7)} ${n.slice(7)}`;
  }

  // Gibt [wert, fehler, hinweis] zurück
  function telefon(roh, land = "CH") {
    let text = s(String(roh ?? "").replace(/[​-‏‪-‮⁦-⁩﻿]/g, ""));
    if (!text) return ["", "Nummer fehlt", null];
    if (/[^0-9+()\-./\s]/.test(text)) return [text, "Nur Ziffern, Leerzeichen, + ( ) - / . erlaubt", null];
    if (text.slice(1).includes("+")) return [text, "Das + darf nur am Anfang stehen", null];
    text = text.split("(0)").join(" ");
    let gruppen = text.match(/\d+/g) || [];
    const ziffern = gruppen.join("");
    let hinweis = null, intl;
    land = land || "CH";
    if (text.startsWith("+")) intl = ziffern;
    else if (ziffern.startsWith("00")) { intl = ziffern.slice(2); gruppen = abschneiden(gruppen, 2); }
    else if (ziffern.startsWith("0")) {
      const cc = LANDESVORWAHL[land] || "41";
      if (!LANDESVORWAHL[land]) hinweis = "Ohne Landesvorwahl als Schweizer Nummer übernommen";
      intl = cc + ziffern.slice(1);
      gruppen = [cc, ...abschneiden(gruppen, 1)];
    } else {
      if (ziffern.length >= 3 && ziffern.length <= 6) return [ziffern, null, "Kurz- oder interne Nummer ohne Vorwahl"];
      return [text, "Vorwahl fehlt: mit +41, 0041 oder 0 beginnen", null];
    }
    if (intl.length < 4) return [text, "Nummer zu kurz", null];
    const cc = kennzahl(intl);
    gruppen = abschneiden(gruppen, cc.length);
    let nsn = intl.slice(cc.length);
    if (nsn.startsWith("0") && cc !== "39") {
      nsn = nsn.slice(1); gruppen = abschneiden(gruppen, 1);
      hinweis = "Führende 0 nach der Landesvorwahl entfernt";
    }
    if (cc === "41") {
      if (nsn.length !== 9) return [text, `Schweizer Nummern haben 9 Ziffern nach +41 (hier ${nsn.length})`, null];
      return [formatCH(nsn), null, hinweis];
    }
    if (cc === "423" && nsn.length !== 7) return [text, "Liechtensteiner Nummern haben 7 Ziffern nach +423", null];
    if (cc === "49") {
      if (nsn.length < 6 || nsn.length > 13) return [text, "Deutsche Nummern haben 6 bis 13 Ziffern nach +49", null];
      if (nsn.startsWith("15")) return [`+49 ${nsn.slice(0, 4)} ${nsn.slice(4)}`, null, hinweis];
      if (["16", "17"].includes(nsn.slice(0, 2))) return [`+49 ${nsn.slice(0, 3)} ${nsn.slice(3)}`, null, hinweis];
    }
    if (cc === "1") {
      if (nsn.length !== 10) return [text, "Nummern mit +1 haben 10 Ziffern", null];
      return [`+1 ${nsn.slice(0, 3)} ${nsn.slice(3, 6)} ${nsn.slice(6)}`, null, hinweis];
    }
    if ((cc + nsn).length < 8 || (cc + nsn).length > 15) return [text, "Internationale Nummern haben 8 bis 15 Ziffern", null];
    const rest = gruppen.filter(Boolean).join(" ") || nsn;
    return [`+${cc} ${rest}`, null, hinweis];
  }

  function email(roh) {
    const text = s(roh);
    if (!text) return ["", "E-Mail fehlt", null];
    if (text.includes(" ")) return [text, "E-Mail darf keine Leerzeichen enthalten", null];
    if (text.split("@").length !== 2) return [text, "E-Mail braucht genau ein @", null];
    let [lokal, domain] = text.split("@");
    domain = domain.toLowerCase().replace(/\.+$/, "");
    const wert = `${lokal}@${domain}`;
    if (lokal.length > 64 || wert.includes("..") || lokal.startsWith(".") || lokal.endsWith("."))
      return [text, "Ungültiger Teil vor dem @", null];
    if (!EMAIL.test(wert)) return [text, "Ungültige E-Mail-Adresse (Beispiel: name@domain.ch)", null];
    if (EMAIL_TIPPFEHLER[domain]) return [wert, null, `Tippfehler? Meinten Sie @${EMAIL_TIPPFEHLER[domain]}`];
    return [wert, null, null];
  }

  function plz(roh, land) {
    let text = s(roh).toUpperCase();
    if (!text) return ["", null];
    const m = PLZ_MUSTER[land || ""];
    if (m) {
      if (land === "NL") text = text.replace(/^(\d{4})\s*([A-Z]{2})$/, "$1 $2");
      if (!m[0].test(text)) return [text, `PLZ für ${LAENDER[land] || land}: ${m[1]}`];
    } else if (!/^[A-Z0-9 -]{2,10}$/.test(text)) {
      return [text, "PLZ: 2 bis 10 Zeichen, nur Buchstaben, Ziffern, Leerzeichen, -"];
    }
    return [text, null];
  }

  function gueltigesDatum(j, m, t) {
    const d = new Date(Date.UTC(j, m - 1, t));
    return d.getUTCFullYear() === j && d.getUTCMonth() === m - 1 && d.getUTCDate() === t;
  }
  const zwei = (n) => String(n).padStart(2, "0");

  function geburtstag(roh, heute) {
    const text = s(roh);
    if (!text) return ["", null];
    heute = heute || new Date();
    let j = null, mo, t, m;
    if ((m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/))) { j = +m[1]; mo = +m[2]; t = +m[3]; }
    else if ((m = text.match(/^--(\d{2})-(\d{2})$/))) { mo = +m[1]; t = +m[2]; }
    else if ((m = text.match(/^(\d{1,2})\.(\d{1,2})\.?$/))) { t = +m[1]; mo = +m[2]; }
    else if ((m = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) { t = +m[1]; mo = +m[2]; j = +m[3]; }
    else return [text, "Datum als TT.MM.JJJJ oder TT.MM. eingeben"];
    if (!gueltigesDatum(j === null ? 2000 : j, mo, t)) return [text, "Dieses Datum gibt es nicht"];
    if (j !== null) {
      if (j < 1900) return [text, "Jahr vor 1900"];
      const iso = `${j}-${zwei(mo)}-${zwei(t)}`;
      const h = typeof heute === "string" ? heute
        : `${heute.getFullYear()}-${zwei(heute.getMonth() + 1)}-${zwei(heute.getDate())}`;
      if (iso > h) return [text, "Geburtstag liegt in der Zukunft"];
      return [iso, null];
    }
    return [`--${zwei(mo)}-${zwei(t)}`, null];
  }

  function url(roh) {
    let text = s(roh);
    if (!text) return ["", null];
    if (!/^[a-z]+:\/\//i.test(text)) text = "https://" + text;
    if (!URL_MUSTER.test(text)) return [s(roh), "Ungültige Webadresse (Beispiel: www.beispiel.ch)"];
    return [text, null];
  }

  function landCode(roh) {
    const text = s(roh);
    if (!text) return "";
    if (LAENDER[text.toUpperCase()]) return text.toUpperCase();
    const namen = { switzerland: "CH", suisse: "CH", svizzera: "CH", germany: "DE", austria: "AT" };
    for (const [k, v] of Object.entries(LAENDER)) namen[v.toLowerCase()] = k;
    return namen[text.toLowerCase()] || text;
  }

  const leererKontakt = () => ({ vorname: "", nachname: "", firma: "", funktion: "", abteilung: "",
    telefone: [], emails: [], adressen: [], geburtstag: "", labels: [], favorit: false, websites: [], notiz: "" });

  function pruefeKontakt(daten, heute) {
    const k = leererKontakt(), fehler = [], hinweise = [];
    const f = (feld, meldung) => fehler.push({ feld, meldung });
    const h = (feld, meldung) => hinweise.push({ feld, meldung });
    for (const feld of ["vorname", "nachname", "firma", "funktion", "abteilung", "notiz"]) {
      const wert = feld === "notiz" ? s(daten[feld]) : ws(daten[feld]);
      k[feld] = wert;
      if (wert.length > MAX_LAENGE[feld]) f(feld, `Höchstens ${MAX_LAENGE[feld]} Zeichen`);
    }
    if (!(k.vorname || k.nachname || k.firma)) f("vorname", "Vorname, Nachname oder Firma angeben");
    for (const feld of ["vorname", "nachname"]) {
      if (k[feld].includes("@")) f(feld, "E-Mail-Adresse gehört ins Feld E-Mail");
      else if (/\d/.test(k[feld])) h(feld, "Name enthält Ziffern");
    }
    const adressen = (daten.adressen || []).filter((a) => ["strasse", "plz", "ort", "region", "land"].some((x) => s(a[x])));
    const landStd = (adressen.length && landCode(adressen[0].land)) || "CH";

    let gesehen = new Set();
    (daten.telefone || []).forEach((t, i) => {
      const roh = s(t.nummer);
      let typ = s(t.typ) || "Mobil";
      if (!roh) return;
      const [wert, fe, hi] = telefon(roh, landStd);
      if (fe) f(`telefone.${i}.nummer`, fe);
      if (hi) h(`telefone.${i}.nummer`, hi);
      if (!fe && wert.replace(/\D/g, "").length === 6 && !wert.startsWith("+") && typ !== "Intern") typ = "Intern";
      const sch = wert.replace(/\D/g, "");
      if (gesehen.has(sch)) h(`telefone.${i}.nummer`, "Nummer ist doppelt erfasst");
      gesehen.add(sch);
      k.telefone.push({ nummer: wert, typ });
    });
    gesehen = new Set();
    (daten.emails || []).forEach((e, i) => {
      const roh = s(e.adresse);
      if (!roh) return;
      const [wert, fe, hi] = email(roh);
      if (fe) f(`emails.${i}.adresse`, fe);
      if (hi) h(`emails.${i}.adresse`, hi);
      if (gesehen.has(wert.toLowerCase())) h(`emails.${i}.adresse`, "E-Mail ist doppelt erfasst");
      gesehen.add(wert.toLowerCase());
      k.emails.push({ adresse: wert, typ: s(e.typ) || "Privat" });
    });
    adressen.forEach((a, i) => {
      const land = landCode(a.land);
      if (land && !LAENDER[land]) h(`adressen.${i}.land`, "Unbekanntes Land, bitte aus der Liste wählen");
      const [p, fe] = plz(a.plz, land);
      if (fe) f(`adressen.${i}.plz`, fe);
      const adr = { strasse: ws(a.strasse), plz: p, ort: ws(a.ort), region: s(a.region), land, typ: s(a.typ) || "Privat" };
      if ((adr.strasse || adr.plz) && !adr.ort) f(`adressen.${i}.ort`, "Ort fehlt");
      if (adr.ort && /\d{4,5}/.test(adr.ort)) h(`adressen.${i}.ort`, "Ort enthält eine Zahl, gehört sie ins Feld PLZ?");
      k.adressen.push(adr);
    });
    const [gb, gfe] = geburtstag(daten.geburtstag, heute);
    if (gfe) f("geburtstag", gfe);
    k.geburtstag = gb;
    (daten.websites || []).forEach((w, i) => {
      if (!s(w)) return;
      const [wert, fe] = url(w);
      if (fe) f(`websites.${i}`, fe);
      k.websites.push(wert);
    });
    const labels = [];
    for (let lab of daten.labels || []) {
      lab = ws(lab);
      if (lab && !labels.some((x) => x.toLowerCase() === lab.toLowerCase())) labels.push(lab);
    }
    k.labels = labels.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    k.favorit = !!daten.favorit;
    return { kontakt: k, fehler, hinweise };
  }

  function anzeigename(k) {
    const name = [k.vorname, k.nachname].filter(Boolean).join(" ");
    return name || k.firma || "(ohne Namen)";
  }

  function dublettenHinweise(liste, k, eigeneId) {
    const hinweise = [];
    const name = anzeigename(k).toLowerCase();
    const nummern = new Map(k.telefone.map((t, i) => [t.nummer.replace(/\D/g, ""), i]));
    const mails = new Map(k.emails.map((e, i) => [e.adresse.toLowerCase(), i]));
    for (const a of liste) {
      if (a.id === eigeneId || a.geloescht) continue;
      const an = anzeigename(a);
      if (name !== "(ohne namen)" && an.toLowerCase() === name)
        hinweise.push({ feld: "vorname", meldung: `Gleicher Name wie bestehender Kontakt «${an}»`, kontakt_id: a.id });
      for (const t of a.telefone || []) {
        const z = t.nummer.replace(/\D/g, "");
        if (nummern.has(z) && z.length > 6)
          hinweise.push({ feld: `telefone.${nummern.get(z)}.nummer`, meldung: `Nummer gehört auch zu «${an}»`, kontakt_id: a.id });
      }
      for (const e of a.emails || []) {
        const z = e.adresse.toLowerCase();
        if (mails.has(z)) hinweise.push({ feld: `emails.${mails.get(z)}.adresse`, meldung: `E-Mail gehört auch zu «${an}»`, kontakt_id: a.id });
      }
    }
    return hinweise;
  }

  return { TELEFON_TYPEN, EMAIL_TYPEN, ADRESS_TYPEN, LAENDER, telefon, email, plz, geburtstag, url,
    landCode, leererKontakt, pruefeKontakt, anzeigename, dublettenHinweise };
})();

if (typeof module !== "undefined") module.exports = Pruefung;
