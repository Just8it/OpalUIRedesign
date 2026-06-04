# Datenschutzerklaerung fuer OPAL Redesign

Stand: 4. Juni 2026

Diese Datenschutzerklaerung erklaert, welche Daten die Browser-Erweiterung "OPAL Redesign" lokal verarbeitet und wann externe Dienste kontaktiert werden.

Hinweis: Dieses Dokument ist eine praktische Vorlage und ersetzt keine individuelle rechtliche Beratung. Vor einer oeffentlichen Veroeffentlichung sollte insbesondere der Verantwortliche mit vollstaendigen Kontaktdaten eingetragen werden.

## 1. Verantwortlicher

Verantwortlicher fuer die Erweiterung:

```text
Just8it
Kontakt: [Kontakt-E-Mail oder Impressums-/Kontaktlink eintragen]
Projektseite: https://github.com/Just8it/OpalUIRedesign
```

Bitte ersetze die Kontaktangabe vor einer oeffentlichen Einreichung durch eine erreichbare Kontaktadresse.

## 2. Kurzfassung

OPAL Redesign verarbeitet OPAL-Daten grundsaetzlich lokal im Browser. Die Erweiterung betreibt keinen eigenen Server und uebertraegt keine OPAL-Kursdaten an einen eigenen Backend-Dienst.

Die Erweiterung speichert lokal:

- Einstellungen der Erweiterung,
- Dashboard-Layout,
- Theme-Einstellungen,
- Suchindex-Metadaten zu OPAL-Kursen, Ordnern, Seiten und Dateien,
- Kalenderdaten, wenn sie importiert oder lokal verarbeitet werden,
- Mensa-Einstellungen und ggf. Mensa-Favoriten.

Externe Verbindungen entstehen nur fuer die technische Funktion:

- zu OPAL-Seiten, die der Nutzer bereits verwendet,
- zur Studentenwerk Dresden OpenMensa API fuer Mensa-Daten.

## 3. Welche Daten verarbeitet werden

### 3.1 Erweiterungseinstellungen

Die Erweiterung speichert lokal im Browser unter anderem:

- ob die moderne UI aktiviert ist,
- Dashboard-Layout und sichtbare Widgets,
- Theme-Modus und Akzentfarbe,
- Einstellungen fuer Kalender, Mensa, Suchindex und Vorladen.

Zweck: Bereitstellung und Personalisierung der Erweiterung.

Speicherort: lokale Browser-Speicherbereiche wie `chrome.storage.local` bzw. kompatible WebExtension-Speicher.

### 3.2 Lokaler Suchindex

Die Erweiterung kann einen lokalen Suchindex aufbauen. Dieser Index kann enthalten:

- Kurstitel,
- Seitentitel,
- Ordner- und Abschnittsnamen,
- Dateinamen und Dateiendungen,
- OPAL-URLs,
- Kurs-IDs und Parent-IDs,
- Besuchszeitpunkte,
- Indexierungszeitpunkte,
- Besuchszaehler,
- OPAL-Katalog-Metadaten wie Beschreibung, Autor, Institution, Semester oder Kurstyp, soweit diese auf OPAL-Seiten sichtbar sind.

Zweck: lokale Suche, Command Center, schnellere Navigation und Kurs-/Datei-Vorladen.

Speicherort: IndexedDB im Browser, Datenbank `OpalSearchIndex`.

Wichtig: Die Erweiterung speichert keine vollstaendigen Datei-Inhalte aus OPAL, sondern Metadaten und Links.

### 3.3 Kalenderdaten

Wenn Kalenderdaten importiert oder aus OPAL verarbeitet werden, koennen lokal gespeichert werden:

- Terminname,
- Start- und Endzeit,
- Wiederholungsinformationen,
- Quelle oder importierte Datei,
- Kalender-Einstellungen.

Zweck: Anzeige von Terminen und Fristen im Dashboard.

### 3.4 Mensa-Daten

Die Erweiterung kann Mensa-Daten von der Studentenwerk Dresden OpenMensa API abrufen. Lokal koennen gespeichert werden:

- ausgewaehlte Mensa,
- Mensa-Einstellungen,
- Favoriten oder lokale Anzeigeoptionen.

Die abgerufenen Speiseplandaten stammen von einem externen Dienst und werden fuer die Anzeige im Widget genutzt.

## 4. Externe Uebertragungen

### 4.1 OPAL

Die Erweiterung laeuft auf OPAL-Seiten unter:

```text
https://bildungsportal.sachsen.de/opal/*
```

Sie liest Inhalte aus den OPAL-Seiten, die im Browser geladen sind. Fuer bestimmte Indexierungsfunktionen kann die Erweiterung OPAL-Seiten in einem versteckten iframe laden, zum Beispiel fuer:

- Kurskatalogsuche,
- Kursdatei-Vorladen,
- Favoriten-/Kursabschnitt-Indexierung.

Diese Aufrufe gehen an OPAL selbst. Die Erweiterung sendet diese Daten nicht an einen eigenen Server.

### 4.2 OpenMensa / Studentenwerk Dresden

Die Erweiterung kann fuer Mensa-Funktionen die API des Studentenwerks Dresden abrufen:

```text
https://api.studentenwerk-dresden.de/*
```

Dabei koennen technisch uebliche Zugriffsdaten beim API-Anbieter anfallen, zum Beispiel IP-Adresse, Zeitpunkt und angefragte URL. OPAL-Kursdaten werden fuer die Mensa-Funktion nicht benoetigt.

## 5. Keine eigene Analyse, Werbung oder Tracking

Die Erweiterung verwendet nach aktuellem Stand:

- keine eigene Nutzeranalyse,
- keine Werbung,
- kein Cross-Site-Tracking,
- keine Uebermittlung von OPAL-Kursdaten an einen eigenen Backend-Server.

Im Firefox-Manifest ist die Datenkollektion als `none` deklariert.

## 6. Rechtsgrundlagen

Soweit die DSGVO anwendbar ist, kommen insbesondere folgende Rechtsgrundlagen in Betracht:

- Art. 6 Abs. 1 lit. b DSGVO, soweit die Verarbeitung erforderlich ist, um die vom Nutzer gewuenschten Funktionen der Erweiterung bereitzustellen,
- Art. 6 Abs. 1 lit. f DSGVO, soweit ein berechtigtes Interesse an einer funktionierenden, sicheren und nutzerfreundlichen Erweiterung besteht,
- Art. 6 Abs. 1 lit. a DSGVO, soweit der Nutzer freiwillig bestimmte optionale Funktionen aktiviert oder Daten importiert.

Welche Rechtsgrundlage im Einzelfall einschlaegig ist, sollte vor einer oeffentlichen Veroeffentlichung rechtlich geprueft werden.

## 7. Speicherdauer und Loeschung

Die Daten bleiben lokal gespeichert, bis:

- der Nutzer sie ueber die Optionsseite loescht,
- die Erweiterung deinstalliert wird und der Browser die Erweiterungsdaten entfernt,
- der Browser Speicherbereiche bereinigt,
- Indexdaten durch interne Aufraeumlogik als veraltet entfernt werden.

Die Optionsseite bietet Funktionen zum:

- Loeschen nur des Suchindex,
- Loeschen aller lokalen Erweiterungsdaten,
- Exportieren und Importieren lokaler Einstellungen.

## 8. Empfaenger

Die Erweiterung uebermittelt keine OPAL-Kursdaten an einen eigenen Server.

Moegliche externe Empfaenger im technischen Sinne sind:

- OPAL / Bildungsportal Sachsen, wenn OPAL-Seiten geladen oder im iframe indexiert werden,
- Studentenwerk Dresden API, wenn das Mensa-Widget Daten abruft,
- Browserhersteller bzw. Add-on-Plattformen im Rahmen von Installation, Updates oder Store-Nutzung.

## 9. Drittlanduebermittlung

Die Erweiterung selbst betreibt keinen eigenen Server fuer Drittlanduebermittlungen. Ob Browserhersteller, Add-on-Stores, GitHub oder externe APIs Daten ausserhalb der EU/des EWR verarbeiten, richtet sich nach deren jeweiligen Datenschutzbedingungen.

## 10. Rechte betroffener Personen

Soweit die DSGVO anwendbar ist, koennen betroffene Personen insbesondere folgende Rechte haben:

- Auskunft,
- Berichtigung,
- Loeschung,
- Einschraenkung der Verarbeitung,
- Datenuebertragbarkeit,
- Widerspruch,
- Widerruf einer Einwilligung mit Wirkung fuer die Zukunft,
- Beschwerde bei einer Datenschutzaufsichtsbehoerde.

Da die Erweiterung Daten ueberwiegend lokal im Browser speichert, koennen viele Daten direkt durch den Nutzer eingesehen, exportiert oder geloescht werden.

## 11. Datensicherheit

Die Erweiterung nutzt die Speichermechanismen des Browsers. Der Schutz der lokal gespeicherten Daten haengt auch von der Sicherheit des genutzten Geraets, Browserprofils und Betriebssystems ab.

Empfehlungen:

- Browser und Betriebssystem aktuell halten,
- Browserprofil nicht mit unbefugten Personen teilen,
- lokale Exportdateien sicher speichern,
- bei gemeinsam genutzten Geraeten lokale Erweiterungsdaten loeschen.

## 12. Kinder und Minderjaehrige

Die Erweiterung richtet sich primaer an Studierende und Hochschulangehoerige. Sie ist nicht speziell fuer Kinder konzipiert.

## 13. Aenderungen dieser Datenschutzerklaerung

Diese Datenschutzerklaerung kann angepasst werden, wenn sich Funktionen, Datenfluesse oder rechtliche Anforderungen aendern. Die jeweils aktuelle Fassung sollte im Repository und gegebenenfalls in der Erweiterungsbeschreibung verlinkt werden.

## 14. Quellen und Orientierung

Diese Erklaerung orientiert sich insbesondere an:

- Art. 12 DSGVO: transparente Information,
- Art. 13 DSGVO: Informationspflichten bei Direkterhebung,
- Art. 6 DSGVO: Rechtsgrundlagen der Verarbeitung,
- Mozilla Add-on Policies zu Datenschutz und Datenuebertragung.

