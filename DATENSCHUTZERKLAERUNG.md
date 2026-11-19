# Datenschutzerklärung für OPAL Redesign

Stand: 19. November 2026 · Funktionen der Version 0.3.0

OPAL Redesign verarbeitet Kursinformationen und persönliche Einstellungen auf deinem Gerät. Das Projekt betreibt dafür keinen eigenen Server. Es enthält keine Werbung, keine Telemetrie und keine Analyse des Nutzungsverhaltens für den Entwickler. Für OPAL-Funktionen und Mensa-Speisepläne entstehen dennoch Netzwerkverbindungen.

## Projekt und Kontakt

OPAL Redesign ist ein unabhängiges Open-Source-Projekt von [Just8it](https://github.com/Just8it). Fragen zum Projekt kannst du über das [GitHub-Repository](https://github.com/Just8it/OpalUIRedesign) stellen. GitHub-Issues sind öffentlich: Veröffentliche dort keine Zugangsdaten, privaten Kursinhalte oder unbereinigten Datenexporte.

Diese Erklärung beschreibt die Erweiterung. Für den Besuch von GitHub, OPAL, Hochschul-Anmeldeseiten und Add-on-Plattformen gelten zusätzlich die Datenschutzhinweise der jeweiligen Betreiber.

## Welche Daten auf deinem Gerät verarbeitet werden

| Bereich | Daten und Zweck |
| --- | --- |
| Einstellungen | Sprache, Darstellung, Farben, Dashboard-Anordnung, sichtbare Widgets und Funktionsoptionen für deine persönliche Oberfläche. |
| Suche und Navigation | Kurs-, Ordner-, Seiten- und Dateinamen, Links, Kennungen, Zuordnungen, verfügbare Katalogangaben sowie Besuchs- und Indexierungsinformationen für Suche und Navigation. |
| Kursansichten | Zwischengespeicherte Kursstrukturen, Materiallisten, Mitteilungen und aufbereitete Seiteninhalte, teilweise als HTML, für die Kursanzeige und eine schnelle Wiederherstellung. Darin können Namen oder andere personenbezogene Angaben aus OPAL enthalten sein. |
| Lernfortschritt | Erledigte oder übersprungene Einheiten, eigene Kursübersichten und Informationen zum Erkennen neuer oder geänderter Materialien. Diese Markierungen sind lokal und keine offiziellen Leistungsnachweise. |
| Kalender und Fristen | Importierte und selbst angelegte Termine, etwa Titel, Zeiten, Orte, Beschreibungen und Wiederholungen, sowie aus OPAL erkannte Fristen. Kalenderdateien werden im Browser eingelesen. |
| Mensa | Bevorzugte Mensen und favorisierte Gerichte. Abgerufene Speisepläne werden für die Anzeige im Arbeitsspeicher zwischengespeichert. |

Einstellungen und Kursdaten liegen im lokalen Erweiterungsspeicher des Browserprofils (`storage.local`). Der Suchindex liegt in der IndexedDB-Datenbank `OpalSearchIndex` der Erweiterung. Eine eigene Cloud-Synchronisierung gibt es nicht.

Der Suchindex enthält Metadaten und Links, keine vollständigen heruntergeladenen Dokumente wie PDFs. Das schließt die oben genannten zwischengespeicherten Inhalte von Kursseiten nicht aus. Dateien, die du öffnest oder herunterlädst, werden zusätzlich durch OPAL und deinen Browser verarbeitet.

## Netzwerkverbindungen und externe Dienste

**OPAL:** Die Erweiterung liest geladene Seiten unter `https://bildungsportal.sachsen.de/opal/`. Für Kursansichten, Suche und aktivierte Indexierungsfunktionen ruft sie weitere OPAL-Seiten ab; dafür verwendet sie HTTP-Anfragen und teilweise versteckte Frames. Je nach Einstellung geschieht das auch im Hintergrund. Der Browser nutzt dabei deine bestehende OPAL-Sitzung. OPAL erhält die üblichen Anfragedaten, etwa IP-Adresse, Zeitpunkt, angefragte Adresse und erforderliche Sitzungsinformationen. Kursdaten werden nicht an einen Projektserver gesendet.

**Anmeldung und TUfast:** Die Anmeldung erfolgt über OPAL beziehungsweise die zuständige Hochschule. OPAL Redesign gestaltet vorhandene Anmeldeelemente um und kann Aktionen einer installierten TUfast-Erweiterung auslösen. Es führt keinen eigenen Zugangsdaten-Speicher. Für die eigenständigen Funktionen von TUfast gelten dessen Datenschutzhinweise.

**Mensa:** Für Speisepläne wird `https://api.studentenwerk-dresden.de/openmensa/v2/` kontaktiert. Die Anfrage enthält die ausgewählte Mensa und das Datum; der Dienst erhält technisch bedingt auch Verbindungsdaten wie deine IP-Adresse. OPAL-Kursdaten und deine Liste favorisierter Gerichte werden dafür nicht mitgesendet. Die Auswahl favorisierter Gerichte erfolgt lokal.

**Links, Installation und Updates:** Beim Öffnen externer Links gelten die Bedingungen der Zielseite. Downloads von GitHub sowie Installation und gegebenenfalls Updates über Browser-Plattformen werden von deren Betreibern verarbeitet. Die Erweiterung führt keinen eigenen Update- oder Statistikserver. Ob diese unabhängigen Dienste Daten außerhalb der EU oder des EWR verarbeiten, richtet sich nach deren Datenschutzinformationen.

## Berechtigungen

- **Speicher (`storage`):** Einstellungen, Kalender, Fortschritt und zwischengespeicherte Daten lokal ablegen.
- **Downloads (`downloads`):** angeforderte Datei-Downloads und Datenexporte auslösen.
- **Zugriff auf OPAL:** Inhalte für die neue Oberfläche lesen und OPAL-Funktionen aufrufen.
- **Zugriff auf die Mensa-API:** Speisepläne abrufen.

Diese Berechtigungen erlauben keinen allgemeinen Zugriff auf beliebige Webseiten. Im Firefox-Manifest ist die Datensammlung mit `none` angegeben. Das bedeutet nicht, dass die Erweiterung ohne lokale Datenverarbeitung oder ohne die beschriebenen Funktionsanfragen auskommt.

## Speicherung, Export und Löschung

Einstellungen, Kalender, Lernfortschritt und Kursansichten bleiben grundsätzlich bis zur Änderung oder Löschung im Browserprofil. Für diese Daten gibt es keine allgemeine automatische Löschfrist.

Beim Aufbau oder Aktualisieren des Suchindex wird höchstens einmal täglich eine Bereinigung angestoßen: Gewöhnliche Indexeinträge werden nach mehr als 120 Tagen seit dem letzten Besuch oder der letzten Indexierung entfernt, Katalogeinträge nach mehr als 365 Tagen. Zusätzlich werden gewöhnliche Einträge auf 3.000 begrenzt. Läuft keine Indexierung, kann die Bereinigung später erfolgen. Diese Regeln gelten für den Suchindex, nicht für sämtliche lokalen Daten.

In den Erweiterungsoptionen kannst du den Suchindex separat oder alle lokalen Erweiterungsdaten löschen. Auf geöffneten OPAL-Seiten können Daten noch im Arbeitsspeicher vorhanden sein oder bei weiterer Nutzung erneut geladen werden. Schließe diese Seiten und deaktiviere die Erweiterung, wenn du die Verarbeitung beenden möchtest. Eine Deinstallation entfernt die Erweiterungsdaten nach den Regeln des Browsers.

Einstellungen und unterstützte lokale Daten sowie der Suchindex lassen sich über getrennte Exportfunktionen als JSON herunterladen. Diese Exporte können persönliche Angaben, Kursinhalte und OPAL-Links enthalten und werden von der Erweiterung nicht zusätzlich verschlüsselt. Sichere sie entsprechend. Heruntergeladene Dateien, eigene Sicherungen, Browser-Backups und Daten bei OPAL werden durch die Löschfunktion der Erweiterung nicht entfernt.

## Datenschutzrechtliche Einordnung und deine Rechte

Die Verarbeitung dient den von dir verwendeten Funktionen; der Entwickler erhält dadurch keinen Zugriff auf deinen lokalen Datenbestand. Soweit hierfür eine Verarbeitung personenbezogener Daten durch einen Verantwortlichen vorliegt, ist die dafür einschlägige Rechtsgrundlage gesondert zu bestimmen. Für zur Bereitstellung einer vereinbarten Funktion erforderliche Verarbeitungen kommt Art. 6 Abs. 1 Buchst. b DSGVO in Betracht. Eine Installation oder das Einschalten einer Option ist nicht automatisch eine Einwilligung für beliebige weitere Zwecke. Die Anforderungen an einen Zugriff auf Endgeräte nach § 25 TDDDG sind davon zu unterscheiden.

Soweit die gesetzlichen Voraussetzungen vorliegen, hast du Rechte auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung und Datenübertragbarkeit. Gegen Verarbeitungen aufgrund berechtigter Interessen kannst du Widerspruch einlegen; eine erteilte Einwilligung kannst du für die Zukunft widerrufen. Außerdem kannst du dich bei einer zuständigen Datenschutzaufsichtsbehörde beschweren. Die Erweiterung trifft keine automatisierten Entscheidungen mit rechtlicher oder vergleichbar erheblicher Wirkung.

Viele lokale Daten kannst du selbst über die Optionen verwalten. Für Auskünfte oder Löschungen zu OPAL, GitHub oder anderen eigenständigen Diensten ist der jeweilige Betreiber zuständig. Lokale Verarbeitung macht diese Daten nicht anonym: Der Schutz hängt auch von deinem Gerät, Browserprofil und deinen Sicherungen ab.

## Änderungen und weiterführende Informationen

Bei geänderten Funktionen wird diese Erklärung im Repository angepasst. Der Stand in einem heruntergeladenen Release kann von der aktuellen Repository-Fassung abweichen.

Grundlagen: [Informationspflichten nach der DSGVO](https://www.datenschutz.sachsen.de/informationspflichten.html), [§ 25 TDDDG](https://www.gesetze-im-internet.de/ttdsg/__25.html) und [Mozilla Add-on Policies](https://extensionworkshop.com/documentation/publish/add-on-policies/).
