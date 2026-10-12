# Applications mobiles

**Applications mobiles** teste une application native Android ou iOS sur un **vrai appareil**
d'une grille cloud — BrowserStack App Automate ou LambdaTest Real Devices — via Appium. C'est un
type de test à part entière, à côté des tests web et API : un écran natif n'a pas de page web, ses
étapes désignent donc les éléments de la façon dont l'application les connaît.

Pour un **site web** responsive sur un téléphone, vous n'en avez pas besoin : émulez plutôt
l'appareil dans les navigateurs du plan ([téléphones et tablettes](./running#mobile-devices)).

## Avant de commencer

- Une grille **BrowserStack** ou **LambdaTest** dans **Paramètres → Grilles de navigateurs**, avec
  le nom d'utilisateur et la clé d'accès du compte. La même grille sert les navigateurs et les
  appareils ; un serveur Playwright à vous n'exécute que des navigateurs.
- Ou vos propres appareils : un [Appium local](#local-appium) à côté d'un agent local — émulateurs,
  simulateurs, téléphones en USB.
- L'application : un **.apk** ou un **.aab** pour Android, un **.ipa** compilé pour de vrais
  appareils pour iOS.

### Sur vos propres appareils (Appium local) {#local-appium}

Les émulateurs, les simulateurs et les téléphones sur votre bureau passent par un serveur
**Appium** sur une machine équipée d'un [agent local](/en/integrations/local-agents) (en anglais).
L'agent transporte les requêtes : le serveur n'a besoin d'aucune entrée dans ce réseau, et rien de
nouveau n'est installé en dehors d'Appium lui-même.

1. Sur la machine de l'agent : installez Appium et ses drivers (`npm i -g appium`,
   `appium driver install uiautomator2`, `xcuitest` sur un Mac), démarrez l'émulateur ou branchez
   le téléphone, et lancez `appium`.
2. **Paramètres → Grilles de navigateurs → Ajouter une grille**, fournisseur **Appium local
   (agent)** : le **Pool** de cet agent et, quand Appium n'écoute pas sur `http://127.0.0.1:4723`,
   son **Adresse** telle que la machine de l'agent l'atteint. Pas de clé. **Tester la connexion**
   demande à Appium son `/status` via un agent du pool et répond avec sa version.
3. Dans un test mobile : **Appareil** est le nom d'appareil d'Appium (`emulator-5554`, l'UDID du
   téléphone, ou `iPhone 15` pour un simulateur) et **Application** est le chemin du fichier sur la
   machine de l'agent (`/home/qa/shop.apk`, `C:\apps\shop.apk`) ou une adresse `http(s)://` depuis
   laquelle Appium le télécharge. Il n'y a rien à téléverser.

Les exécutions, les plans, l'inspecteur et tout le reste fonctionnent comme sur les clouds. Il n'y
a ni tableau de bord ni vidéo : le rapport contient les étapes et la dernière capture d'écran. Un
Appium local n'exécute que des tests d'applications mobiles ; les navigateurs d'un plan ne peuvent
pas s'y exécuter.

## Écrire un test

**Applications mobiles** dans le menu → **Nouveau test mobile** :

| Champ                                    | Ce que c'est                                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nom**                                  | Unique dans l'organisation.                                                                                                                                                                                                                                                                       |
| **Plateforme**                           | Android ou iOS.                                                                                                                                                                                                                                                                                   |
| **Application**                          | Là où la grille la trouve : **Envoyer .apk / .ipa** envoie le fichier à la grille choisie à côté et remplit son adresse (`bs://…` ou `lt://…`) ; ou collez celle d'un envoi précédent, ou une adresse https:// depuis laquelle la grille la télécharge. WebFlowMaster ne conserve pas le fichier. |
| **Appareil**                             | Tel que la grille le nomme : `Google Pixel 8`, `Samsung Galaxy S24`, `iPhone 15` — voir la liste d'appareils de la grille.                                                                                                                                                                        |
| **Version de l'OS**                      | Facultatif : `14.0`, `17`. Vide : le choix de la grille pour cet appareil.                                                                                                                                                                                                                        |
| **Projet**                               | Comme pour un test web : dans un [projet restreint](./organizing), seuls ses membres voient le test et ses exécutions, et un lecteur ne peut ni le modifier ni l'exécuter.                                                                                                                        |
| **S'exécute dans les plans de test sur** | La grille sur laquelle un [plan de test](#dans-un-plan-de-test) l'exécute. Un nouveau test démarre avec la première grille BrowserStack ou LambdaTest ; **Aucune grille** le tient à l'écart des exécutions de plans (un plan qui l'inclut signale une erreur pour lui).                          |

Chaque étape est une action, et pour la plupart un élément :

| Action                                        | Ce qu'elle fait                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| **Toucher**                                   | Touche l'élément.                                                            |
| **Saisir**                                    | Vide le champ et saisit la valeur.                                           |
| **Effacer**                                   | Vide le champ.                                                               |
| **Attendre l'élément** / **Vérifier visible** | Attend que l'élément soit à l'écran (jusqu'à 15 secondes).                   |
| **Vérifier non visible**                      | Échoue si l'élément est encore à l'écran après jusqu'à 5 secondes.           |
| **Vérifier que le texte contient**            | Le texte de l'élément contient la valeur.                                    |
| **Balayer**                                   | `up`, `down`, `left` ou `right` : le sens du doigt sur le milieu de l'écran. |
| **Retour**                                    | Le retour du système (Android), ou la navigation arrière de l'application.   |
| **Masquer le clavier**                        | Ferme le clavier à l'écran quand il cache ce qui suit.                       |
| **Attendre (secondes)**                       | Jusqu'à 60 secondes. Mieux vaut attendre l'élément.                          |

**Désigner un élément :**

| Écrivez                                               | Trouve                                                                                                                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `~login`                                              | L'**accessibility id** : `content-desc` sur Android, `accessibilityIdentifier` sur iOS. Celui à demander aux développeurs : il survit aux refontes et aux traductions. |
| `id=com.shop:id/login`                                | Le resource id (Android) ou le name (iOS).                                                                                                                             |
| `text=Sign in`                                        | Un élément qui affiche exactement ce texte.                                                                                                                            |
| `//android.widget.Button[@text='OK']`                 | XPath dans l'arbre des vues de l'application.                                                                                                                          |
| `android=new UiSelector().text("OK")`                 | UiAutomator d'Android.                                                                                                                                                 |
| `ios=label == "OK"`, `chain=**/XCUIElementTypeButton` | Predicate strings et class chains d'iOS.                                                                                                                               |

Une étape que la plateforme ne sait pas lire — un sélecteur CSS, `android=…` dans un test iOS — est
marquée en rouge et le test ne peut pas être enregistré tant qu'elle n'est pas corrigée. Les
valeurs peuvent utiliser les <code v-pre>{{variables}}</code> de l'environnement et les
[valeurs générées](./web-tests#generated-values), y compris
<code v-pre>{{$totp(secret_mfa)}}</code>.

## L'inspecteur {#inspector}

Trouver comment désigner un élément est la partie difficile d'un test mobile. **Inspecteur**, sous
les étapes de la fenêtre du test, ouvre l'application sur un vrai appareil de la grille — celui sur
lequel le test s'exécute dans les plans, sinon celui où vont les envois — et affiche son écran à
côté de la liste de ses éléments. Il faut que l'application et l'appareil soient renseignés ; la
grille met une minute ou deux à trouver l'appareil.

- **Cliquez sur l'écran** (ou sur un élément de la liste) : l'élément sous le pointeur est entouré,
  avec ses attributs et les localisateurs qu'une étape peut utiliser pour lui — accessibility id,
  resource id, texte, XPath — marqués **unique** quand ils ne trouvent que cet élément sur cet
  écran, les uniques en premier. Quand rien d'autre n'est unique, un XPath par position est
  proposé ; il fonctionne, mais casse dès que la mise en page de l'écran change.
- **+** à côté d'un localisateur ajoute une étape à la fin du test, avec l'action choisie dans
  **Ajouter comme** (Toucher par défaut ; Vérifier visible, Attendre l'élément, Vérifier non
  visible, Effacer).
- Pour atteindre l'écran suivant, pilotez l'appareil d'ici : **Le toucher sur l'appareil** et
  **Le saisir** sur l'élément sélectionné, **Toucher sur l'appareil** pour toucher là où vous
  cliquez sur l'écran, les boutons retour et balayage, et ↻ pour relire l'écran. Une étape qui
  échoue dit pourquoi, comme dans une exécution.

### Enregistrer un test {#recording}

**Enregistrer** transforme un parcours de l'application en étapes. Chaque toucher sur l'écran est
d'abord fait sur l'appareil, et ne devient une étape que s'il a fonctionné :

- **Un clic** touche l'élément sous le pointeur, désigné par son localisateur le plus robuste (le
  premier que proposerait le panneau de l'élément). Là où rien ne peut être désigné, le toucher est
  fait mais pas enregistré, et l'inspecteur le dit.
- **Un clic sur un champ de texte** demande ensuite quoi saisir ; **Le saisir** (ou Entrée)
  enregistre une étape Saisir. Dans un champ de mot de passe, le texte est masqué et l'étape est
  marquée **mot de passe**.
- **Un glisser** sur l'écran enregistre un balayage dans sa direction (haut, bas, gauche ou droite).
  Les boutons retour, balayage et masquer le clavier sont enregistrés aussi.
- **Vérifier qu'il est visible** ou **Vérifier son texte**, puis un clic sur un élément, enregistre
  une assertion — celle du texte avec le texte que l'élément affiche maintenant. Les deux sont aussi
  proposées sur l'élément sélectionné.

Les étapes enregistrées attendent dans **Étapes enregistrées**, pas dans le test. Vous pouvez y
corriger un élément ou une valeur, monter ou descendre une étape, ou la retirer ; **Ajouter N
étape(s) au test** les place à la fin du test dans cet ordre, et **Abandonner** les supprime. Fermer
l'inspecteur avec des étapes non ajoutées demande d'abord confirmation. Deux badges demandent un
coup d'œil avant d'ajouter :

- **fragile** — seule sa position dans l'écran désigne l'élément (un XPath par position) : l'étape
  casse quand la mise en page change. Donnez à l'élément un accessibility id dans l'application, ou
  écrivez un localisateur plus robuste.
- **mot de passe** — un mot de passe écrit dans le test peut être lu par toute personne qui peut
  l'ouvrir. Remplacez-le par <code v-pre>{{password}}</code> et définissez la valeur dans
  l'environnement.

Un balayage est enregistré comme une direction à travers l'écran, pas comme le tracé exact du
glisser ; un appui long, un pincement ou un toucher à des coordonnées fixes ne sont pas
enregistrés.

L'inspecteur n'a pas d'environnement : une valeur avec une <code v-pre>{{variable}}</code> est
refusée en la nommant. Saisissez la valeur elle-même, puis changez-la dans l'étape (dans la liste
enregistrée, avant d'ajouter).

L'appareil est à vous tant que l'inspecteur est ouvert, et il coûte des minutes de grille : fermer
l'inspecteur le rend, tout comme le laisser inutilisé cinq minutes. Un inspecteur par personne à la
fois : en ouvrir un autre ferme le premier. L'ouverture d'un inspecteur est consignée dans le
journal d'audit.

## L'exécuter

**Exécuter** (▶) sur la ligne d'un test : choisissez la grille et, pour ses variables,
l'environnement. La grille trouve l'appareil et installe l'application — une minute ou deux — puis
chaque étape apparaît au fil de l'exécution, avec la raison en cas d'échec ; les étapes qui suivent
une étape en échec sont ignorées. À la fin viennent la capture d'écran de l'appareil et, sur
BrowserStack, **Vidéo et journaux sur la grille**, la page de la session avec sa vidéo. Le tableau
de bord de la grille montre la session nommée d'après le test, marquée réussie ou en échec.

La liste montre la dernière exécution de chaque test. Les lecteurs voient les tests et leurs
exécutions ; les éditeurs les écrivent, les exécutent et les suppriment.

## Dans un plan de test

Un plan peut inclure des tests mobiles à côté de ses tests web et API : dans l'assistant du plan,
**Ajouter des suites** les liste avec l'étiquette **mobile**, et son filtre par étiquettes les
restreint comme les autres. La page du plan les liste avec _(application mobile)_.

Dans une exécution du plan, un test mobile :

- s'exécute **une fois**, sur l'appareil qu'il désigne et la grille choisie dans **S'exécute dans
  les plans de test sur** — pas une fois par navigateur ou par langue du plan, dont les navigateurs
  et le « exécuter sur » ne s'appliquent pas à un appareil ;
- lit les variables de l'environnement de l'exécution, comme les autres tests du plan ;
- suit la **Réexécution en cas d’échec** du plan (les tentatives apparaissent sur le résultat) et
  sa politique d'échec : un test mobile en échec fait échouer l'exécution, et peut l'arrêter ;
- est une ligne du [rapport](./results#le-rapport-d-une-execution) comme une autre : l'appareil
  (`Google Pixel 8 · 14.0`) dans la colonne _Navigateur_, ses étapes sous le bouton des étapes avec
  la raison de celle qui a échoué, le dernier écran de l'appareil comme capture d'écran et, sur
  BrowserStack, **Ouvrir la session sur la grille** pour la vidéo et les journaux.

Comme il fait partie du plan, il s'exécute aussi dans les [planifications](./running#planification)
et les [pipelines](./running#depuis-un-pipeline) du plan, et son résultat arrive avec le reste dans
les notifications, le JUnit et l'outil de gestion des tests.

Un test mobile sans grille est signalé comme erreur dans l'exécution, avec la raison, sans
demander d'appareil à aucune grille.

## Suites, exigences et gestion des tests

Un test mobile va partout où va un test web ou API :

- dans une **suite** ([Suites](./organizing#suites)), et donc dans chaque plan qui l'inclut : une
  suite statique par choix, une suite dynamique par les étiquettes que porte le test ;
- comme couverture d'une **exigence** ([Exigences](./organizing#requirements)) : son dernier
  résultat dans une exécution de plan compte comme n'importe quel autre, et l'export de la matrice
  indique `mobile` ;
- relié à un cas de **TestRail, Xray ou Zephyr Scale**
  ([gestion des tests](./results#test-management)) : son résultat dans une exécution est publié sur
  ce cas, avec l'appareil dans le commentaire. Un `[C123]` au début de son nom fonctionne comme
  pour un test web.

Dans chaque liste, il porte l'étiquette **Mobile**.

## Étiquettes {#tags}

La colonne **Tags** d'**Applications mobiles** pose les étiquettes de l'organisation sur un test
mobile, comme la bibliothèque de tests le fait pour les tests web (les lecteurs les voient). Une
étiquette est partagée par tous les types de tests : une suite dynamique avec _smoke_ exécute les
tests web, API et mobiles qui la portent.

## Quarantaine {#quarantine}

Un test mobile qui échoue pour des raisons extérieures à l'application (une ferme d'appareils qui
perd la session, un émulateur lent) peut être mis de côté avec le bouton bouclier de sa ligne, avec
la raison, comme un test web ou API
([tests instables et quarantaine](./results#tests-instables-et-quarantaine)). Il continue de
s'exécuter dans les plans et ses résultats sont conservés, mais ses échecs ne font plus échouer
l'exécution. La ligne affiche **En quarantaine** (survolez pour voir la raison) ; il est libéré
depuis **Tests en quarantaine** dans **Rapports**, où il porte l'étiquette **Mobile**. Dans un
projet restreint, seuls ceux qui peuvent modifier le test peuvent le mettre en quarantaine ou le
libérer.

## Tests instables {#unstable}

Les tests mobiles font partie des **Tests qui se contredisent** dans **Rapports**
([tests instables et quarantaine](./results#tests-instables-et-quarantaine)), avec l'étiquette
**Mobile**. Chaque appareil compte à part : un test qui échoue sur un téléphone et réussit sur un
autre est un fait sur l'application, pas une indécision. De là, il peut être mis en quarantaine
comme tout autre test.

Sur **Applications mobiles**, un test jugé instable sur les 30 derniers jours porte le badge
**Instable** ; survolez-le pour voir sur quel appareil et à quelle fréquence son verdict a changé.
Les tests mobiles n'ont pas de versions : chaque changement de verdict compte, comme pour les tests
API.

## Versions et publication

Les tests enregistrés ont un [historique, une comparaison et une restauration](./organizing#history-and-versions).
La [publication et les relectures](./organizing#publishing-and-reviews) choisissent la révision
qu'exécutent les plans ; enregistrer ou restaurer une copie de travail laisse en place une
publication existante. Une exécution de débogage utilise la copie de travail mobile enregistrée,
capturée au moment où l'exécution est demandée.

## Conditions, boucles et groupes réutilisables

L'éditeur d'étapes natives prend en charge `if` / `else` / `endIf`, `repeat` / `repeatWhile` /
`endLoop`, et `assertCondition`. Chaque bloc doit être fermé pour que le test puisse être
enregistré. Avec un élément, une condition lit `visible`, `hidden`, `contains:text` ou `text:text`
immédiatement. Mettez `waitFor` en premier quand l'écran est encore en cours de chargement. Sans
élément, utilisez une comparaison de valeurs comme `{{status}} == Paid`, `{{total}} > 0`,
`contains` ou `not contains`.

`repeat` accepte de 1 à 200 itérations, y compris un nombre venant d'une variable d'environnement.
`{{loopIndex}}` commence à 1 ; les boucles imbriquées restaurent l'index extérieur quand elles se
terminent. Un `repeatWhile` sans fin échoue après 200 itérations. Le runner limite aussi les étapes
développées à 2 000 et le total des passages d'étapes exécutés à 10 000 par appareil. Les rapports
indiquent le groupe et l'itération quand une étape se répète.

**Groupes mobiles réutilisables**, sur la page Applications mobiles, contient des séquences natives
nommées pour une plateforme. Créez un groupe, puis choisissez **Appeler un groupe mobile** dans un
test. Les groupes peuvent contenir des blocs de flux complets, mais ne peuvent pas appeler d'autres
groupes. Le projet détermine qui peut voir et modifier un groupe. Un groupe référencé ne peut être
ni supprimé ni passé à une autre plateforme. Des dépendances manquantes ou inaccessibles provoquent
une erreur explicite. Les modifications s'appliquent aux exécutions suivantes ; les exécutions déjà
en file d'attente et les relances gardent le contenu de groupe résolu capturé dans leur instantané.

## Matrice appareil/OS

Ajoutez jusqu'à 20 couples distincts sous **Matrice d’appareils** dans l'éditeur de test. Une
matrice vide utilise l'appareil et l'OS par défaut existants. Une matrice non vide est la liste
complète des cibles ; l'appareil par défaut n'y est pas ajouté. L'application, la plateforme et la
grille sont partagées. Utilisez des tests Android et iOS distincts pour des binaires
d'application ou des localisateurs natifs différents.

**Exécuter** utilise l'appareil par défaut ; **Exécuter la matrice d’appareils** met en file
d'attente toutes les cibles configurées et suit chaque résultat séparément. Les cibles autonomes
s'exécutent l'une après l'autre ; une cible en échec n'empêche pas les suivantes de s'exécuter. Un
budget d'exécution épuisé refuse l'admission avant qu'aucune cible ne soit mise en file. Un budget
épuisé pendant l'exécution est signalé comme erreur d'exécution.

Les plans de test utilisent automatiquement la matrice. Chaque cible a son propre résultat, ses
relances, sa capture d'écran et son lien de session, indépendamment des combinaisons navigateur
web/langue. Le parallélisme, la quarantaine et les politiques d'arrêt existants du plan
s'appliquent toujours.

## Fichiers de catalogue mobile

**Tests en fichiers** exporte les tests web, API et natifs dans un lot YAML/JSON en version 2. Les
exports mobiles contiennent la matrice d'appareils et les groupes natifs référencés. Les appels de
groupe utilisent des clés plateforme/nom et sont remappés vers les identifiants de destination à
l'import. L'aperçu valide les dépendances sans créer de tests, de groupes, de versions ni d'entrées
d'audit. Les définitions natives modifiées créent une nouvelle version du test ; les imports
inchangés n'en créent pas. Les lots en version 1 restent lisibles. Gherkin n'exporte que les tests
web.

Les nouveaux imports vont dans le projet modifiable sélectionné ; les tests et groupes existants
gardent leurs projets, et les tests existants gardent leur grille. Configurez une grille pour les
nouveaux tests natifs après l'import. Les références d'application sont conservées telles
qu'écrites : les identifiants d'envoi cloud et les chemins locaux peuvent demander de téléverser
ou de configurer l'application à destination. Le catalogue contient des définitions, pas de
binaires d'application ni d'artefacts d'exécution.
