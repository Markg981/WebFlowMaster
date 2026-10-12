# API-Tests

Ein API-Test definiert eine HTTP-Anfrage oder eine native gRPC-/WebSocket-Operation mit Prüfungen
der Antwort. HTTP-Tests in einem Plan bilden einen Ablauf: anmelden, eine Bestellung anlegen, sie
zurücklesen, sie löschen — jeder gibt Werte an den nächsten weiter. Sie bauen sie im
**API-Tester**.

## Die Anfrage

![Der API-Tester mit einer gesendeten Anfrage und ihrer Antwort](/screenshots/api-tester.webp)

- **Methode** und **Basis-URL**; **Query-Parameter** werden darunter hinzugefügt und in der
  **effektiven URL** angezeigt. Die Adresse darf mit einer Variablen beginnen —
  <code v-pre>{{baseUrl}}/orders</code> —, damit ein Test dem Server jeder Umgebung folgt.
- **Umgebung**: Die Umgebung, deren Secrets die <code v-pre>{{placeholders}}</code> in Adresse,
  Headern, Body und Autorisierung füllen, wie bei [Webtests](./web-tests#variables-and-environments).
- **Header**: Paare aus Name und Wert.
- **Body**: keiner, Form-Data (Textfelder und Dateien), URL-codiertes Formular, Raw (JSON, XML,
  Text, HTML, JavaScript, mit passendem `Content-Type`), eine Binärdatei oder eine GraphQL-Abfrage
  mit ihren Variablen.
- **Autorisierung**:

| Typ                     | Was gesendet wird                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keine Authentifizierung | Nichts.                                                                                                                                                                                                                                                                                                                                        |
| Basic Auth              | Benutzername und Passwort als Basic-Header.                                                                                                                                                                                                                                                                                                    |
| Bearer Token            | `Authorization: Bearer` und das Token.                                                                                                                                                                                                                                                                                                         |
| API Key                 | Ein Schlüssel in einem Header oder einem Query-Parameter, unter dem Namen Ihrer Wahl.                                                                                                                                                                                                                                                          |
| OAuth 2.0               | Ein Token, das zuerst von der Token-URL geholt wird, mit dem Grant **client credentials** oder **password**, und dann als Bearer-Token gesendet wird. Die Client-Zugangsdaten gehen in einen Basic-Header oder in den Body.                                                                                                                    |
| JWT Bearer              | Ein JWT, für jede Anfrage signiert: **HS256/384/512** mit gemeinsamem Secret (optional Base64), **RS\*** oder **ES\*** mit privatem PEM-Schlüssel. Claims und zusätzliche Header-Felder sind JSON; `iat` wird ergänzt, wenn es fehlt. Gesendet als `Authorization: <Präfix> <Token>` (Präfix standardmäßig _Bearer_) oder als Query-Parameter. |
| Digest Auth             | Die Anfrage geht hinaus, der Server antwortet mit 401 und seinen Bedingungen, und die Anfrage wird mit der Antwort erneut gesendet (RFC 7616: MD5, SHA-256, ihre `-sess`-Varianten, qop `auth` und `auth-int`).                                                                                                                                |
| OAuth 1.0               | Jede Anfrage signiert (RFC 5849) mit **HMAC-SHA1/256/512** oder **PLAINTEXT**, über Methode, URL, Query und einen Formular-Body. Lassen Sie das Token für zweibeiniges OAuth leer. Im Authorization-Header oder in der Query.                                                                                                                  |
| Hawk Authentication     | Ein MAC über Methode, Pfad, Host und Port, mit Zeitstempel und Nonce; optional der Hash des Bodys, für Server, die Nutzdaten prüfen.                                                                                                                                                                                                           |
| AWS Signature           | Signature Version 4: `Authorization` und `x-amz-date`, dazu `x-amz-security-token` bei temporären Zugangsdaten und `x-amz-content-sha256` für S3. Lassen Sie den Dienst leer, um ihn aus einem Host `*.amazonaws.com` zu lesen.                                                                                                                |
| NTLM Authentication     | Der NTLMv2-Handshake (negotiate, challenge, authenticate) auf einer Verbindung, wie NTLM es verlangt — vom Server oder vom Agenten, wenn der Plan auf einem Agenten-Pool läuft. `DOMÄNE\benutzer` im Benutzernamen funktioniert auch.                                                                                                          |
| Akamai EdgeGrid         | `EG1-HMAC-SHA256` mit Client-Token, Client-Secret und Access-Token Ihres `.edgerc`-Abschnitts; die aufgeführten Header und der Body von POST-Anfragen (bis zum Maximum) werden signiert.                                                                                                                                                       |
| Atlassian ASAP          | Ein kurzlebiges JWT (**RS\*** oder **ES\***) mit Issuer, Audience, Schlüssel-ID und frischem `jti`, als Bearer-Token gesendet.                                                                                                                                                                                                                 |

Ein Header namens `Authorization` auf dem Header-Tab hat Vorrang vor dem hier gewählten Typ. Ist
ein Pflichtfeld leer — ein Benutzername, ein Schlüssel —, wird die Anfrage nicht gesendet, und das
Ergebnis nennt das fehlende Feld, statt den Server mit 401 antworten zu lassen. Der
Authorization-Code-Grant braucht eine Person an einem Browser und kann daher nicht von einem
geplanten Lauf verwendet werden. Jedes Feld jedes Typs akzeptiert Umgebungs-Platzhalter — bewahren
Sie Passwörter, Secrets und private Schlüssel dort auf statt im Test.

**Senden** führt die Anfrage vom Server aus und zeigt die **Antwort**: Status, Zeit, Body und
Header sowie das Ergebnis jeder Assertion. Jede gesendete Anfrage bleibt im **Verlauf**, aus dem
Sie sie erneut öffnen können.

## Assertions

Jede Assertion liest einen Teil der Antwort und vergleicht ihn:

| Quelle         | Eigenschaft                 | Beispiel                                               |
| -------------- | --------------------------- | ------------------------------------------------------ |
| status code    | —                           | gleich `201`                                           |
| header         | der Name des Headers        | `Content-Type` enthält `json`                          |
| body json path | ein Pfad im JSON-Body       | `items[0].id` existiert                                |
| body text      | —                           | enthält `"status":"ok"`                                |
| response time  | —                           | kleiner als `500` (Millisekunden)                      |
| body xpath     | ein XPath in einem XML-Body | `//status` gleich `Shipped` — siehe [SOAP](#protocols) |

Vergleiche: gleich, ungleich, enthält, enthält nicht, existiert, existiert nicht, ist leer, ist
nicht leer, größer als, kleiner als (oder gleich), passt auf Regex, passt nicht auf Regex. Eine
Assertion lässt sich ausschalten, ohne sie zu löschen. Der Test besteht, wenn jede eingeschaltete
Assertion besteht.

## Erfassungen: Werte weitergeben {#captures}

Eine **Erfassung** entnimmt der Antwort einen Wert — ein Token, die ID des Angelegten — und gibt
ihm einen Namen. Die API-Tests, die im selben Lauf eines Plans danach kommen, können ihn als
<code v-pre>{{name}}</code> in Adresse, Headern oder Body verwenden.

Eine Erfassung liest dieselben Stellen wie eine Assertion: den Statuscode, einen Header, einen
JSON-Pfad oder den Body-Text. Namen bestehen aus Buchstaben, Ziffern und Unterstrichen und beginnen
mit einem Buchstaben. **Senden** zeigt den Wert, den jede Erfassung genommen hat, oder warum sie
keinen nehmen konnte.

Erfasste Werte wandern innerhalb des Durchgangs eines Browsers durch den Plan, in der Reihenfolge,
in der die Tests laufen. Ein Plan, der darauf angewiesen ist, sollte diese Tests in der richtigen
Reihenfolge halten; laufen mehrere Tests gleichzeitig, hält der Plan die API-Tests jedes Browsers
in Reihenfolge.

## Antwortzeiten über mehrere Anfragen {#performance}

Die Assertion **response time** beurteilt eine Anfrage, und die Zeit einer einzelnen Anfrage ist
Rauschen: Ein kalter Cache oder eine Garbage Collection entscheidet sie. Der Tab **Performance**
prüft einen Endpunkt so, dass man dem Ergebnis trauen kann: Schalten Sie **Antwortzeiten über
mehrere Anfragen prüfen** ein und legen Sie fest

- **Anfragen** — wie viele, 2 bis 200, die funktionale Anfrage eingeschlossen;
- **Gleichzeitig** — wie viele zusammen unterwegs sind, 1 bis 10;
- die Schwellenwerte, an denen der Test scheitert, jeder optional: **Median (p50)**, **95.
  Perzentil (p95)** und **Langsamste**, in Millisekunden, und **Fehlgeschlagene Anfragen**, in
  Prozent.

In einem Plan wird die Anfrage wie üblich einmal gesendet — ihre Assertions entscheiden das
Ergebnis, und ihre Erfassungen gehen an die nächsten Tests — und dann erneut, bis die Anzahl
erreicht ist. Eine Wiederholung zählt als fehlgeschlagen, wenn sie nicht gestellt werden konnte
oder an einer der Assertions des Tests gescheitert ist. Perzentile sind Nearest-Rank: p95 von 20
Anfragen ist die 19.-schnellste. Wird ein Schwellenwert überschritten, scheitert der Test mit dem
Überschrittenen („p95 412 ms > 300 ms“), und die Karte **Antwortzeiten** des Laufberichts listet
jeden Test, der seine Zeiten geprüft hat: Anfragen, p50, p95, langsamste, fehlgeschlagene Anfragen
und Urteil.

Die Wiederholungen starten dort, wo der Test läuft — im Netzwerk eines lokalen Agenten, wenn der
Plan einen nutzt —, und hören auf, wenn der Lauf abgebrochen wird. Eine Anfrage, die gar nicht
gestellt werden kann, überspringt die Prüfung: Es gibt nichts zu messen. Die Obergrenzen sind
gewollt: Dies beantwortet bei jedem Lauf „Ist dieser Endpunkt langsamer geworden?“, es ist kein
Lasttest. Für Last über die Zeit — virtuelle Benutzer, Rampen, Aufwärmphase, eine Datenzeile pro
Benutzer — siehe [Lasttests](./load-tests).

## SOAP, WebSocket und gRPC {#protocols}

**SOAP** verwendet HTTP POST mit einem rohen XML-Umschlag: `text/xml` und `SOAPAction` für
SOAP 1.1 oder `application/soap+xml` für SOAP 1.2. XPath-Assertions und -Erfassungen funktionieren
mit Namensräumen (`//status` ignoriert Präfixe; `//ns:status` verwendet das Präfix des Dokuments).
Der [Import](#import) erzeugt bearbeitbare Anfragen aus WSDL.

**gRPC** unterstützt Unary, Server-Streaming, Client-Streaming und bidirektionales Streaming.
Wählen Sie **GRPC**, geben Sie `grpc://host:port/package.Service/Method` an (`grpcs://` für
geprüftes TLS) und fügen Sie die **.proto** des Dienstes ein. Header sind Metadaten. Der
**gRPC-Modus** folgt standardmäßig der Methodendefinition; ein ausdrücklicher Modus muss zu ihr
passen. Unary- und Server-Stream-Aufrufe nehmen eine JSON-Anfrage. Client- und bidirektionale
Streams akzeptieren:

```json
{ "messages": [{ "value": "first" }, { "value": "second" }] }
```

Bidirektionale Streams können stattdessen die unten beschriebene geordnete Konversation verwenden.
Unary- und Client-Stream-Antworten bleiben einzelne JSON-Nachrichten. Antwort-Streams liefern
`{messages,last,count,captures}`; prüfen Sie `count`, `last.value` oder `messages[0].value`.
Abschlussstatus und Trailer stehen Assertions zur Verfügung (Status 0 bedeutet OK). Entfernte
Fehlercodes bleiben prüfbar; eine lokale Deadline, ein Abbruch, eine fehlerhafte Konversation oder
eine überschrittene Ressourcengrenze lassen die Ausführung scheitern, auch ohne Assertions.

**WebSocket** akzeptiert `ws://` oder `wss://`. Bestehende, zeilenweise getrennte Rohnachrichten
und `{"send":["ping"],"waitMs":2000,"until":1}` werden weiterhin unterstützt. Um Antworten,
Erfassungen und abhängige Sendungen abzuwechseln, wählen Sie den Raw-Body und verwenden
**Konversation** (geordneter Editor oder JSON):

```json
{
  "steps": [
    { "type": "receive" },
    { "type": "capture", "name": "token", "property": "token" },
    { "type": "send", "message": "{{capture.token}}" },
    { "type": "receive", "timeoutMs": 2000, "property": "accepted", "equals": true },
    { "type": "end" }
  ]
}
```

Empfangsschritte verbrauchen wartende Antworten, auch eine sofortige Challenge des Servers. Eine
optionale Eigenschaft wie `items[0].id` und `equals` wählen die erwartete Antwort. Eine Erfassung
liest die zuletzt empfangene Nachricht; ihr Name muss mit einem Buchstaben beginnen und Buchstaben,
Ziffern oder Unterstriche enthalten. Verwenden Sie <code v-pre>{{capture.token}}</code> erst nach
der Erfassung; diese Namen sind innerhalb der Konversation reserviert. Fehlende Erfassungen und ein
vorzeitiges Schließen scheitern mit der Schrittnummer. **Beenden** schließt den WebSocket oder
schließt den gRPC-Anfragestream zur Hälfte. Client-Streaming-gRPC-Konversationen können vor ihrer
einzigen abschließenden Antwort nichts empfangen.

**Protokollkonfiguration** legt das Gesamtzeitlimit, die Zahl empfangener Nachrichten und die
empfangenen UTF-8-Bytes fest. Standardwerte sind **30 Sekunden / 100 Nachrichten / 1 MiB**;
Höchstwerte **60 Sekunden / 1.000 Nachrichten / 8 MiB**. Erfassungen haben ein eigenes
Gesamtbudget an Bytes mit demselben Maximum; alle Sendungen einer Konversation zusammen sind nach
der Ersetzung auf 8 MiB begrenzt. Konversationen erlauben **100 Schritte**. Das Antwortprotokoll
zeigt Nachrichten und Erfassungen der Konversation. Gespeicherte Tests, ausführbare Versionen,
freigegebene Veröffentlichungen und YAML-/JSON-Pakete behalten die Konfiguration. Planberichte
speichern ein geschwärztes Protokoll und behalten die echten Extraktionen für spätere Anfragen.

### Geprüftes TLS und Client-Zertifikate

Legen Sie in der Umgebung der ausgewählten Organisation verschlüsselte Secret-Werte mit der
PEM-Root-CA, dem Client-Zertifikat und dem privaten Schlüssel an. Tragen Sie ihre genauen
Referenzen in **Protokollkonfiguration** ein, zum Beispiel:

```json
{
  "tls": {
    "rootCa": "{{secret_grpc_ca}}",
    "clientCertificate": "{{secret_grpc_cert}}",
    "clientKey": "{{secret_grpc_key}}",
    "keyPassphrase": "{{secret_grpc_passphrase}}"
  }
}
```

Verwenden Sie die tatsächlichen Namen Ihrer Secret-Variablen. Die CA ist optional, wenn das
Systemvertrauen genügt; Client-Zertifikat und Schlüssel müssen zusammen angegeben werden, und die
Passphrase ist nur für einen verschlüsselten Schlüssel. Jedes aufgelöste PEM-Feld ist auf 256 KiB
begrenzt. Zertifikate und Schlüssel im Klartext in einer gespeicherten Konfiguration werden
abgelehnt. Die aufgelöste Adresse muss `grpcs://` verwenden, auch wenn sie über eine
Umgebungsvariable kommt. Zuordnung von Zertifikat und Schlüssel, Vertrauen und Ziel-Hostname werden
geprüft; es gibt keinen unsicheren Rückfall. Rotieren Sie Zugangsdaten, indem Sie die Werte der
Umgebungs-Secrets ändern, und führen Sie den Test dann erneut aus; Versionen behalten Referenzen,
kein PEM-Material. Nur die nötigen aufgelösten TLS-Felder laufen über das authentifizierte
Agenten-Relay; Tickets enthalten Namen von Fähigkeiten. Umgebungswerte und PEM-Material werden in
Transportfehlern und im Anfrageverlauf geschwärzt.

Pläne mit lokalen Agenten führen all diese Protokolle aus dem Netzwerk des Agenten aus.
Aktualisieren Sie auf **Agent 1.2.0**, indem Sie das neue Skript und seine Abhängigkeiten
herunterladen oder den Docker-Agenten neu bauen und neu starten
([Local agents](/en/integrations/local-agents), auf Englisch). Ältere native Agenten können
weiterhin die bisherigen Unary- und WebSocket-Aufrufe ausführen, aber fortgeschrittene Tickets
erfordern `native-protocol-v2`; ein nicht unterstützter Pool scheitert ausdrücklich. Die Vorschau
**Senden** im Editor läuft vom Server aus. Bestehende Pflicht-Proxy- und Zielbeschränkungen gelten
weiterhin.

## Import aus OpenAPI, Postman oder WSDL {#import}

**Gespeicherte Tests → Importieren** erzeugt Tests aus dem, was ein Team bereits hat: einer
**OpenAPI 3**- oder **Swagger 2**-Beschreibung in JSON oder YAML, einer **Postman-Collection** (v2.0
oder v2.1) oder dem **WSDL** (1.1/2.0) eines SOAP-Dienstes. Öffnen Sie die Datei oder fügen Sie sie
ein, klicken Sie auf **Zeigen, was entsteht**, behalten Sie die gewünschten Tests — die, deren
Methode und Adresse hier schon existieren, sind abgewählt —, wählen Sie ein Projekt und
importieren Sie.

- Ein Test pro Operation (OpenAPI) bzw. Anfrage (Postman), benannt nach Zusammenfassung,
  Operation-ID oder Postman-Namen, nach Tag oder Ordner als Modul gruppiert.
- Die Adresse beginnt mit <code v-pre>{{baseUrl}}</code>; Pfadparameter werden zu
  <code v-pre>{{name}}</code> (auch Postmans `:name`). Postmans eigene
  <code v-pre>{{variables}}</code> haben dieselbe Syntax und bleiben, wie sie sind.
- Pflicht-Query- und -Header-Parameter erhalten ihr Beispiel, ihren Standardwert oder ersten
  erlaubten Wert oder eine Variable. Der Body ist das Beispiel der Operation oder einer, der aus
  ihrem Schema gebaut wird (JSON- und URL-codierte Formulare); Postmans Raw-, URL-codierte und
  GraphQL-Bodys bleiben erhalten.
- Die Sicherheit wird zur Autorisierung des Tests — Bearer, Basic oder API Key — mit dem Secret als
  Variable (<code v-pre>{{token}}</code>, <code v-pre>{{password}}</code>…). Ein in eine
  Postman-Collection geschriebenes Secret wird nicht importiert.
- Der erwartete Status ist eine Assertion: die erste 2xx-Antwort von OpenAPI oder Postmans
  `pm.response.to.have.status(…)`.
- Aus einem WSDL: ein `POST` pro Operation des ausgewählten SOAP-Bindings, mit einem Umschlag und
  Schemafeldern, die als `?` zum Ausfüllen geschrieben sind. SOAP 1.1 verwendet `SOAPAction`;
  SOAP 1.2 die Action im Content-Type. Request-Response erwartet `200` und kein `//Fault`; One-Way
  erwartet einen 2xx-Status.

Die Vorschau listet die Variablen, die die Tests brauchen, mit der Serveradresse als Vorschlag für
<code v-pre>{{baseUrl}}</code>: Legen Sie sie vor dem Ausführen in einer
[Umgebung](./web-tests#variables-and-environments) an. Was nicht übernommen werden konnte, wird pro
Test genannt: Multipart-Bodys, Postman-Skripte über die Statusprüfung hinaus,
Pre-Request-Skripte, OAuth-Abläufe (der Test sendet dann <code v-pre>{{token}}</code>). Höchstens
500 Tests pro Import, 12 MB pro Datei; das Audit-Protokoll hält jeden Import fest.

### Offline-WSDL-/XSD-Pakete

Öffnen Sie mehrere Dateien oder einen Ordner, wählen Sie das Root-WSDL und bearbeiten Sie die
logischen Pfade so, dass Importe relativ zum importierenden Dokument aufgelöst werden (zum Beispiel
`service.wsdl`, `types/request.xsd`, `types/base.xsd`). Ordnerpfade bleiben erhalten. Wählen Sie in
der Vorschau den SOAP-Endpunkt; das Ändern von Dateien, Pfaden oder Endpunkt macht die vorige
Vorschau ungültig.

WSDL-1.1-Importe, WSDL-2.0-Importe/-Includes und SOAP-HTTP-Operationen mit Request-Response und
One-Way werden unterstützt, einschließlich XSD-Import/-Include, qualifizierter Namen,
Elementreferenzen, Erweiterungen komplexer Typen, verschachtelter sequence/all/choice und benannter
Modellgruppen (auch über Namensräume hinweg und Chameleon-Includes). Choices erzeugen die erste
aktivierte Alternative mit einer Warnung; bearbeiten Sie sie, wenn ein anderer Zweig nötig ist.
Wiederholte Partikel erzeugen die Mindestzahl verlangter Vorkommen bzw. ein Beispiel bei optionalen
Partikeln; `maxOccurs="0"` lässt das Partikel weg. Wildcards blockieren den Import nicht mehr:
`xsd:any` hinterlässt einen XML-Kommentar und eine Warnung mit Namensraum, processContents und
Mindestvorkommen. Ergänzen Sie passende Elemente von Hand, besonders bei Pflicht-Wildcards.
Attribute, Attributgruppen, anyAttribute und simpleContent müssen weiterhin von Hand vervollständigt
werden.

Die Grenzen sind 32 Dokumente, insgesamt 10 MiB, Import- und Elementtiefe 10,
Partikelverschachtelung 32 und 5.000 expandierte Elemente/Partikel pro Operation. Abhängigkeiten
werden nur aus hochgeladenen Dokumenten aufgelöst: Es gibt keine Netzwerk- oder
Dateisystemzugriffe; DTD/Entitäten, fehlende oder mehrdeutige Abhängigkeiten und unsichere Pfade
werden abgelehnt. RPC/encoded-Bindings, Einschränkungen komplexer Inhalte, ungültige
Vorkommensgrenzen und rekursive Gerüste scheitern ausdrücklich. Policies, Policy-Referenzen,
SOAP-Module und Header, die Handarbeit brauchen, erzeugen Warnungen in der Vorschau. Prüfen Sie die
erzeugten Umschläge vor dem Ausführen: Platzhalter, Facetten, abstrakte Elemente und
Substitutionsgruppen sind weder eine Schemavalidierung noch eine sendefertige Anfrage. Das
gemeinsame Paket in `collaudo/fixtures/wsdl` ist synthetisch; die Kompatibilität mit echten
Kundenverträgen ist noch zu validieren.

## Speichern

**Test speichern** fragt nach einem Namen und optional einem Projekt; **Änderungen speichern**
aktualisiert den Test, den Sie aus **Gespeicherte Tests** geöffnet haben. Ein gespeicherter
API-Test kann Testplänen hinzugefügt und als [Vorbedingung](./web-tests#vorbedingungen) eines
Webtests verwendet werden.

## Versionen und Veröffentlichung

Gespeicherte Tests haben [Verlauf, Vergleich und Wiederherstellung](./organizing#history-and-versions).
[Veröffentlichung und Prüfungen](./organizing#publishing-and-reviews) wählen die Revision, die Pläne
ausführen; das Speichern oder Wiederherstellen einer Arbeitskopie lässt eine bestehende
Veröffentlichung bestehen. **Testen** führt die gespeicherte Arbeitskopie des API-Tests aus.
