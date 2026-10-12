# Tests API

Un test API définit une requête HTTP ou une opération native gRPC/WebSocket avec des vérifications
de la réponse. Les tests HTTP d'un plan forment un flux : se connecter, créer une commande, la
relire, la supprimer — chacun passant des valeurs au suivant. Vous les construisez dans le
**Testeur d’API**.

## La requête

![Le Testeur d'API avec une requête envoyée et sa réponse](/screenshots/api-tester.webp)

- **Méthode** et **URL de base** ; les **Paramètres de requête** s'ajoutent en dessous et
  apparaissent dans l'**URL effective**. L'adresse peut commencer par une variable —
  <code v-pre>{{baseUrl}}/orders</code> — pour qu'un même test suive le serveur de chaque
  environnement.
- **Environnement** : l'environnement dont les secrets remplissent les
  <code v-pre>{{placeholders}}</code> de l'adresse, des en-têtes, du corps et de l'autorisation,
  comme pour les [tests web](./web-tests#variables-and-environments).
- **En-têtes** : des paires nom et valeur.
- **Corps** : aucun, form data (champs texte et fichiers), formulaire URL-encoded, brut (JSON, XML,
  texte, HTML, JavaScript, avec le `Content-Type` correspondant), un fichier binaire, ou une requête
  GraphQL avec ses variables.
- **Autorisation** :

| Type                    | Ce qui est envoyé                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aucune authentification | Rien.                                                                                                                                                                                                                                                                                                                                                           |
| Basic Auth              | Un nom d'utilisateur et un mot de passe dans un en-tête Basic.                                                                                                                                                                                                                                                                                                  |
| Bearer Token            | `Authorization: Bearer` et le jeton.                                                                                                                                                                                                                                                                                                                            |
| API Key                 | Une clé dans un en-tête ou un paramètre de requête, sous le nom de votre choix.                                                                                                                                                                                                                                                                                 |
| OAuth 2.0               | Un jeton obtenu d'abord auprès de l'URL de jeton, avec le grant **client credentials** ou **password**, puis envoyé comme Bearer token. Les identifiants du client vont dans un en-tête Basic ou dans le corps.                                                                                                                                                 |
| JWT Bearer              | Un JWT signé à chaque requête : **HS256/384/512** avec un secret partagé (éventuellement en Base64), **RS\*** ou **ES\*** avec une clé privée PEM. Les claims et les champs d'en-tête supplémentaires sont en JSON ; `iat` est ajouté s'il manque. Envoyé comme `Authorization: <préfixe> <jeton>` (préfixe _Bearer_ par défaut) ou comme paramètre de requête. |
| Digest Auth             | La requête part, le serveur répond 401 avec ses conditions, et la requête est renvoyée avec la réponse (RFC 7616 : MD5, SHA-256, leurs variantes `-sess`, qop `auth` et `auth-int`).                                                                                                                                                                            |
| OAuth 1.0               | Chaque requête signée (RFC 5849) avec **HMAC-SHA1/256/512** ou **PLAINTEXT**, sur la méthode, l'URL, la query et un corps de formulaire. Laissez le jeton vide pour OAuth à deux acteurs. Dans l'en-tête Authorization ou dans la query.                                                                                                                        |
| Hawk Authentication     | Un MAC sur la méthode, le chemin, l'hôte et le port, avec horodatage et nonce ; éventuellement le hash du corps, pour les serveurs qui vérifient les contenus.                                                                                                                                                                                                  |
| AWS Signature           | Signature Version 4 : `Authorization` et `x-amz-date`, plus `x-amz-security-token` avec des identifiants temporaires et `x-amz-content-sha256` pour S3. Laissez le service vide pour le lire depuis un hôte `*.amazonaws.com`.                                                                                                                                  |
| NTLM Authentication     | L'échange NTLMv2 (negotiate, challenge, authenticate) sur une seule connexion, comme l'exige NTLM — depuis le serveur, ou depuis l'agent quand le plan s'exécute sur un pool d'agents. `DOMAINE\utilisateur` dans le nom d'utilisateur fonctionne aussi.                                                                                                        |
| Akamai EdgeGrid         | `EG1-HMAC-SHA256` avec le client token, le client secret et l'access token de votre section `.edgerc` ; les en-têtes que vous listez et le corps des requêtes POST (jusqu'au maximum) sont signés.                                                                                                                                                              |
| Atlassian ASAP          | Un JWT de courte durée (**RS\*** ou **ES\***) avec émetteur, audience, identifiant de clé et un `jti` neuf, envoyé comme Bearer token.                                                                                                                                                                                                                          |

Un en-tête nommé `Authorization` écrit dans l'onglet En-têtes l'emporte sur le type choisi ici. Si
un champ obligatoire est vide — un nom d'utilisateur, une clé — la requête n'est pas envoyée, et le
résultat dit quel champ manque, plutôt que de laisser le serveur répondre 401. Le grant
authorization-code demande une personne devant un navigateur : il ne peut donc pas être utilisé par
une exécution planifiée. Chaque champ de chaque type accepte les placeholders d'environnement —
gardez-y les mots de passe, secrets et clés privées plutôt que dans le test.

**Envoyer** exécute la requête depuis le serveur et affiche la **Réponse** : statut, durée, corps et
en-têtes, et le résultat de chaque assertion. Chaque requête envoyée est conservée dans
**Historique**, d'où vous pouvez la rouvrir.

## Assertions

Chaque assertion lit une partie de la réponse et la compare :

| Source         | Propriété                    | Exemple                                               |
| -------------- | ---------------------------- | ----------------------------------------------------- |
| status code    | —                            | égal à `201`                                          |
| header         | le nom de l'en-tête          | `Content-Type` contient `json`                        |
| body json path | un chemin dans le corps JSON | `items[0].id` existe                                  |
| body text      | —                            | contient `"status":"ok"`                              |
| response time  | —                            | inférieur à `500` (millisecondes)                     |
| body xpath     | un XPath dans un corps XML   | `//status` égal à `Shipped` — voir [SOAP](#protocols) |

Comparaisons : égal, différent, contient, ne contient pas, existe, n'existe pas, est vide, n'est
pas vide, supérieur à, inférieur à (ou égal), correspond à l'expression régulière, ne correspond
pas à l'expression régulière. Une assertion peut être désactivée sans être supprimée. Le test
réussit quand toutes les assertions actives réussissent.

## Captures : transmettre des valeurs {#captures}

Une **capture** extrait une valeur de la réponse — un jeton, l'identifiant de ce qui a été créé — et
lui donne un nom. Les tests API qui la suivent dans la même exécution d'un plan peuvent l'utiliser
sous la forme <code v-pre>{{nom}}</code>, dans l'adresse, les en-têtes ou le corps.

Une capture lit les mêmes endroits qu'une assertion : le code de statut, un en-tête, un chemin
JSON ou le texte du corps. Les noms sont faits de lettres, de chiffres et de tirets bas, et
commencent par une lettre. **Envoyer** montre la valeur prise par chaque capture, ou pourquoi elle
n'a pas pu en prendre une.

Les valeurs capturées circulent au sein du passage d'un navigateur dans le plan, dans l'ordre
d'exécution des tests. Un plan qui en dépend doit garder ces tests dans le bon ordre ; avec
plusieurs tests en parallèle, le plan garde dans l'ordre les tests API de chaque navigateur.

## Temps de réponse sur plusieurs requêtes {#performance}

L'assertion **response time** juge une seule requête, et le temps d'une seule requête est du bruit :
un cache froid ou un ramasse-miettes en décide. L'onglet **Performance** contrôle un point d'accès
d'une manière digne de confiance : activez **Vérifier les temps de réponse sur plusieurs requêtes**
et réglez

- **Requêtes** — combien, de 2 à 200, la requête fonctionnelle comprise ;
- **En même temps** — combien sont en vol ensemble, de 1 à 10 ;
- les seuils qui font échouer le test, chacun facultatif : **Médiane (p50)**, **95e percentile
  (p95)** et **La plus lente**, en millisecondes, et **Requêtes en échec**, en pourcentage.

Dans un plan, la requête est envoyée une fois comme d'habitude — ses assertions décident du
résultat et ses captures passent aux tests suivants — puis à nouveau jusqu'à atteindre le nombre
voulu. Une répétition compte comme échouée quand elle n'a pas pu être envoyée ou qu'elle a échoué à
l'une des assertions du test. Les centiles sont au rang le plus proche : le p95 de 20 requêtes est
la 19e plus rapide. Quand un seuil est dépassé, le test échoue en disant ce qui a été dépassé
(« p95 412 ms > 300 ms »), et la carte **Temps de réponse** du rapport d'exécution liste chaque
test qui a contrôlé ses temps : requêtes, p50, p95, la plus lente, requêtes en échec et verdict.

Les répétitions partent de là où le test s'exécute — le réseau d'un agent local quand le plan en
utilise un — et s'arrêtent quand l'exécution est annulée. Une requête qui ne peut pas du tout être
envoyée saute le contrôle : il n'y a rien à chronométrer. Les plafonds sont délibérés : cela répond
à « ce point d'accès est-il devenu plus lent ? » à chaque exécution, ce n'est pas un test de charge.
Pour une charge dans la durée — utilisateurs virtuels, montées en charge, préchauffage, une ligne de
données par utilisateur — voir [Tests de charge](./load-tests).

## SOAP, WebSocket et gRPC {#protocols}

**SOAP** utilise HTTP POST avec une enveloppe XML brute : `text/xml` et `SOAPAction` pour SOAP 1.1,
ou `application/soap+xml` pour SOAP 1.2. Les assertions et captures XPath fonctionnent avec les
espaces de noms (`//status` ignore les préfixes ; `//ns:status` utilise le préfixe du document).
L'[import](#import) crée des requêtes modifiables à partir d'un WSDL.

**gRPC** prend en charge les appels unaires, le streaming serveur, le streaming client et le
streaming bidirectionnel. Choisissez **GRPC**, indiquez
`grpc://hôte:port/package.Service/Method` (`grpcs://` pour du TLS vérifié) et collez le **.proto**
du service. Les en-têtes sont des métadonnées. Le **Mode gRPC** reprend par défaut la définition de
la méthode ; un mode explicite doit lui correspondre. Les appels unaires et à flux serveur prennent
une requête JSON. Les flux client et bidirectionnels acceptent :

```json
{ "messages": [{ "value": "first" }, { "value": "second" }] }
```

Les flux bidirectionnels peuvent aussi utiliser la conversation ordonnée décrite ci-dessous. Les
réponses unaires et à flux client restent des messages JSON uniques. Les flux de réponse renvoient
`{messages,last,count,captures}` ; vérifiez `count`, `last.value` ou `messages[0].value`. Le statut
final et les trailers sont disponibles pour les assertions (le statut 0 signifie OK). Les codes
d'erreur distants restent vérifiables ; une échéance locale, une annulation, une conversation mal
formée ou une limite de ressources dépassée font échouer l'exécution, même sans assertions.

**WebSocket** accepte `ws://` ou `wss://`. Les messages bruts séparés par des lignes et
`{"send":["ping"],"waitMs":2000,"until":1}` restent pris en charge. Pour alterner réponses, captures
et envois dépendants, choisissez le corps brut et utilisez **Conversation** (éditeur ordonné ou
JSON) :

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

Les réceptions consomment les réponses en file, y compris un challenge immédiat du serveur. Une
propriété facultative comme `items[0].id` et `equals` sélectionnent la réponse attendue. Une
capture lit le dernier message reçu ; son nom doit commencer par une lettre et contenir des
lettres, des chiffres ou des tirets bas. N'utilisez <code v-pre>{{capture.token}}</code> qu'après
l'avoir capturé ; ces noms sont réservés au sein de la conversation. Les captures manquantes et une
fermeture prématurée échouent avec le numéro de l'étape. **Terminer** ferme le WebSocket ou ferme à
moitié le flux de requêtes gRPC. Les conversations gRPC à flux client ne peuvent rien recevoir
avant leur unique réponse finale.

**Configuration du protocole** règle le délai global, le nombre de messages reçus et les octets
UTF-8 reçus. Les valeurs par défaut sont **30 secondes / 100 messages / 1 Mio** ; les maximums
**60 secondes / 1 000 messages / 8 Mio**. Les captures ont un budget d'octets global séparé avec le
même maximum ; l'ensemble des envois d'une conversation est limité à 8 Mio après substitution. Les
conversations autorisent **100 étapes**. La transcription de la réponse montre les messages et les
captures de la conversation. Les tests enregistrés, les versions exécutables, la publication
approuvée et les lots YAML/JSON conservent la configuration. Les rapports de plan conservent une
transcription masquée tout en gardant les extractions réelles pour les requêtes suivantes.

### TLS vérifié et certificats client

Dans l'environnement de l'organisation sélectionnée, créez des valeurs secrètes chiffrées contenant
la CA racine PEM, le certificat client et la clé privée. Saisissez leurs références exactes dans
**Configuration du protocole**, par exemple :

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

Utilisez les vrais noms de vos variables secrètes. La CA est facultative quand la confiance du
système suffit ; le certificat client et la clé doivent être fournis ensemble, et la phrase de
passe ne sert que pour une clé chiffrée. Chaque champ PEM résolu est limité à 256 Kio. Les
certificats et clés en clair dans une configuration enregistrée sont refusés. L'adresse résolue
doit utiliser `grpcs://`, y compris quand elle est fournie par une variable d'environnement. La
correspondance certificat/clé, la confiance et le nom d'hôte de destination sont vérifiés ; il n'y
a pas de repli non sécurisé. Faites tourner les identifiants en changeant les valeurs des secrets
d'environnement, puis relancez le test ; les versions gardent des références, pas le contenu PEM.
Seuls les champs TLS résolus nécessaires transitent par le relais authentifié de l'agent ; les
tickets contiennent des noms de capacités. Les valeurs d'environnement et le contenu PEM sont
masqués dans les erreurs de transport et l'historique des requêtes.

Les plans qui utilisent des agents locaux exécutent tous ces protocoles depuis le réseau de
l'agent. Passez à l'**agent 1.2.0** en téléchargeant le nouveau script et ses dépendances ou en
reconstruisant et redémarrant l'agent Docker ([Local agents](/en/integrations/local-agents), en
anglais). Les agents natifs plus anciens peuvent encore exécuter les appels unaires et WebSocket
historiques, mais les tickets avancés exigent `native-protocol-v2` ; un pool non compatible échoue
explicitement. L'aperçu **Envoyer** de l'éditeur s'exécute depuis le serveur. Les restrictions
existantes de proxy obligatoire et de destination s'appliquent toujours.

## Importer depuis OpenAPI, Postman ou WSDL {#import}

**Tests enregistrés → Importer** crée des tests à partir de ce qu'une équipe a déjà : une
description **OpenAPI 3** ou **Swagger 2**, en JSON ou en YAML, une **collection Postman** (v2.0 ou
v2.1), ou le **WSDL** (1.1/2.0) d'un service SOAP. Ouvrez le fichier ou collez-le, cliquez sur
**Voir ce qui sera créé**, gardez les tests que vous voulez — ceux dont la méthode et l'adresse
existent déjà ici sont décochés — choisissez un projet et importez.

- Un test par opération (OpenAPI) ou requête (Postman), nommé d'après son résumé, son operation id
  ou son nom Postman, regroupé par son tag ou son dossier comme module.
- L'adresse commence par <code v-pre>{{baseUrl}}</code> ; les paramètres de chemin deviennent
  <code v-pre>{{nom}}</code> (le `:nom` de Postman aussi). Les <code v-pre>{{variables}}</code>
  propres à Postman ont la même syntaxe et restent telles quelles.
- Les paramètres de query et d'en-tête obligatoires reçoivent leur exemple, leur valeur par défaut
  ou leur première valeur autorisée, ou une variable. Le corps est l'exemple de l'opération, ou un
  corps construit à partir de son schéma (formulaires JSON et URL-encoded) ; les corps raw,
  URL-encoded et GraphQL de Postman sont conservés.
- La sécurité devient l'autorisation du test — bearer, basic ou API key — avec le secret en
  variable (<code v-pre>{{token}}</code>, <code v-pre>{{password}}</code>…). Un secret écrit dans une
  collection Postman n'est pas importé.
- Le statut attendu est une assertion : la première réponse 2xx d'OpenAPI, ou le
  `pm.response.to.have.status(…)` de Postman.
- Depuis un WSDL : un `POST` par opération du binding SOAP sélectionné, avec une enveloppe et des
  champs de schéma écrits `?` à remplir. SOAP 1.1 utilise `SOAPAction` ; SOAP 1.2 l'action du
  content-type. Une opération requête-réponse attend `200` et aucun `//Fault` ; une opération
  one-way attend un statut 2xx.

L'aperçu liste les variables dont les tests ont besoin, avec l'adresse du serveur comme suggestion
pour <code v-pre>{{baseUrl}}</code> : définissez-les dans un
[environnement](./web-tests#variables-and-environments) avant d'exécuter. Ce qui n'a pas pu être
repris est indiqué pour chaque test : corps multipart, scripts Postman au-delà du contrôle de
statut, scripts de pré-requête, flux OAuth (le test envoie alors <code v-pre>{{token}}</code>). Au
plus 500 tests par import, 12 Mo par fichier ; le journal d'audit consigne chaque import.

### Lots WSDL/XSD hors ligne

Ouvrez plusieurs fichiers ou un dossier, choisissez le WSDL racine et modifiez les emplacements
logiques pour que les imports se résolvent par rapport au document qui importe (par exemple
`service.wsdl`, `types/request.xsd`, `types/base.xsd`). Les chemins des dossiers sont conservés.
Sélectionnez le point d'accès SOAP dans l'aperçu ; changer de fichiers, d'emplacements ou de point
d'accès invalide l'aperçu précédent.

Les imports WSDL 1.1, les imports/includes WSDL 2.0 et les opérations SOAP HTTP requête-réponse et
one-way sont pris en charge, y compris import/include XSD, noms qualifiés, références d'éléments,
extensions de types complexes, sequence/all/choice imbriqués et groupes de modèles nommés (y
compris entre espaces de noms et includes caméléon). Les choice génèrent la première alternative
activée avec un avertissement ; modifiez-la si une autre branche est nécessaire. Les particules
répétées génèrent le minimum d'occurrences requises, ou un exemple pour les particules
facultatives ; `maxOccurs="0"` omet la particule. Les jokers ne bloquent plus l'import : `xsd:any`
laisse un commentaire XML et un avertissement avec l'espace de noms, processContents et le minimum
d'occurrences. Fournissez à la main les éléments correspondants, surtout pour les jokers
obligatoires. Les attributs, groupes d'attributs, anyAttribute et simpleContent demandent encore
d'être complétés à la main.

Les limites sont de 32 documents, 10 Mio au total, une profondeur d'import et d'éléments de 10, une
imbrication de particules de 32 et 5 000 éléments ou particules développés par opération. Les
dépendances ne sont résolues qu'à partir des documents téléversés : aucune lecture réseau ou
fichier ; DTD/entités, dépendances manquantes ou ambiguës et chemins dangereux sont refusés. Les
bindings RPC/encoded, les restrictions de contenu complexe, les bornes d'occurrences invalides et
les squelettes récursifs échouent explicitement. Les policies, références de policy, modules et
en-têtes SOAP qui demandent un travail manuel produisent des avertissements dans l'aperçu. Relisez
les enveloppes générées avant d'exécuter : placeholders, facettes, éléments abstraits et groupes de
substitution ne constituent ni une validation de schéma ni une requête prête à l'envoi. Le lot
partagé dans `collaudo/fixtures/wsdl` est synthétique ; la compatibilité avec de vrais contrats
clients reste à valider.

## Enregistrer

**Enregistrer le test** demande un nom et, éventuellement, un projet ; **Enregistrer les
modifications** met à jour le test ouvert depuis **Tests enregistrés**. Un test API enregistré peut
être ajouté aux plans de test, et utilisé comme [précondition](./web-tests#preconditions) d'un test
web.

## Versions et publication

Les tests enregistrés ont un [historique, une comparaison et une restauration](./organizing#history-and-versions).
La [publication et les relectures](./organizing#publishing-and-reviews) choisissent la révision
qu'exécutent les plans ; enregistrer ou restaurer une copie de travail laisse en place une
publication existante. **Tester** exécute la copie de travail enregistrée du test API.
