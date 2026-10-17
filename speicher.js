// Datenanbindung der Oberfläche.
// MasterSpeicher: am Master-PC, spricht mit app/server.py (Master-DB).
// OfflineSpeicher: Handy und weitere Rechner. Daten liegen im Browser (IndexedDB);
//   Abgleich über den App-Ordner in Google Drive: «stand.json» kommt vom Master,
//   eigene Änderungen gehen als «aenderung_*.json» dorthin und werden vom Master übernommen.
"use strict";

class EingabeFehler extends Error {
  constructor(ergebnis) { super("Eingabe prüfen"); this.ergebnis = ergebnis; }
}

class MasterSpeicher {
  constructor() { this.modus = "master"; }
  async _anfrage(methode, pfad, daten) {
    const r = await fetch(pfad, {
      method: methode,
      headers: { "Content-Type": "application/json", "X-Adressen": "1" },
      body: daten === undefined ? undefined : JSON.stringify(daten),
    });
    const inhalt = await r.json().catch(() => ({}));
    if (r.status === 422) throw new EingabeFehler(inhalt);
    if (!r.ok) throw new Error(inhalt.fehler || `Fehler ${r.status}`);
    return inhalt;
  }
  status() { return this._anfrage("GET", "/api/status"); }
  liste(papierkorb) { return this._anfrage("GET", "/api/kontakte" + (papierkorb ? "?papierkorb=1" : "")); }
  speichern(kontakt, id, version, bestaetigt) {
    return id ? this._anfrage("PUT", `/api/kontakte/${id}`, { kontakt, version, bestaetigt })
      : this._anfrage("POST", "/api/kontakte", { kontakt, bestaetigt });
  }
  loeschen(id) { return this._anfrage("DELETE", `/api/kontakte/${id}`); }
  wiederherstellen(id) { return this._anfrage("POST", `/api/kontakte/${id}/wiederherstellen`); }
  endgueltig(id) { return this._anfrage("DELETE", `/api/kontakte/${id}?endgueltig=1`); }
  pruefungListe() { return this._anfrage("GET", "/api/pruefung"); }
  konflikte() { return this._anfrage("GET", "/api/konflikte"); }
  konfliktLoesen(nr, aktion) { return this._anfrage("POST", `/api/konflikte/${nr}/${aktion}`); }
  protokoll() { return this._anfrage("GET", "/api/protokoll"); }
  sync() { return this._anfrage("POST", "/api/sync"); }
}

// --- IndexedDB -----------------------------------------------------------

const Lager = {
  _db: null,
  oeffnen() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((ok, fehl) => {
      const r = indexedDB.open("adressverwaltung", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("werte");
      r.onsuccess = () => { this._db = r.result; ok(this._db); };
      r.onerror = () => fehl(r.error);
    });
  },
  async hole(schluessel, standard) {
    const db = await this.oeffnen();
    return new Promise((ok, fehl) => {
      const r = db.transaction("werte").objectStore("werte").get(schluessel);
      r.onsuccess = () => ok(r.result === undefined ? standard : r.result);
      r.onerror = () => fehl(r.error);
    });
  },
  async setze(schluessel, wert) {
    const db = await this.oeffnen();
    return new Promise((ok, fehl) => {
      const t = db.transaction("werte", "readwrite");
      t.objectStore("werte").put(wert, schluessel);
      t.oncomplete = () => ok();
      t.onerror = () => fehl(t.error);
    });
  },
};

// --- Google Drive (App-Ordner) ------------------------------------------

const Drive = {
  token: null, ablauf: 0,
  async anmelden() {
    if (this.token && Date.now() < this.ablauf - 60000) return this.token;
    const clientId = (window.ADRESSEN_KONFIG || {}).googleClientId;
    if (!clientId) throw new Error("Google-Client-ID fehlt in konfig.js (siehe ANLEITUNG_Google.md)");
    if (!window.google || !google.accounts) {
      await new Promise((ok, fehl) => {
        const s = document.createElement("script");
        s.src = "https://accounts.google.com/gsi/client";
        s.onload = ok; s.onerror = () => fehl(new Error("Google-Anmeldung nicht erreichbar (offline?)"));
        document.head.appendChild(s);
      });
    }
    const antwort = await new Promise((ok, fehl) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: "https://www.googleapis.com/auth/drive.appdata",
        callback: (r) => (r.error ? fehl(new Error(r.error)) : ok(r)),
        error_callback: (e) => fehl(new Error(e.message || e.type || "Anmeldung abgebrochen")),
      });
      client.requestAccessToken({ prompt: "" });
    });
    this.token = antwort.access_token;
    this.ablauf = Date.now() + antwort.expires_in * 1000;
    return this.token;
  },
  async _anfrage(url, optionen = {}) {
    const token = await this.anmelden();
    const r = await fetch(url, { ...optionen, headers: { ...(optionen.headers || {}), Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Google Drive: ${r.status} ${await r.text()}`);
    return r;
  },
  async dateien() {
    const r = await this._anfrage("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder" +
      "&fields=files(id,name,modifiedTime)&pageSize=1000");
    return (await r.json()).files || [];
  },
  async lesen(id) {
    const r = await this._anfrage(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
    return r.json();
  },
  async hochladen(name, daten) {
    const grenze = "adressen" + Math.random().toString(36).slice(2);
    const koerper = `--${grenze}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name, parents: ["appDataFolder"] }) +
      `\r\n--${grenze}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(daten) + `\r\n--${grenze}--`;
    await this._anfrage("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST", headers: { "Content-Type": `multipart/related; boundary=${grenze}` }, body: koerper,
    });
  },
};

// --- Offline-Betrieb ------------------------------------------------------

class OfflineSpeicher {
  constructor() { this.modus = "offline"; }

  async _zustand() {
    return {
      stand: await Lager.hole("stand", { kontakte: [], verarbeitet: [], erzeugt: null }),
      offen: await Lager.hole("offen", []),          // noch nicht hochgeladen
      unterwegs: await Lager.hole("unterwegs", []),  // hochgeladen, Master hat noch nicht übernommen
    };
  }

  // Stand vom Master plus eigene, noch nicht übernommene Änderungen
  async _ansicht() {
    const z = await this._zustand();
    const karte = new Map(z.stand.kontakte.map((k) => [k.id, { ...k }]));
    const aenderungen = [...z.unterwegs.flatMap((u) => u.aenderungen), ...z.offen];
    for (const a of aenderungen) {
      const alt = karte.get(a.id);
      if (a.op === "neu" || a.op === "aendern") {
        karte.set(a.id, { ...(alt || {}), ...a.daten, id: a.id, version: alt ? alt.version : 0,
          geloescht: null, geaendert: a.zeit, lokal: true });
      } else if (a.op === "loeschen" && alt) {
        karte.set(a.id, { ...alt, geloescht: a.zeit, lokal: true });
      } else if (a.op === "wiederherstellen" && alt) {
        karte.set(a.id, { ...alt, geloescht: null, lokal: true });
      }
    }
    return [...karte.values()];
  }

  async _merken(aenderung) {
    const offen = await Lager.hole("offen", []);
    offen.push({ ...aenderung, zeit: new Date().toISOString() });
    await Lager.setze("offen", offen);
  }

  async status() {
    const z = await this._zustand();
    const liste = await this._ansicht();
    return {
      modus: "offline",
      anzahl: liste.filter((k) => !k.geloescht).length,
      papierkorb: liste.filter((k) => k.geloescht).length,
      konflikte: 0,
      letzte_sync: await Lager.hole("letzte_sync", null),
      stand_vom: z.stand.erzeugt,
      offen: z.offen.length + z.unterwegs.reduce((n, u) => n + u.aenderungen.length, 0),
      geraet: await Lager.hole("geraet", null),
      laender: Pruefung.LAENDER, telefon_typen: Pruefung.TELEFON_TYPEN,
      email_typen: Pruefung.EMAIL_TYPEN, adress_typen: Pruefung.ADRESS_TYPEN,
    };
  }

  async liste(papierkorb) {
    const liste = await this._ansicht();
    return liste.filter((k) => !!k.geloescht === !!papierkorb)
      .sort((a, b) => Pruefung.anzeigename(a).localeCompare(Pruefung.anzeigename(b), "de", { sensitivity: "base" }));
  }

  async speichern(daten, id, version, bestaetigt) {
    const erg = Pruefung.pruefeKontakt(daten);
    if (!erg.fehler.length) erg.hinweise.push(...Pruefung.dublettenHinweise(await this._ansicht(), erg.kontakt, id));
    if (erg.fehler.length || (erg.hinweise.length && !bestaetigt)) throw new EingabeFehler(erg);
    const neuId = id || crypto.randomUUID();
    await this._merken({ op: id ? "aendern" : "neu", id: neuId, basis_version: id ? version : null, daten: erg.kontakt });
    return { ...erg.kontakt, id: neuId };
  }

  async loeschen(id) {
    const k = (await this._ansicht()).find((x) => x.id === id);
    await this._merken({ op: "loeschen", id, basis_version: k ? k.version : null });
  }
  async wiederherstellen(id) {
    const k = (await this._ansicht()).find((x) => x.id === id);
    await this._merken({ op: "wiederherstellen", id, basis_version: k ? k.version : null });
  }
  async endgueltig() { throw new Error("Endgültig löschen geht nur am Master-PC."); }

  async pruefungListe() {
    const liste = [];
    for (const k of await this.liste(false)) {
      const erg = Pruefung.pruefeKontakt(k);
      if (erg.fehler.length || erg.hinweise.length)
        liste.push({ id: k.id, name: Pruefung.anzeigename(k), fehler: erg.fehler, hinweise: erg.hinweise });
    }
    return liste;
  }
  async konflikte() { return []; }
  async protokoll() {
    const z = await this._zustand();
    const eintraege = [
      ...z.offen.map((a) => ({ zeit: a.zeit, art: a.op, text: "wartet auf Synchronisation" })),
      ...z.unterwegs.flatMap((u) => u.aenderungen.map((a) => ({ zeit: a.zeit, art: a.op, text: `hochgeladen (${u.datei}), Master hat noch nicht übernommen` }))),
    ];
    return eintraege.reverse();
  }

  async sync() {
    let geraet = await Lager.hole("geraet", null);
    if (!geraet) {
      geraet = (prompt("Name dieses Geräts (z. B. Handy Andreas):", "Handy") || "Gerät").trim();
      await Lager.setze("geraet", geraet);
    }
    const bericht = { hochgeladen: 0, kontakte: 0 };
    const offen = await Lager.hole("offen", []);
    const unterwegs = await Lager.hole("unterwegs", []);
    if (offen.length) {
      const zeit = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
      const kurz = geraet.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "geraet";
      const datei = `aenderung_${kurz}_${zeit}_${Math.random().toString(36).slice(2, 6)}.json`;
      await Drive.hochladen(datei, { geraet, erstellt: new Date().toISOString(), aenderungen: offen });
      unterwegs.push({ datei, aenderungen: offen });
      await Lager.setze("unterwegs", unterwegs);
      await Lager.setze("offen", []);
      bericht.hochgeladen = offen.length;
    }
    const datei = (await Drive.dateien()).find((d) => d.name === "stand.json");
    if (datei) {
      const stand = await Drive.lesen(datei.id);
      await Lager.setze("stand", stand);
      const erledigt = new Set(stand.verarbeitet || []);
      await Lager.setze("unterwegs", unterwegs.filter((u) => !erledigt.has(u.datei)));
      bericht.kontakte = stand.kontakte.filter((k) => !k.geloescht).length;
      bericht.stand_vom = stand.erzeugt;
    } else {
      bericht.hinweis = "Noch kein Stand vom Master in Google Drive. Am Master-PC einmal synchronisieren.";
    }
    await Lager.setze("letzte_sync", new Date().toISOString());
    return bericht;
  }
}
