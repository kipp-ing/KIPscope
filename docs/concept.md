# Konzept: Interaktiver Arbeitsplatz für historische Zeitreihen

Stand: 14. Oktober 2026 · Version 0.2

Dieses Dokument fasst die vereinbarten Anforderungen, die ergänzenden Konzeptvorschläge und die bisherige Werkzeugbewertung zusammen. Die Wahl zwischen fertigem Werkzeug, Erweiterung und Eigenentwicklung bleibt offen.

## 1. Ziel und Arbeitsablauf

Ingenieure sollen schnell konkrete Informationen in bereits aufgezeichneten Messdaten finden. Ausgangspunkt ist häufig ein Hinweis oder eine Hypothese zu einer Messung, einem Zeitpunkt und bestimmten Signalen.

Der zentrale Ablauf:

1. Hinweis aufnehmen und Datensatz sowie relevante Stelle öffnen.
2. Ein vorhandenes Template laden oder eine Ansicht zusammenstellen.
3. Signale ergänzen, zeitlich eingrenzen und vergleichen.
4. Mit Cursor A/B Zeitabstände und Wertdifferenzen untersuchen.
5. Untersuchung speichern und später wieder aufnehmen.

Die Oberfläche ist ein veränderbarer Messdaten-Arbeitsplatz mit Dashboardlayout. Sowohl der Benutzer als auch ein externes Programm beziehungsweise eine KI über CLI können ihn erstellen und bedienen.

## 2. Vereinbarter Umfang

- Daten aus Azure Data Explorer (ADX) oder ClickHouse darstellen.
- Ausschließlich historische, bereits aufgezeichnete Daten untersuchen.
- Zeitreihenfenster und Einzelwertfenster anbieten.
- Keine Aufzeichnung und keine Manipulation der Quelldaten.
- „Live“ bezeichnet die unmittelbare Wirkung der Fernsteuerung auf die offene Anwendung, keinen Echtzeitdatenstrom.
- Browserbasierter oder kombinierter Server-/Browserbetrieb; konkrete Betriebsform offen.
- Datenbanklatenz als gegeben behandeln. Ziel ist geeignete Darstellung und Bedienung, keine Beschleunigung der Datenbank.
- Zusätzliche Rollups, ein eigener dauerhafter Datencache oder eine zweite Datenhaltung gehören nicht zum Umfang.
- Abgeleitete Signale und ein eigenes Zugriffsrechtemodell später ergänzen.

Bereits für eine Ansicht geladene Daten bleiben für Zeichnung und Cursor nutzbar. Dafür wird kein zusätzlicher Cache-Dienst vorausgesetzt.

## 3. Datenumfang

| Merkmal | Anforderung |
| --- | --- |
| Quellen | ADX und ClickHouse |
| Signalkatalog | Etwa 1.000 bis 10.000 auswählbare Signale |
| Gleichzeitige Anzeige | Maximal 50 Signale; harte Grenze zulässig |
| Abtastabstände | Teilweise 5 ms |
| Betrachtungszeitraum | Bis etwa zehn Stunden |
| Detailzoom | Zeitfenster im Millisekundenbereich |
| Zeitstempel | Originalpräzision erhalten; Millisekunden, gegebenenfalls Mikrosekunden oder feiner |
| Zeitachsen | Messzeitpunkte unterscheiden sich je Signal |
| Metadaten | Signalname, Beschreibung, Alias und Einheit |
| Datenqualität | Fachliche Datenlücken sind vorab ausgefiltert |

Regelmäßige 5-ms-Abtastung über zehn Stunden ergibt 7,2 Millionen Punkte pro Signal. Ein vollständiges Laden langer Rohdatenzeiträume ist deshalb kein Standardpfad.

Ein Millisekundenfenster kann ohne eigenen Messpunkt sein, ohne dass eine Datenlücke vorliegt. Messpunkte dürfen nicht auf ein künstliches gemeinsames Abtastraster verschoben werden.

## 4. Signalauswahl und Fenster

Ein Signalexplorer bietet Suche über Name, Beschreibung, Alias und Einheit. Vorhandene Metadaten werden angezeigt. Signale können über Oberfläche und CLI hinzugefügt, entfernt und Fenstern zugeordnet werden.

Es gibt Zeitreihenfenster und Einzelwertfenster. Der Benutzer kann das Dashboard erstellen und verändern.

Der Zeitzoom ist je Fenster unabhängig. Fensterlayout, Y-Achsenoptionen und die genaue Zuordnung der Einzelwertfenster sind noch festzulegen.

## 5. Auflösungsabhängige Darstellung

Daten werden bedarfsgerecht für ausgewählte Signale, sichtbaren Zeitbereich und geeignete Auflösung abgefragt. Beim Hineinzoomen werden feinere Daten nachgeladen.

### Übersicht

Die Kurve zeigt einen verdichteten Repräsentativwert je Zeitbereich, der ungefähr einer horizontalen Zeichenposition entspricht. Mittelwerte sind der bisher vorgesehene Ansatz; die genaue Mittelungsregel bleibt festzulegen.

Optional überlagerte Min/Max-Hüllkurven machen die Extremwerte aller Messpunkte des jeweiligen Bereichs sichtbar. Die Hüllkurve ist einstellbar und nicht pauschal eingeschaltet.

Sie bewahrt Extremwerte, aber nicht deren exakten Zeitpunkt innerhalb eines verdichteten Bereichs. Dieser wird im Detailzoom sichtbar.

### Detailansicht

Bei ausreichendem Zoom werden unveränderte Rohpunkte an ihren Originalzeitstempeln dargestellt. Auswählbar sind:

- Linien zwischen Punkten.
- Sprungdarstellung.
- Datenpunktmarker, beispielsweise Punkt oder Bubble.

Für korrekt gezeichnete Linien oder Sprünge können Nachbarpunkte außerhalb des sichtbaren Intervalls erforderlich sein. Ohne verfügbare Messgrundlage darf kein Wert erfunden werden.

## 6. Globale Cursor und Differenzen

A und B bezeichnen in allen Fenstern dieselben absoluten Zeitpunkte. Fenster behalten ihren unabhängigen Zoom. Der Differenzmodus ist optional aktivierbar, aber eine zentrale Funktion.

Erforderlich sind Signalwerte an A und B sowie Δt und ΔWert. Als Vorzeichenkonvention wird B−A vorgeschlagen.

**Bewusst akzeptierte Semantik:** In verdichteten Ansichten zeigt der Cursor den Repräsentativwert des dargestellten Zeitbereichs. Derselbe Zeitpunkt desselben Signals kann deshalb je Fensterzoom verschiedene Cursorwerte und Differenzen liefern. Ein zusätzlicher zoomunabhängiger Rohwertzugriff ist nicht gefordert.

Zwischen Rohpunkten richtet sich die Auswertung nach dem Darstellungsmodus: lineare Interpolation bei Linien, Halten des vorherigen Werts bei Sprüngen. Rohwerte, interpolierte Werte und verdichtete Werte sollen erkennbar bleiben.

Für Einzelwertfenster sind Cursorrolle und Referenzauflösung noch festzulegen.

## 7. Vollständige CLI-Fernsteuerung

Die CLI ermöglicht die wesentlichen Benutzeraktionen:

- Dashboard und Fenster erstellen, verändern und laden.
- Signale suchen, hinzufügen, entfernen und zuordnen.
- Zeitbereiche und Zoom setzen.
- Cursor absolut setzen oder relativ verschieben.
- Differenzmodus und Darstellungsoptionen steuern.
- Historische Cursorbewegung starten, pausieren und Geschwindigkeit einstellen.
- Templates beziehungsweise gespeicherte Ansichten laden.
- Speichern, Snapshots wiederherstellen und Änderungen rückgängig machen.

Menschliche und ferngesteuerte Bedienung wechseln sich ab. Gleichzeitig konkurrierende Änderungen müssen nicht unterstützt werden.

Benötigt werden stabile IDs, maschinenlesbare Ergebnisse und auslesbarer Zustand. Ein Aufrufer muss erkennen können, ob ein Befehl angenommen wurde, benötigte Daten verfügbar sind und die offene Oberfläche den Zustand dargestellt hat. Eine KI verwendet diese reguläre Schnittstelle.

Eine API für gespeicherte Dashboardkonfigurationen allein genügt nicht: Die tatsächlich geöffnete Ansicht einschließlich Cursor, Zoom und Wiedergabe muss steuerbar sein.

## 8. Persistenz und Benutzeroptionen

Erforderlich sind Speichern/Laden, Snapshots, versionierbare Konfiguration und Undo.

Zum gespeicherten Zustand gehören mindestens Datenreferenz, Signalauswahl, Fensterlayout, Zeitbereiche, Darstellungsoptionen, Cursorpositionen, Differenzmodus und Benutzeroptionen. Ein Snapshot der Ansicht ist keine Kopie der Messdaten. Offlineexport ist nicht gefordert.

Kontinuierliche Cursoranimation soll nicht für jeden Bildschritt einen eigenen Undo-Eintrag erzeugen.

Die Anzeige erfolgt standardmäßig in Lokalzeit. Die Zeitzone ist wählbar. Originalzeitpräzision bleibt bei Datenzugriff, Übertragung, Zustandsablage und Darstellung erhalten. Mehrdeutige lokale Uhrzeiten während der Zeitumstellung müssen eindeutig angezeigt werden können.

Ein eigenes Rechteverwaltungssystem kommt später. Ein autorisierter Datenbankzugang bleibt erforderlich; Zugangsdaten gehören nicht in exportierte Templates.

## 9. Ergänzende Vorschläge aus der Konzeptprüfung

Die folgenden Punkte sind noch keine ausdrücklich bestätigten Anforderungen:

| Vorschlag | Nutzen |
| --- | --- |
| Untersuchung direkt öffnen | Datensatz, Zeitpunkt, Vor-/Nachlauf und Template oder Signalauswahl gemeinsam über CLI beziehungsweise Link übergeben |
| Templates neu binden | Vorhandene Ansicht auf eine andere Messung anwenden; fehlende oder mehrdeutige Signalzuordnungen melden |
| Lesezeichen mit Notiz | Fund einschließlich Datenreferenz, Ansicht und Cursorposition wiederfinden und weitergeben |
| Signaltypen berücksichtigen | Numerische Werte, boolesche Signale, Zustände und Fehlercodes fachlich passend darstellen und verdichten |
| Optional gekoppelter Zoom | Fenster bei gemeinsamen Ereignissen zusammen navigieren, ohne unabhängigen Zoom abzuschaffen |

Besonders bei Betriebszuständen und Fehlercodes muss geprüft werden, ob ein Mittelwert eine sinnvolle Aussage liefert.

## 10. Technischer Rahmen

Für eine eigene oder erweiterte Lösung empfiehlt sich ein gemeinsames fachliches Befehlsmodell für Oberfläche und CLI. Menschliche Bedienung, Fernsteuerung und Undo verwenden dadurch dieselben Aktionen.

Ein Datenadapter übersetzt Signalauswahl, Zeitraum und Zielauflösung in Abfragen für ADX beziehungsweise ClickHouse. Die Darstellung arbeitet mit gelieferten Rohpunkten oder Aggregaten. Auflösungsabhängige Abfragen begrenzen die übertragene Datenmenge; eine Beschleunigung der Datenbankarbeit wird nicht zugesichert.

Cursorbewegung und Zeichnen sollen auf bereits geladenen Daten möglich sein. Veraltete Abfrageantworten dürfen keinen neueren Zoomzustand überschreiben. Ladezustände, Fehler und unvollständige Ergebnisse müssen erkennbar bleiben.

Abgeleitete Signale benötigen später ein erweiterbares Signalmodell. Ihre Berechnung und Verdichtungssemantik werden noch nicht vorweggenommen.

## 11. Vorhandene Werkzeuge

Recherche vom 13. Oktober 2026. Kein vollständiger fertiger Treffer wurde belegt. Das ist kein Beweis, dass ein solches Produkt nicht existiert. Die Bewertung beruht auf Dokumentation, nicht auf praktischen Produkttests.

| Kandidat | Belegte Nähe zum Konzept | Wesentliche offene Lücke |
| --- | --- | --- |
| Grafana | ADX-/ClickHouse-Anbindung, auflösungsabhängige Queries und Min/Max-Flächendarstellung | Standardzoom verändert den Dashboardzeitraum; vollständige offene UI-Fernsteuerung und A/B-Differenzcursor nicht belegt |
| ibaAnalyzer | Ingenieurorientierte Analyse, gespeicherte Analysen, zwei Marker mit Zeit- und Wertdifferenzen | ADX und ClickHouse nicht in der gesichteten DB-Liste; vollständige Cursorfernsteuerung nicht belegt |
| PlotJuggler 4 | Erweiterbarer Signalviewer; SDK bietet Wiedergabe-, Zeitpositions-, Zoom- und Kurvensteuerung | Keine fertige ADX-/ClickHouse-Anbindung belegt; Plugin-API statt fertiger externer CLI; Tab-/Zoomzugriff auf eigene Plugin-Tabs begrenzt |
| Seeq | Fertiger ADX-Connector mit Signalmetadaten und Messdatenzugriff | ClickHouse und vollständige Fernsteuerung der offenen Ansicht nicht belegt; Detailanforderungen praktisch prüfen |

PlotJuggler ist ein interessanter Erweiterungskandidat. ibaAnalyzer eignet sich als Referenz für die Ingenieursbedienung. Seeq ist bei ADX als fertige Produktbasis zu prüfen. Grafana bleibt ein Vergleich für Datenanbindung und Abfrageprinzip.

## 12. Vorgehen zur Entscheidung

Vor einer Festlegung auf Eigenentwicklung sollte derselbe konkrete Untersuchungsablauf mit geeigneten Kandidaten geprüft werden:

1. Einen Hinweis mit Datensatz und Zeitpunkt übernehmen.
2. Template öffnen und Signale ergänzen.
3. Von einer langen Übersicht auf die relevante Stelle hineinzoomen.
4. Fenster unabhängig navigieren und A/B-Differenzen lesen.
5. Die offene Ansicht per Fernsteuerung verändern.
6. Fund speichern und wieder öffnen.

Entscheidend ist, welche Teile fertig funktionieren, welche eine überschaubare Erweiterung brauchen und welche grundlegende Eingriffe erfordern. Die Bewertung richtet sich nach Untersuchung und Bedienung. Eine Beschleunigung der Datenbank ist kein Auswahlkriterium.

## 13. Offene Details

- Zählt die 50-Signal-Grenze eindeutige Signale oder sichtbare Kurveninstanzen?
- Welche Mittelungsregel gilt bei unregelmäßigen Messpunkten?
- Welche Cursorrolle und Auflösung verwenden Einzelwertfenster?
- Welche Fenster-, Y-Achsen- und Markeroptionen gehören zur ersten Version?
- Welche Ergänzungen aus Abschnitt 9 werden verbindlich aufgenommen?
- Wie werden Templates gespeichert und auf andere Datensätze gebunden?
- Wie weit reicht Undo; bleibt dessen Historie über Neustarts erhalten?
- Muss Wiedergabe Fenster automatisch mitverschieben oder zunächst nur Cursor bewegen?
- Welche Betriebsform und welches vorhandene Werkzeug bilden die Basis?

## 14. Quellen der Werkzeugbewertung

- [Grafana: Query options und Auflösungsintervalle](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/query-transform-data/)
- [Grafana: Zeitreihen, Zoom und Fill below](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/visualizations/time-series/)
- [Grafana: ADX Query Editor](https://grafana.com/docs/plugins/grafana-azure-data-explorer-datasource/latest/query-editor/)
- [Grafana: ClickHouse Query Editor](https://grafana.com/docs/plugins/grafana-clickhouse-datasource/latest/query-editor/)
- [ibaAnalyzer: Produkt und Datenbankzugriff](https://www.iba-ag.com/en/ibaanalyzer/)
- [ibaAnalyzer: Handbuch, unter anderem Cursor und CLI](https://www.iba-ag.com/fileadmin/webdownloads/software/ibaAnalyzer/manuals/ibaAnalyzer_P1_IntroInstall_en_v8.3.pdf)
- [PlotJuggler: Projekt und Datenquellen](https://github.com/PlotJuggler/PlotJuggler)
- [PlotJuggler SDK: Steuerungsdienste im Changelog](https://github.com/PlotJuggler/plotjuggler_sdk/blob/main/CHANGELOG.md)
- [Seeq: ADX Connector](https://support.seeq.com/R65/cloud/azure-data-explorer-adx)
