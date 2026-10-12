# Tests web

Un test web est une **séquence d'étapes** qu'un navigateur effectue sur votre application : aller
sur une page, saisir dans un champ, cliquer, vérifier ce qui s'affiche. Vous le construisez dans
**Créer un Test**.

## Charger l'application

1. Saisissez l'adresse dans **URL du site à tester** et cliquez sur **Charger le site**. La page est
   ouverte par un vrai navigateur sur le serveur, et une capture d'écran apparaît dans **Aperçu du
   site**.
2. Cliquez sur **Détecter les éléments**. La liste des **Éléments détectés** montre ce qui peut être
   cliqué, rempli ou vérifié sur la page — boutons, champs, liens, listes déroulantes — chacun avec
   le sélecteur que le test utilisera pour le trouver.

![Créer un Test avec la page chargée : actions disponibles, aperçu du site et éléments détectés](/screenshots/builder-detected.webp)

Seul ce qui est visible au chargement de la page est détecté. Pour un élément qui apparaît plus
tard (un menu qui s'ouvre, une seconde page), ajoutez les étapes qui y mènent, exécutez-les, et
détectez de nouveau.

## Construire la séquence

Faites glisser une action depuis **Actions disponibles** dans la **Séquence du test**, puis déposez
dessus un élément détecté (ou utilisez **Définir l’élément**). Renseignez la valeur dont l'action a
besoin : le texte à saisir, l'option à choisir, le texte attendu.

![Les étapes dans la séquence du test, sous l'aperçu](/screenshots/builder-sequence.webp)

| Action                                                 | Ce qu'elle fait                                                                                                                                                                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Aller à**                                            | Va à une adresse.                                                                                                                                                                                                                   |
| **Cliquer sur un élément**                             | Clique.                                                                                                                                                                                                                             |
| **Saisir du texte**                                    | Saisit dans un champ.                                                                                                                                                                                                               |
| **Choisir une option**                                 | Choisit une option d'une liste déroulante native.                                                                                                                                                                                   |
| **Choisir Dans La Liste**                              | Ouvre une liste déroulante personnalisée et choisit une option par son texte.                                                                                                                                                       |
| **Survoler**                                           | Passe la souris sur un élément (pour les menus qui s'ouvrent au survol).                                                                                                                                                            |
| **Faire défiler**                                      | Fait défiler la page ou un élément.                                                                                                                                                                                                 |
| **Mettre dans l’état**                                 | Coche ou décoche une case ou un interrupteur, seulement s'il ne l'est pas déjà.                                                                                                                                                     |
| **Attendre**                                           | Attend un nombre fixe de millisecondes. Préférez les attentes ci-dessous.                                                                                                                                                           |
| **Attendre Élément**                                   | Attend qu'un élément soit visible, ou masqué.                                                                                                                                                                                       |
| **Attendre Texte**                                     | Attend qu'un élément contienne un texte.                                                                                                                                                                                            |
| **Attendre Réseau**                                    | Attend que les requêtes de la page soient terminées.                                                                                                                                                                                |
| **Vérifier la présence**                               | Échoue si l'élément n'est pas visible.                                                                                                                                                                                              |
| **Vérifier le texte**                                  | Échoue si l'élément ne contient pas le texte.                                                                                                                                                                                       |
| **Vérifier le nombre d’éléments**                      | Échoue si le nombre d'éléments correspondants n'est pas le bon, par ex. `==1`, `>=5`, `<3`.                                                                                                                                         |
| **Vérifier l’état**                                    | Échoue si un contrôle n'est pas coché, activé, modifiable — ou l'inverse.                                                                                                                                                           |
| **Vérifier l'accessibilité**                           | Contrôle la page avec axe-core à cet instant, et échoue sur les violations de la gravité choisie ou au-dessus (serious par défaut).                                                                                                 |
| **Définir la position**                                | À partir de là, le navigateur indique cette position à la page — voir [Position et téléchargements](#location-and-downloads).                                                                                                       |
| **Vérifier un téléchargement**                         | Clique sur l'élément et vérifie le fichier qu'il télécharge — voir [Position et téléchargements](#location-and-downloads).                                                                                                          |
| **Mesurer la vitesse de la page**                      | Compare aux limites les Core Web Vitals et les durées que le navigateur a mesurés pour la page — voir [Vitesse des pages](#page-speed).                                                                                             |
| **Audit Lighthouse**                                   | Exécute Lighthouse sur la page courante et vérifie ses scores — voir [Vitesse des pages](#page-speed).                                                                                                                              |
| **Appuyer sur une touche**                             | Appuie sur une touche ou une combinaison — `Enter`, `Tab`, `Escape`, `Control+A` — sur l'élément, ou sur ce qui a le focus quand l'étape n'en a pas.                                                                                |
| **Double-clic** / **Clic droit**                       | Double-clique, ou ouvre le menu contextuel de l'élément.                                                                                                                                                                            |
| **Glisser-déposer**                                    | Fait glisser l'élément sur celui dont le sélecteur est la valeur.                                                                                                                                                                   |
| **Téléverser un fichier**                              | Donne à un champ fichier — ou au bouton qui ouvre le sélecteur de fichiers — un fichier fait à partir de la valeur : `invoice.csv`, ou `invoice.csv\|son contenu`.                                                                  |
| **Répondre à la boîte de dialogue**                    | Indique comment répondre au prochain `alert`, `confirm` ou `prompt` : `accept`, `dismiss` ou `accept:texte`. Placez-la **avant** l'étape qui ouvre la boîte de dialogue. Une boîte de dialogue sans réponse est fermée.             |
| **Changer d'onglet**                                   | Continue dans un autre onglet : vide pour le plus récent, un numéro (à partir de 1), ou un texte de son adresse ou de son titre.                                                                                                    |
| **Fermer l'onglet**                                    | Ferme l'onglet courant et revient à celui qui l'a ouvert.                                                                                                                                                                           |
| **Stocker le texte dans une variable**                 | Lit le texte de l'élément, ou la valeur d'un champ, dans la variable que nomme la valeur, pour les étapes suivantes.                                                                                                                |
| **Définir une variable**                               | `nom=valeur`, pour les étapes suivantes. Voir [valeurs générées](#generated-values).                                                                                                                                                |
| **Attendre un e-mail**                                 | Attend l'e-mail envoyé à une adresse et lit son code et son lien dans des variables. Voir [e-mails](#emails).                                                                                                                       |
| **Attendre un SMS**                                    | Attend le SMS envoyé à un numéro de test et lit son code dans une variable. Voir [SMS](#sms).                                                                                                                                       |
| **Requête base de données**                            | Exécute une instruction SQL sur la base de données de l'environnement et lit la première ligne dans des variables. Voir [base de données](#database).                                                                               |
| **Vérifier des valeurs**                               | Échoue si une comparaison n'est pas vérifiée : <code v-pre>{{db.value}} == 1</code>, <code v-pre>{{total}} > 0</code>, <code v-pre>{{email.subject}} contains Welcome</code>. Les mêmes comparaisons qu'une condition sans élément. |
| **Définir un cookie** / **Effacer les cookies**        | `nom=valeur` pour l'adresse courante ; ou les supprime tous.                                                                                                                                                                        |
| **Définir localStorage**                               | `clé=valeur` dans le stockage de la page courante.                                                                                                                                                                                  |
| **Exécuter du JavaScript**                             | Exécute la valeur dans la page. Échoue quand elle lève une erreur ou renvoie `false` : elle peut donc vérifier ce qu'aucune autre étape ne peut vérifier.                                                                           |
| **Simuler une requête**                                | À partir de là, répond aux requêtes de la page vers une adresse à la place du serveur — voir [Simuler le réseau](#mocking-the-network).                                                                                             |
| **Bloquer des requêtes**                               | À partir de là, les requêtes de la page vers une adresse échouent comme si le réseau était coupé.                                                                                                                                   |
| **Retirer les simulations**                            | Annule toutes les simulations et tous les blocages : la page atteint de nouveau les vrais serveurs.                                                                                                                                 |
| **Si** / **Sinon** / **Fin si**                        | N'exécute des étapes que quand une condition est vérifiée. Voir [conditions et boucles](#conditions-and-loops).                                                                                                                     |
| **Répéter** / **Répéter tant que** / **Fin de boucle** | Exécute des étapes un certain nombre de fois, ou tant qu'une condition est vérifiée.                                                                                                                                                |

Chaque action attend déjà que son élément soit prêt avant d'agir : une **Attendre** fixe est donc
rarement nécessaire ; quand une étape échoue parce que quelque chose était lent, attendez la chose
elle-même.

Changez l'action ou l'élément d'une étape depuis l'étape, supprimez-la avec sa corbeille, et
**Effacer** pour recommencer.

Un **Enter** enregistré est rejoué comme une étape **Appuyer sur une touche** après la valeur du
champ où il a été tapé : une recherche validée avec Entrée est donc de nouveau validée au rejeu.

## Conditions et boucles {#conditions-and-loops}

**Si**, **Sinon** et **Fin si** sont des étapes comme les autres, placées autour des étapes qu'elles
régissent ; de même pour **Répéter** ou **Répéter tant que** et **Fin de boucle**. Le constructeur
indente ce qui est à l'intérieur d'un bloc et liste les blocs non fermés ; un test qui en contient un
échoue avant l'ouverture d'un navigateur, en nommant l'étape.

Une condition prend l'une de deux formes :

- **Avec un élément** : l'état dans lequel il est _maintenant_ — `visible`, `hidden`, `exists`,
  `missing`, `checked`, `unchecked`, `enabled`, `disabled`, ou `contains:texte` /
  `not contains:texte`. La réponse est immédiate : « si le bandeau de cookies est visible, le
  fermer » passe aussitôt à la suite quand il n'y a pas de bandeau. Pour quelque chose encore en
  cours de chargement, mettez une étape d'attente avant la condition.
- **Sans élément** : une comparaison de valeurs — <code v-pre>{{status}} == Paid</code>,
  <code v-pre>{{count}} > 3</code>, <code v-pre>{{title}} contains Order</code>, avec `==`, `!=`,
  `>`, `<`, `>=`, `<=`, `contains`, `not contains` — ou une variable qui contient `true` ou
  `false`.

**Répéter** prend un nombre de fois ; à l'intérieur, <code v-pre>{{loopIndex}}</code> compte à
partir de 1. **Répéter tant que** évalue sa condition avant chaque passage. Une boucle arrête le
test après 200 passages, pour qu'une condition qui ne devient jamais fausse ne bloque pas un worker
indéfiniment. Avec les tests visuels, chaque passage d'une boucle est comparé à sa propre référence.

## L'essayer

**Exécuter le test** exécute la séquence dans un navigateur sur le serveur et rejoue le résultat
étape par étape dans l'aperçu, avec une capture d'écran de chaque étape. Une étape en échec dit
pourquoi. Exécuter n'enregistre rien.

![Un test exécuté dans le constructeur, toutes les étapes réussies](/screenshots/builder-passed.webp)

## Déboguer {#debugging}

**Déboguer** exécute la séquence de façon à pouvoir s'arrêter, être corrigée et reprendre, pendant
que le navigateur est encore ouvert :

- **Points d'arrêt** : cliquez sur le point d'une étape pour le faire passer au rouge. L'exécution
  s'arrête avant cette étape. Un point d'arrêt sur un appel de groupe d'étapes s'arrête à la
  première étape du groupe. Les points d'arrêt peuvent être posés et retirés pendant qu'une session
  s'exécute.
- **Là où une étape échoue**, l'exécution ne se termine pas : elle s'y arrête, avec l'erreur.

Quand elle s'arrête, le panneau **Débogueur** montre pourquoi, la page à cet instant et son adresse,
les étapes exécutées jusque-là et les variables (les valeurs qui viennent de l'environnement sont
des secrets : seuls leurs noms sont affichés). L'étape où elle s'est arrêtée a un contour coloré sur
le canevas. À partir de là :

| Commande      | Effet                                                                     |
| ------------- | ------------------------------------------------------------------------- |
| **Continuer** | Poursuit jusqu'au prochain point d'arrêt, au prochain échec ou à la fin.  |
| **Pas à pas** | Exécute cette étape et s'arrête avant la suivante.                        |
| **Réessayer** | Après un échec : réexécute l'étape, avec la correction s'il y en a une.   |
| **Passer**    | Saute cette étape. Non proposé pour si, sinon, les boucles et leurs fins. |
| **Arrêter**   | Termine l'exécution et ferme le navigateur.                               |
| **Pause**     | Pendant l'exécution : s'arrête avant l'étape suivante.                    |

Le **sélecteur** et la **valeur** de l'étape peuvent être corrigés avant de continuer, d'avancer pas
à pas ou de réessayer. Une correction apportée à l'une des étapes propres au test est aussi recopiée
dans le canevas ; **enregistrez** le test pour la garder. Une correction apportée à une étape à
l'intérieur d'un groupe d'étapes ne vaut que pour cette exécution.

Une exécution qui a sauté une étape n'est jamais rapportée comme réussie. Un test piloté par les
données se débogue avec une ligne de son dataset, choisie à côté de **Déboguer** (la première sauf
si vous en choisissez une autre). Une session laissée en pause 15 minutes ferme son navigateur.
Chaque personne a une session à la fois : en démarrer une autre arrête la première.

## Enregistrement

Avec **Mode de création du test → Enregistrer les actions de l’utilisateur**, **Démarrer
l’enregistrement** ouvre une fenêtre de navigateur où vous utilisez l'application comme d'habitude ;
chaque clic et chaque saisie devient une étape. Utilisez **Add assert** dans la barre d'outils de
l'enregistreur pour enregistrer un résultat attendu. **Arrêter l’enregistrement** place les étapes
dans la séquence, en remplaçant ce qui s'y trouvait.

::: warning L'enregistreur s'ouvre sur la machine du serveur
La fenêtre d'enregistrement est un vrai navigateur sur la machine qui exécute WebFlowMaster, pas un
onglet de votre navigateur. Cela fonctionne quand le serveur tourne sur votre propre ordinateur ;
sur un serveur partagé sans écran, l'enregistrement n'est pas disponible, et vous construisez les
tests en faisant glisser des étapes ou en les décrivant.
:::

Les mots de passe saisis pendant l'enregistrement ne sont pas stockés dans le test : ils deviennent
des placeholders <code v-pre>{{secret&#95;…}}</code>, que vous définissez comme secrets d'un
environnement.

## Décrire un test en phrases

![La fenêtre Décrire avec un test écrit en phrases](/screenshots/builder-describe.webp)

**Décrire** transforme des instructions simples en étapes, une par ligne, avec les mots d'un
ticket :

```text
Go to https://example.com/login
Type "admin" into the Username field
Click the Sign in button
Check that the dashboard is visible
```

**Lire la description** montre chaque ligne sous la forme de l'étape qu'elle est devenue avant que
rien ne soit inséré : une phrase mal comprise est repérée avant de devenir un test qui réussit pour
de mauvaises raisons. Les éléments sont rapprochés des éléments détectés et, si vous en choisissez
un, du référentiel d'éléments d'un projet. Les formulations courantes sont comprises sans IA ; quand
l'installation dispose d'une clé d'IA, le reste est aussi lu par le modèle (lignes marquées **IA**).
Sans IA, cela inclut les touches (`Press Enter in the Password field`), `Double-click …` /
`Right-click …`, `Upload invoice.pdf to the Attachment field`, `Accept the dialog` /
`Accept the prompt with "42"`, les onglets, les cookies et `Save the text of … as orderNumber`.

## Variables et environnements {#variables-and-environments}

Toute valeur d'une étape peut contenir des placeholders <code v-pre>{{nom}}</code>, remplis à
l'exécution du test :

- depuis l'**environnement** choisi dans le constructeur, l'exécution du plan ou la planification :
  ses secrets (**Paramètres → Environnements**), par exemple
  <code v-pre>{{ADMIN&#95;PASSWORD}}</code>. Un secret nommé `baseUrl` définit
  <code v-pre>{{baseUrl}}</code> : un même test peut ainsi démarrer à
  <code v-pre>{{baseUrl}}/login</code> dans chaque environnement ;
- depuis une ligne de **dataset** (voir plus bas) ;
- <code v-pre>{{locale}}</code>, la langue dans laquelle un plan exécute le test (voir
  [Tester en plusieurs langues](./running#languages)) ;
- depuis des valeurs capturées par un test API plus tôt dans la même exécution.

- depuis des étapes **Stocker le texte dans une variable** et **Définir une variable** plus tôt dans
  le même test. Ces valeurs n'appartiennent qu'à cette exécution.

Un placeholder que rien ne définit n'est pas vidé : l'étape échoue et nomme la variable manquante.

### Valeurs générées {#generated-values}

Un placeholder qui commence par `$` invente une valeur à chaque utilisation, partout où les
variables sont acceptées — une étape, une URL, un test API :

| Placeholder                                                      | Valeur                                                                                                                                         |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| <code v-pre>{{$randomEmail}}</code>                              | `test.k3v9…@example.com` (un domaine qui ne livre nulle part)                                                                                  |
| <code v-pre>{{$uuid}}</code>                                     | Un UUID aléatoire                                                                                                                              |
| <code v-pre>{{$randomInt(1,100)}}</code>                         | Un nombre entier entre les deux, bornes comprises (0–1000 par défaut)                                                                          |
| <code v-pre>{{$randomString(8)}}</code>                          | Lettres et chiffres                                                                                                                            |
| <code v-pre>{{$randomDigits(6)}}</code>                          | Chiffres uniquement                                                                                                                            |
| <code v-pre>{{$today}}</code>, <code v-pre>{{$today(+7)}}</code> | Une date, `yyyy-mm-dd`, aujourd'hui ou à autant de jours d'ici                                                                                 |
| <code v-pre>{{$now}}</code>, <code v-pre>{{$timestamp}}</code>   | L'heure actuelle, en ISO ou en millisecondes                                                                                                   |
| <code v-pre>{{$totp(secret&#95;mfa)}}</code>                     | Le code qu'une application d'authentification affiche maintenant pour la graine de la variable nommée ; voir [connexion en deux étapes](#totp) |

Chaque placeholder est une nouvelle valeur. Pour en utiliser une deux fois — s'inscrire avec une
adresse, puis se connecter avec — nommez-la d'abord : **Définir une variable**
<code v-pre>email={{$randomEmail}}</code>, puis <code v-pre>{{email}}</code>. Un générateur mal
orthographié fait échouer l'étape comme une variable manquante.

Les valeurs secrètes sont chiffrées, ne sont plus jamais affichées après l'enregistrement, et sont
masquées dans les journaux.

### Connexion en deux étapes avec une application d'authentification {#totp}

Quand l'application demande le code à six chiffres d'une application d'authentification (Google
Authenticator, Microsoft Authenticator…), <code v-pre>{{$totp(nom)}}</code> saisit le code que
l'application afficherait à cet instant. Enrôlez une fois le compte de test, et gardez ce que
l'application a affiché comme secret de l'environnement, par exemple `secret_mfa` : la clé écrite
sous le QR code (`JBSW Y3DP EHPK 3PXP`, espaces et casse sans importance), ou l'adresse contenue
dans le QR code (`otpauth://totp/…?secret=…`), qui porte aussi le nombre de chiffres, la période et
l'algorithme quand ce ne sont pas les habituels 6, 30 secondes et SHA-1. Ensuite, l'étape
**Saisir du texte** <code v-pre>{{$totp(secret&#95;mfa)}}</code> dans le champ du code.

L'argument est le **nom** de la variable, jamais la clé elle-même : la clé reste ainsi chiffrée et
hors du test. Un nom que l'environnement ne définit pas, ou une valeur qui n'est pas une clé, fait
échouer l'étape en la nommant. Le code est calculé à partir de l'horloge du runner, qui doit être
juste à quelques secondes près.

### Démarrer déjà connecté

Pour éviter la connexion dans chaque test : choisissez l'environnement dans le constructeur,
démarrez un enregistrement, connectez-vous dans la fenêtre d'enregistrement et cliquez sur **Save
login for this environment**. Les exécutions sur cet environnement démarrent alors avec cette
session ; l'environnement apparaît comme _connexion enregistrée_ dans le sélecteur. Enregistrez-la
de nouveau quand la session expire.

### E-mails : codes et liens {#emails}

L'inscription, la réinitialisation du mot de passe et la connexion en deux étapes envoient un
e-mail que le test doit lire. L'étape **Attendre un e-mail** le lit dans la **boîte de test** de
l'environnement, un [Mailpit](https://mailpit.axllent.org) : un capteur d'e-mails qui accepte tout
ce que l'application envoie sur son port SMTP, pour n'importe quelle adresse. Faites pointer le SMTP
de l'application vers lui dans l'environnement de test (port 1025) et chaque adresse a une boîte, y
compris les adresses inventées.

Une inscription, du début à la fin :

| Action               | Valeur                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| Définir une variable | <code v-pre>email={{$randomEmail}}</code>                                                                 |
| Saisir du texte      | <code v-pre>{{email}}</code> dans le champ d'adresse, puis valider le formulaire                          |
| Attendre un e-mail   | <code v-pre>{{email}}\|Confirm your account</code>                                                        |
| Saisir du texte      | <code v-pre>{{email.otp}}</code> dans le champ du code — ou **Aller à** <code v-pre>{{email.link}}</code> |

La valeur est l'adresse, éventuellement suivie de `|` et d'un texte que contient l'objet, puis d'un
second `|` et d'une expression régulière pour le code :
<code v-pre>{{email}}|Your code|code: (&#91;A-Z0-9-]+)</code> lit ce que capture son premier
groupe. L'étape attend jusqu'à 60 secondes le plus récent e-mail envoyé à cette adresse exacte (en
To, Cc ou Bcc) et arrivé **après le début du test** : une adresse fixe comme celle d'un utilisateur
pré-créé ne lit donc pas l'e-mail de l'exécution précédente. Elle définit ensuite :

| Variable                                                                                                   | Contient                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <code v-pre>{{email.otp}}</code>                                                                           | Le code : le premier nombre de 4 à 8 chiffres après un mot comme _code_, _OTP_, _PIN_ ou _verification_, ou le seul de l'e-mail ; avec un motif, ce que le motif a trouvé |
| <code v-pre>{{email.link}}</code>                                                                          | Le premier lien à suivre, en ignorant les liens de désinscription, les images et les feuilles de style                                                                    |
| <code v-pre>{{email.subject}}</code>, <code v-pre>{{email.from}}</code>, <code v-pre>{{email.text}}</code> | L'objet, l'adresse de l'expéditeur et le texte (un e-mail uniquement HTML est converti en texte)                                                                          |

Une variable que l'e-mail n'a pas fournie — pas de code, pas de lien — reste indéfinie : une étape
ultérieure qui l'utilise échoue en la nommant, au lieu de saisir une valeur d'un e-mail précédent.
Un motif qui ne trouve rien fait échouer l'étape.

**Quelle boîte.** Les secrets de l'environnement `mailpit.url` (par exemple
`https://mail.staging.example`) et, s'il les demande, `mailpit.username` et `mailpit.password` ;
`mailpit.timeout` change l'attente, en secondes. Sans eux, celle du serveur (`MAILPIT_URL`, que la
pile docker-compose règle sur son Mailpit intégré, ouvert sur http://localhost:8025). La boîte est
lue depuis là où s'exécute le navigateur : un plan sur un agent local atteint donc un Mailpit du
réseau de l'agent.

### SMS {#sms}

**Attendre un SMS** fait pour un code envoyé par SMS ce qu'**Attendre un e-mail** fait pour un code
envoyé par e-mail. Elle lit la **Boîte SMS** de l'organisation (Paramètres → Boîte SMS) : un
propriétaire y crée une adresse de réception, affichée une seule fois, et la définit comme webhook
des messages entrants des numéros de test chez le fournisseur SMS — _A message comes in_ chez
Twilio, l'inbound URL chez Vonage, ou tout fournisseur qui envoie `To` et `Body` (ou `to` et
`text`), en formulaire ou en JSON. Chaque message reçu par ces numéros y est rangé et conservé sept
jours ; la page des paramètres liste les plus récents.

La valeur de l'étape est le numéro, ou le numéro et un motif pour le code :
`+39 333 1234567` ou `+39 333 1234567|codice (\d{6})`. Les espaces, les tirets et un `00` initial
n'ont pas d'importance. Elle attend un message vers ce numéro arrivé après le début du test — 60
secondes, ou <code v-pre>sms.timeout</code> depuis l'environnement — et définit
<code v-pre>{{sms.otp}}</code> (le code, trouvé comme dans un e-mail), <code v-pre>{{sms.text}}</code>
et <code v-pre>{{sms.from}}</code>. Deux tests qui s'exécutent en même temps doivent utiliser des
numéros différents.

L'adresse de réception est le secret de l'organisation : la remplacer arrête immédiatement
l'ancienne, et la révoquer refuse tous les messages. Les requêtes qui lui sont adressées sont
limitées comme les webhooks (`WEBHOOK_RATE_LIMIT`).

### Base de données : vérifier et préparer les données {#database}

Ce qu'un écran ne montre pas — la ligne écrite par le paiement, l'indicateur posé par une page
d'administration — ou ce qu'un test doit préparer sans traverser dix écrans, une étape **Requête
base de données** le lit ou l'écrit directement. Sa valeur est une instruction SQL, avec des
variables :

| Action                  | Valeur                                                                        |
| ----------------------- | ----------------------------------------------------------------------------- |
| Requête base de données | <code v-pre>SELECT status, total FROM orders WHERE email = '{{email}}'</code> |
| Vérifier des valeurs    | <code v-pre>{{db.status}} == Paid</code>                                      |

Elle définit :

| Variable                           | Contient                                                                                                                                                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <code v-pre>{{db.value}}</code>    | La première colonne de la première ligne (vide quand il n'y a pas de ligne)                                                                                                                                                                         |
| <code v-pre>{{db.column}}</code>   | Chaque colonne de la première ligne par son nom — <code v-pre>{{db.status}}</code>, <code v-pre>{{db.total}}</code> ; les caractères autres que lettres, chiffres, `_` et `.` deviennent `_` : nommez donc les colonnes calculées (`count(*) AS n`) |
| <code v-pre>{{db.rowCount}}</code> | Les lignes renvoyées, ou celles qu'un INSERT, UPDATE ou DELETE a modifiées                                                                                                                                                                          |
| <code v-pre>{{db.json}}</code>     | Les 100 premières lignes, en JSON                                                                                                                                                                                                                   |

Les dates sont en ISO, les valeurs vides sont du texte vide. Chaque requête oublie les colonnes de
la précédente : une colonne que cette requête n'a pas renvoyée est indéfinie plutôt que restée de
la fois d'avant. Une instruction que la base refuse fait échouer l'étape avec le message de la
base.

**Quelle base.** Le secret de l'environnement `db.url`, une adresse dont le schéma choisit la
base :

| Base           | Adresse                                                                                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL     | `postgres://user:password@host:5432/shop` (`?sslmode=require` pour TLS)                                                                                                                                                |
| MySQL, MariaDB | `mysql://user:password@host:3306/shop`                                                                                                                                                                                 |
| SQL Server     | `sqlserver://user:password@host:1433/Shop` — `sqlserver://…@host%5CSQLEXPRESS/Shop` pour une instance nommée ; `?encrypt=false` pour un serveur sans TLS, `?trustServerCertificate=true` pour un certificat auto-signé |

Les caractères comme `@` ou `/` dans le mot de passe s'écrivent `%40` et `%2F`. Pour une seconde
base, nommez-la : `db.reporting.url` et la valeur `@reporting SELECT …`. `db.timeout` change la
limite de 30 secondes, en secondes. Au plus 1000 lignes sont conservées.

L'instruction s'exécute avec les droits de l'utilisateur de l'adresse : utilisez un utilisateur qui
ne peut lire que ce que les tests vérifient, et écrire que ce qu'ils préparent, et jamais une base
de production. La requête s'exécute depuis le runner WebFlowMaster, pas depuis le navigateur —
aussi sur un agent local — : le runner doit donc atteindre la base. Les valeurs sont insérées
telles quelles dans le SQL : mettez le texte entre guillemets (`'{{email}}'`), et utilisez des
variables dont le test maîtrise les valeurs.

## Position et téléchargements {#location-and-downloads}

**Définir la position** fait indiquer au navigateur une position à la page : `45.4642, 9.19`, ou
avec une précision en mètres, `45.4642, 9.19, 50`. À partir de cette étape,
`navigator.geolocation` y répond dans chaque onglet du test, et la page peut la demander sans
demande d'autorisation — pour un localisateur de magasins, des zones de livraison ou des prix par
région. Une **Définir la position** ultérieure la déplace.

**Vérifier un téléchargement** clique sur son élément, récupère le fichier que le clic télécharge,
le conserve avec les preuves de l'exécution et le vérifie. La valeur liste les vérifications,
séparées par `;` (un texte peut contenir des virgules) :

`name: invoice-*.pdf; contains: Total 1.234,50 €; pages >= 1`
`type: csv; rows >= 10; columns = 5; contains: Rossi, Mario`

- `name:` un motif pour le nom du fichier (`*` n'importe quels caractères) ; `type:` `pdf`, `csv`,
  `xlsx`, `json` ou `txt` ;
- `contains:` un texte que le contenu doit inclure, sans tenir compte de la casse ni des espaces —
  le texte d'un PDF, les cellules d'un CSV ou d'une feuille Excel (la première feuille), ou le
  fichier en texte ; répétez-le pour en vérifier plusieurs ;
- `size`, `rows`, `columns`, `pages` avec `<`, `<=`, `>`, `>=` ou `=` ; les tailles acceptent `KB`
  ou `MB`.

Vide, elle vérifie seulement qu'un fichier a été téléchargé. Un clic qui ne télécharge rien dans le
délai fait échouer l'étape. Les étapes suivantes peuvent utiliser
<code v-pre>{{download.name}}</code>, <code v-pre>{{download.size}}</code>,
<code v-pre>{{download.rows}}</code>, <code v-pre>{{download.pages}}</code> et
<code v-pre>{{download.text}}</code> (les 2 000 premiers caractères) — dans une étape **Vérifier des
valeurs**, par exemple. Le rapport renvoie au fichier et montre ce qu'il contenait.

## Vitesse des pages {#page-speed}

**Mesurer la vitesse de la page** lit ce que le navigateur lui-même a enregistré sur la page où se
trouve le test, à ce point du parcours, et échoue quand une limite est dépassée. Sa valeur liste
les limites :

`LCP < 2.5s, CLS <= 0.1, INP < 200, TTFB < 800ms, weight < 2MB`

| Métrique                     | Ce que c'est                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `LCP`                        | Largest Contentful Paint : quand le contenu principal est apparu.                                                                         |
| `CLS`                        | Cumulative Layout Shift : à quel point la page a sauté (plus grande fenêtre de 5 secondes).                                               |
| `INP`                        | Interaction to Next Paint : la réponse la plus lente à un clic ou une touche jusqu'ici ; mesurée seulement après une interaction du test. |
| `FCP`, `TTFB`, `DCL`, `LOAD` | Premier affichage, premier octet, DOM prêt, événement load.                                                                               |
| `TBT`                        | Total Blocking Time : les tâches longues après le premier affichage.                                                                      |
| `REQUESTS`, `WEIGHT`         | Combien de requêtes, et combien d'octets transférés (les fichiers d'autres origines sans `Timing-Allow-Origin` comptent pour 0).          |

Les durées acceptent `ms` ou `s`, les tailles `KB` ou `MB`. Laissée vide, elle vérifie les seuils
_bons_ des Core Web Vitals : `LCP <= 2500, CLS <= 0.1, INP <= 200`. Placez-la après le chargement
de la page — après une **Attendre l'élément** sur le contenu principal, par exemple — et après une
interaction quand l'INP compte. Seul Chromium mesure LCP, CLS, INP et TBT ; dans Firefox et WebKit,
ils s'affichent comme — et une limite les concernant est rapportée comme non mesurée plutôt qu'en
échec : le même test s'exécute ainsi dans tous les navigateurs.

**Audit Lighthouse** exécute [Lighthouse](https://developer.chrome.com/docs/lighthouse) sur
l'adresse de la page courante et vérifie les scores de ses catégories (0–100) :
`performance >= 80, accessibility >= 90, best-practices >= 90, seo >= 80`, plus `desktop` pour le
préréglage ordinateur (mobile par défaut). Vide, il enregistre les scores et ne vérifie rien.
Lighthouse recharge la page dans son propre Chromium sur le runner, en envoyant les cookies du test
pour cette adresse : une page derrière une connexion est donc auditée connectée ; cela prend de 15
à 60 secondes. Son rapport HTML complet est conservé avec les preuves de l'exécution. Il ne
s'exécute que sur les runners du serveur : un plan sur des agents locaux ou sur une grille de
navigateurs ne peut pas être audité depuis l'endroit où se trouve la page.

La carte **Vitesse des pages** du rapport d'exécution liste chaque page mesurée — les métriques par
navigateur, et les scores Lighthouse avec un lien vers le rapport — avec les limites que chacune a
dépassées, et le détail de chaque étape montre les mêmes chiffres.

## Simuler le réseau {#mocking-the-network}

Un test peut répondre lui-même aux requêtes de la page, pour voir les écrans que le vrai backend
montre rarement — une erreur, une liste vide, une réponse lente — ou pour s'exécuter quand le
backend n'est pas prêt. **Simuler une requête** prend

`[METHOD] adresse | statut [after 1500ms] | corps`

- **adresse** : une URL, ou un motif où `**` remplace n'importe quels caractères et `*` n'importe
  lesquels sauf `/` : `**/api/orders*`, <code v-pre>{{baseUrl}}/api/orders/42</code>. Avec une
  méthode devant (`GET`, `POST`…), seule cette méthode reçoit la réponse simulée ; les autres
  atteignent le serveur.
- **statut** : `200` s'il est omis ; `after 1500ms` (ou `after 2s`, jusqu'à 30 s) retarde la
  réponse, pour vérifier un état de chargement.
- **corps** : tout ce qui suit le second `|`, variables comprises. Le JSON est envoyé en
  `application/json`, le reste en texte.

`GET **/api/orders | 200 | []` montre la liste vide ;
`POST **/api/orders | 500 | {"error":"out of stock"}` la commande en échec. La simulation vaut pour
le reste du test et dans chaque onglet qu'il ouvre ; une simulation ultérieure de la même adresse
la remplace : un test peut donc changer sa réponse en cours de route. **Bloquer des requêtes** prend
une adresse et fait échouer ces requêtes — `**/analytics/**` tient un tiers à l'écart de
l'exécution — et **Retirer les simulations** annule tout ce qui a été posé jusque-là.

Seul ce que la page demande est concerné : les préconditions, le nettoyage et les tests API vont
vers les vrais serveurs.

## Préconditions

Les **Préconditions** sont des appels API exécutés avant les étapes, pour mettre l'application dans
l'état dont le test a besoin — créer un client, vider un panier. Choisissez-les parmi vos
[tests API](./api-tests) enregistrés ; ils s'exécutent dans l'ordre de la liste. Un test dont une
précondition échoue est rapporté comme bloqué, pas comme en échec.

## Nettoyage {#cleanup}

Les appels de **Nettoyage** sont des appels API faits après le test, qu'il ait réussi, échoué ou
été bloqué par une précondition, pour supprimer les données qu'il a créées — la commande qu'il a
passée, le client qu'une précondition a créé — afin que l'exécution suivante parte du même état et
que l'application testée ne se remplisse pas de données de test. Choisissez-les parmi vos
[tests API](./api-tests) enregistrés, en général des requêtes `DELETE` ; ils s'exécutent dans
l'ordre de la liste.

- Ils peuvent utiliser les valeurs stockées par les étapes :
  <code v-pre>DELETE {{baseUrl}}/orders/{{orderId}}</code> après une étape **Stocker le texte dans
  une variable** qui a gardé le numéro de commande dans `orderId`. Un appel qui nomme une variable
  que l'exécution n'a jamais définie — le test a échoué avant l'étape qui la stocke — n'est pas
  fait, et le rapport dit qu'il a été ignoré.
- Chaque appel est tenté, même après l'échec de l'un d'eux. `404` et `410` comptent comme **déjà
  supprimé** : un nettoyage peut donc être relancé sans risque.
- Avec un [dataset](#datasets), le nettoyage s'exécute une fois par ligne, après toutes les lignes,
  avec les valeurs de cette ligne ; ce qu'une précondition a créé est supprimé par la première ligne
  et déjà supprimé pour les autres.
- Le nettoyage ne change jamais le résultat du test. Le rapport le montre comme une ligne
  **Nettoyage** après les étapes, en échec quand un appel a échoué — des données ont pu rester — et
  le journal d'exécution nomme l'appel.

**Exécuter le test** dans le constructeur exécute aussi le nettoyage. Le débogueur ne le fait pas :
une session en pause à mi-chemin supprimerait ce que vous êtes en train de regarder.

## Datasets

Pour exécuter le même test sur plusieurs entrées, donnez-lui un **dataset** : un tableau dont les
noms de colonnes deviennent des variables. Le test s'exécute une fois par ligne. Construisez-le en
ajoutant colonnes et lignes, ou **Coller depuis un tableur** : copiez le bloc depuis Excel ou
Google Sheets, ligne d'en-tête comprise.

Quand les lignes sont partagées avec d'autres tests, gardez-les dans un
[jeu de données partagé](./organizing#test-data) et choisissez-le plutôt dans **Utiliser un jeu de
données partagé** : le test ne garde qu'un lien, s'exécute sur les lignes du jeu telles qu'elles
sont au moment de l'exécution, et suit le jeu s'il est renommé. **Utiliser une copie comme lignes
propres à ce test** retransforme le lien en lignes propres.

## Groupes d'étapes

Une séquence utilisée par de nombreux tests — se connecter, choisir un client — peut être
enregistrée avec **Enregistrer comme groupe**. Elle apparaît alors sous **Groupes d'étapes** dans la
palette, et n'importe quel test peut l'inclure. Un test exécute le groupe tel qu'il est au moment de
l'exécution : modifier le groupe modifie donc chaque test qui l'utilise.

La roue dentée à côté de **Groupes d'étapes** dans la palette ouvre leur gestion : **Où il est
utilisé** nomme les tests qui appellent un groupe, **Modifier** change son nom et sa description —
et, avec la case cochée, remplace ses étapes par celles qui sont maintenant dans le constructeur,
après qu'**Ouvrir dans le constructeur** les y a placées pour être modifiées — et **Supprimer**
retire un groupe qu'aucun test n'appelle ; un groupe encore appelé est refusé, en nommant les tests.

## Actions personnalisées {#custom-actions}

Quand aucune action intégrée ne fait ce dont un test a besoin, un éditeur peut en écrire une :
**Paramètres → Actions personnalisées → Nouvelle action personnalisée**, avec un nom, des
paramètres et un script. L'action apparaît sous **Actions personnalisées** dans la palette, et un
test l'utilise comme n'importe quelle autre étape.

- Les **Paramètres** sont listés séparés par des virgules ; un `?` final en rend un facultatif
  (`code, qty?`). Dans le test, la valeur de l'étape donne les arguments : `code=4711; qty=2`.
  Écrivez `\;` pour un point-virgule dans une valeur. Les arguments peuvent contenir des
  <code v-pre>{{variables}}</code> et des valeurs générées. Un argument manquant ou inconnu, ou une
  valeur sans `=`, fait échouer le test avant l'ouverture du navigateur — dans **Exécuter le test**
  du constructeur comme dans un plan — en nommant l'argument.
- **Le script** est le corps d'une fonction async qui s'exécute dans la page testée. Il lit ses
  arguments dans `args` (`args.code`) et, quand l'étape a un élément, cet élément dans `element`
  (trouvé avec `document.querySelector`, donc un sélecteur CSS). Il fait échouer l'étape en levant
  une erreur ou en renvoyant `false` ; tout ce qu'il renvoie d'autre est affiché dans le rapport.

```js
const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes(args.code));
if (!row) throw new Error(`No order ${args.code}`);
row.querySelector('button.open').click();
```

Une action personnalisée a les pouvoirs d'une étape **Exécuter du JavaScript**, et aucun autre :
elle s'exécute dans la page du navigateur, jamais sur le serveur ni sur le runner. Les tests font
référence à l'action plutôt que de la copier : la modifier change donc chaque test qui l'utilise à
sa prochaine exécution ; une action encore utilisée par un test ou un groupe d'étapes ne peut pas
être supprimée, et le message nomme ce qui l'utilise. Sa création, sa modification et sa
suppression sont consignées dans le journal d'audit, sans le script.

## Référentiel d'éléments {#element-repository}

Quand le même élément est utilisé par de nombreux tests, **conservez-le** : le signet sur un élément
détecté l'enregistre dans un projet avec un nom. Les tests qui l'utilisent lisent son sélecteur
dans le projet : quand l'application change, corriger une seule fois le sélecteur dans
**Paramètres → Référentiel d'éléments** répare tous les tests.

Quand une étape ne trouve pas son élément et que l'installation dispose d'une clé d'IA, l'exécution
peut le **réparer** : elle demande un nouveau sélecteur, réessaie et marque l'étape _réparé_ dans
le rapport. Un élément conservé réparé montre l'ancien et le nouveau sélecteur dans le référentiel,
pour que vous confirmiez.

## Enregistrer

**Enregistrer le test** demande un nom et, éventuellement, un projet (vous pouvez en créer un à cet
endroit). Enregistrer de nouveau sous le même nom propose d'écraser. Chaque enregistrement est une
nouvelle **version** dans l'historique du test (voir
[Historique et versions](./organizing#history-and-versions)).
