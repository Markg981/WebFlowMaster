# Exécuter les tests

Les tests s'exécutent dans des **plans de test**. Un plan dit quels tests, dans quels navigateurs,
combien à la fois, ce qu'il faut conserver de chaque exécution, et qui prévenir.

## Données figées à la mise en file d'attente

Pour les exécutions de plan nouvellement mises en file d'attente, l'instantané d'exécution
enregistre les datasets intégrés des tests web/BDD sélectionnés ou les lignes développées des jeux
partagés, ainsi que les valeurs de première ligne `{{data.<set>.<column>}}` de l'organisation
utilisées par les tests web, API et mobiles. Modifier, renommer ou supprimer un jeu partagé pendant
qu'une exécution attend ne change pas ces entrées. Les datasets nuls ou vides sont figés eux aussi :
ajouter des lignes plus tard ne transforme pas cette exécution en attente en exécution à plusieurs
lignes.

Le dataset d'une version web/BDD publiée l'emporte sur celui de sa copie de travail. Un jeu
référencé indisponible au moment de la mise en file d'attente est consigné comme erreur de ce
test ; réparer la référence ensuite demande une nouvelle exécution. Les requêtes avec la même clé
d'idempotence et les relances automatiques réutilisent l'instantané d'origine. Une nouvelle
exécution capture les données actuelles.

Les exécutions anciennes sans instantané de dataset continuent de résoudre les données au démarrage
du worker. Cette fonctionnalité fige les entrées de données, pas chaque définition de test ni chaque
système externe : les secrets d'environnement, les variables capturées dans les réponses, les
valeurs générées, les appareils et l'état de l'application peuvent encore changer. Les
identifiants d'environnement ne sont pas copiés. Les valeurs des datasets sont conservées comme des
données d'exécution ordinaires dans `configuration_snapshot.datasets` ; utilisez les secrets
d'environnement pour les identifiants, et appliquez votre politique de conservation et d'accès aux
exécutions aux données de test sensibles. Chaque worker doit exécuter la version à jour avant de
compter sur ce comportement pendant un déploiement progressif.

## Créer un plan

![La page des plans de test](/screenshots/test-plans.webp)

**Plans de test → + Plan de test** ouvre un assistant en trois étapes :

1. **Nom** et description.
2. **Machines et suites**. Chaque configuration de machine ajoute un navigateur — Chrome, Edge,
   Firefox ou WebKit (le moteur de Safari), affiché ou headless, sur ordinateur ou en téléphone ou
   tablette ([appareils](#mobile-devices)) ; Chrome et Edge doivent être installés sur le runner.
   **Ajouter des suites** choisit les tests du plan (recherche par nom ou par étiquette). Les champs
   système d'exploitation et version du navigateur sont enregistrés mais pas appliqués : les tests
   s'exécutent sur le système du runner, avec les navigateurs qui y sont installés, et le rapport le
   précise. Les [tests d'applications mobiles](./mobile-apps#dans-un-plan-de-test) peuvent aussi être
   choisis : ils s'exécutent une fois par exécution, sur l'appareil et la grille qu'ils désignent,
   quels que soient les navigateurs.
3. **Paramètres** : captures d'écran (sur les étapes en échec par défaut, toujours ou jamais), une
   **vidéo** de chaque exécution (jamais, quand le test échoue, ou toujours), combien de tests
   peuvent **s'exécuter en même temps**, les délais, que faire quand une étape ou un prérequis
   échoue, combien de fois relancer un test en échec, et les notifications. Les mêmes choix peuvent
   être modifiés plus tard dans [Paramètres du plan](#parametres-du-plan).

## Paramètres du plan

**Paramètres** sur la ligne d'un plan change le comportement de sa prochaine exécution :

| Paramètre                                                | Ce qu'il fait                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Navigateurs**                                          | Chaque test s'exécute une fois par navigateur listé, chacun sur ordinateur ou en téléphone ou tablette ([appareils](#mobile-devices)). Aucun listé : le navigateur de vos propres paramètres.                                                                                                                                                                                                                                                                               |
| **Langues**                                              | Des codes de langue comme `it-IT, en-US` (10 au plus). Chaque test s'exécute une fois par langue dans chaque navigateur ; voir [Tester en plusieurs langues](#languages). Vide : la langue propre au navigateur.                                                                                                                                                                                                                                                            |
| **Exécuter au plus (tests simultanés)**                  | De 1 à 16 sessions de navigateur en même temps. 1 exécute le plan un test à la fois, navigateur par navigateur.                                                                                                                                                                                                                                                                                                                                                             |
| **Workers partageant une exécution**                     | De 1 à 8 runners pour une exécution, chacun exécutant le nombre ci-dessus en même temps ; voir [Une exécution sur plusieurs runners](#shards). 1 garde l'exécution sur un seul runner.                                                                                                                                                                                                                                                                                      |
| **Conserver un enregistrement de l'exécution**           | Une **vidéo** et une **trace** Playwright de chaque test — jamais, quand le test échoue, ou toujours — et le trafic **réseau** dans un fichier HAR. Elles répondent à ce qu'une capture d'écran ne peut pas dire, et occupent du disque à chaque exécution.                                                                                                                                                                                                                 |
| **Tests visuels**                                        | Compare la capture d'écran de chaque étape à sa référence ; voir [Tests visuels](./results#visual-testing).                                                                                                                                                                                                                                                                                                                                                                 |
| **Exécuter sur**                                         | Les runners de ce serveur, un pool d'[agents locaux](/en/integrations/local-agents) (en anglais) dans votre propre réseau, ou une [grille de navigateurs](#browser-grids).                                                                                                                                                                                                                                                                                                  |
| **Signaler les échecs dans**                             | Un gestionnaire de tickets (Jira, Azure DevOps) connecté par un propriétaire. Avec **Ouvrir un ticket quand un test échoue**, chaque test et navigateur en échec reçoit un ticket ; le même échec plus tard y est ajouté en commentaire.                                                                                                                                                                                                                                    |
| **Publier les résultats dans**                           | TestRail, Xray ou Zephyr Scale, connecté dans **Paramètres → Gestion des tests** : chaque exécution terminée y est publiée cas par cas ; voir [Publier vers TestRail, Xray ou Zephyr](./results#test-management).                                                                                                                                                                                                                                                           |
| **Envoyer une notification lorsque** et l'URL du webhook | Un message vers un webhook entrant Slack ou Microsoft Teams, ou toute URL qui accepte un POST, quand une exécution réussit, échoue, n'est pas exécutée ou est arrêtée. Les adresses Slack et Teams reçoivent leur propre format de carte : le verdict en couleur, les nombres, et un bouton **Ouvrir le rapport** quand l'installation connaît son adresse publique. Les adresses e-mail qui y figurent reçoivent aussi un e-mail, quand l'installation envoie des e-mails. |

**Suites** sur la ligne ajoute des [suites](./organizing#suites) : elles s'exécutent après les
tests propres au plan, dans l'ordre coché, et un test présent dans plusieurs suites ne s'exécute
qu'une fois.

### Une exécution sur plusieurs runners {#shards}

Un long plan se termine plus tôt quand plusieurs runners se le partagent. Avec **Workers partageant
une exécution** au-dessus de 1, le runner qui prend l'exécution note son travail — une part par test
pour chaque navigateur et chaque langue — et demande de l'aide à la file d'attente. Chaque runner
qui se joint, le premier compris, prend la part suivante que personne ne détient, l'exécute, puis
en prend une autre : un test lent ne bloque jamais un lot fixe.

- Le rapport est une seule exécution, comme toujours : un ensemble de résultats, un verdict, une
  notification.
- Un plan dont les tests API capturent des valeurs pour des requêtes ultérieures les garde
  ensemble : chaque navigateur et chaque langue forment une part, exécutée dans l'ordre sur un seul
  runner.
- Un runner qui s'arrête alors qu'il détient une part (un plantage, une machine perdue) cesse de
  répondre ; au bout de deux minutes, un autre runner reprend cette part et l'exécute.
- Une politique d'arrêt (par exemple _arrêter l'exécution_ sur un échec) arrête tous les runners :
  les tests pas encore démarrés sont consignés comme ignorés, avec la raison.
- Les aides sont des jobs ordinaires de la file d'attente : ils prennent des runners libres, et
  n'aident que s'il y en a. Sans runner libre, le premier exécute lui-même tous les tests, et le
  journal le dit.

### Grilles de navigateurs {#browser-grids}

Les runners disposent de Chromium, Firefox et WebKit sur le système où ils sont installés. Pour
Windows et macOS, Chrome et Edge de marque, ou une version plus ancienne, un plan peut emprunter ses
navigateurs à une **grille de navigateurs**, ajoutée dans **Paramètres → Grilles de navigateurs** :

| Fournisseur                                                                           | Il faut                                                                                                                                                      | OS et versions                                                                                              |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **BrowserStack**                                                                      | Nom d'utilisateur et clé d'accès                                                                                                                             | Respectés                                                                                                   |
| **LambdaTest**                                                                        | Nom d'utilisateur et clé d'accès                                                                                                                             | Respectés                                                                                                   |
| **Serveur Playwright** — votre propre `npx playwright run-server`, Browserless, Moon… | Son adresse `ws://` ou `wss://`, et un jeton s'il en demande un (là où l'adresse contient `{token}` il y est inséré, sinon il est envoyé comme bearer token) | Non respectés : il exécute les navigateurs dont il dispose                                                  |
| **Appium local (agent)**                                                              | Un pool d'agents locaux et l'adresse d'Appium                                                                                                                | N'exécute que les [tests d'applications mobiles](./mobile-apps#local-appium), pas les navigateurs d'un plan |

La clé est stockée chiffrée et n'est plus jamais affichée. **Tester la connexion** ouvre une courte
session Chromium sur la grille et dit si elle a fonctionné. Un serveur Playwright doit exécuter la
même version de Playwright que les runners.

Avec **Exécuter sur** réglé sur une grille, chaque ligne de navigateur du plan prend aussi un
**Système d’exploitation** (Windows ou macOS), sa **version** (`11`, `Sonoma`) et une **Version du
navigateur** (`latest` si vide). Chaque ligne est un passage de l'exécution, et le rapport
l'étiquette avec sa machine — _chrome · Windows 11_, _chrome · macOS Sonoma_. Sans OS, WebKit
s'exécute sur macOS et tout le reste sur Windows 11. Safari sur une grille reste le WebKit de
Playwright.

Chaque test est une session sur le tableau de bord du fournisseur, nommée d'après le test, regroupée
sous l'exécution et marquée réussie ou en échec. Supprimer une grille renvoie les plans qui
l'utilisaient vers les runners du serveur. Un plan s'exécute sur une grille ou sur des agents
locaux, jamais les deux.

### Téléphones et tablettes {#mobile-devices}

**Appareil** sur une ligne de navigateur des paramètres du plan fait de ce navigateur un téléphone ou
une tablette : iPhone 15, iPhone 15 Pro Max, iPhone 14, iPhone SE, iPhone 13 Mini, Pixel 7,
Pixel 5, Galaxy S24, Galaxy A55, iPad Pro 11, iPad Mini, Galaxy Tab S9 (les tablettes aussi en
paysage). La page voit alors cet appareil : sa taille d'écran et sa densité de pixels, le tactile au
lieu d'une souris (`pointer: coarse`), la mise en page mobile (`<meta name="viewport">` est
respecté) et son user agent, de sorte qu'un site responsive affiche les menus, tailles et pages
qu'il affiche sur ce téléphone. Chaque ligne est un passage à part : Chromium sur ordinateur et
Chromium en Pixel 7 donnent deux résultats par test, et le rapport dit lequel est lequel
(`chromium · Pixel 7`).

Choisissez le moteur sur lequel est construit le navigateur propre à l'appareil — **WebKit** pour un
iPhone ou un iPad, **Chromium** ou **Chrome** pour Android — pour le résultat le plus proche.
**Firefox** ne peut pas émuler d'appareil ; le choix ne lui est pas proposé. Les appareils se
choisissent dans l'assistant du plan ou dans les paramètres du plan, et fonctionnent sur les
runners du serveur, sur des [agents locaux](/en/integrations/local-agents) (en anglais) et sur une
[grille de navigateurs](#browser-grids), dont le navigateur de bureau affiche alors l'appareil.

C'est de l'émulation, pas un vrai téléphone : ce qui dépend de l'appareil lui-même — le
comportement propre de Safari sur iOS, le clavier à l'écran, la vitesse du téléphone, les
applications natives — demande de vrais appareils, qui viennent avec les tests d'applications
mobiles.

### Tester en plusieurs langues {#languages}

Quand des **Langues** sont définies, chaque langue est une exécution du plan à part entière dans
chaque navigateur : deux navigateurs et trois langues font six passages. Dans chacun, le navigateur
démarre dans cette langue — l'en-tête `Accept-Language` que reçoit l'application,
`navigator.language`, et les formats de nombres et de dates de la page — et
<code v-pre>{{locale}}</code> contient le code, pour les tests d'interface comme pour les tests
API.

Une vérification dont le texte change avec la langue se met dans un **Si** sur
<code v-pre>{{locale}}</code> (voir [conditions et boucles](./web-tests#conditions-and-loops)) :

| Étape              | Valeur                                 |
| ------------------ | -------------------------------------- |
| Si (aucun élément) | <code v-pre>{{locale}} == it-IT</code> |
| Vérifier le texte  | `Accedi`                               |
| Sinon              |                                        |
| Vérifier le texte  | `Sign in`                              |
| Fin si             |                                        |

Le rapport étiquette chaque résultat avec son navigateur et sa langue (`chromium · it-IT`) et, avec
les tests visuels, chaque langue est comparée à ses propres références.

## Exécuter maintenant

**Exécuter** sur la ligne du plan lance une exécution et ouvre sa page : la progression, le statut
de chaque test, et le journal au fil de l'exécution. **Voir le rapport détaillé** ouvre le rapport.

![Un plan en cours : chaque test et navigateur au fil de la progression](/screenshots/run-in-progress.webp)

Une exécution attend dans une file quand votre organisation exécute déjà autant de plans que sa
limite le permet, ou quand aucun runner n'est en ligne : **Paramètres → Utilisation des
exécutions** dit lequel des deux.

Pour arrêter une exécution, **Annuler l’exécution** sur son rapport. Les tests qui n'ont pas démarré
sont rapportés comme ignorés ; un test en cours s'arrête à son étape suivante.

### Relancer les échecs

Avec **Réexécution en cas d’échec**, un test en échec est relancé, jusqu'à trois fois. Un test qui
ne réussit qu'à une tentative ultérieure est marqué **instable** dans le rapport, et compte tout de
même comme réussi.

## Planification

![La page de planification avec un plan nocturne](/screenshots/scheduling.webp)

**Planification → Créer une planification** exécute un plan de lui-même :

- **Fréquence** : une fois, toutes les 5, 15 ou 30 minutes, toutes les 1, 6 ou 12 heures, chaque
  jour, chaque semaine, chaque mois, ou une expression **CRON personnalisé** (minute, heure, jour du
  mois, mois, jour de la semaine).
- **Fuseau horaire** : la planification s'exécute à cette heure locale toute l'année, heure d'été
  comprise.
- **Environnement** dont l'exécution utilise les secrets, et les **navigateurs** dans lesquels
  s'exécuter (headless : personne ne regarde).
- **Réessayer en cas d'échec** : réexécuter tout le plan s'il échoue, une ou deux fois.
- **Planification active** : la désactiver sans la supprimer.

Le tableau de bord liste les prochaines exécutions planifiées.

## Depuis un pipeline

Un plan peut être lancé par votre système de CI et son résultat peut faire échouer le build : avec
une clé API et la ligne de commande `wfm`, ou avec le webhook du plan. Voir
[CI integration](/en/integrations/ci) (en anglais).

### N'exécuter que ce qu'un changement touche {#impact}

Un pipeline qui exécute tout le plan à chaque commit attend des tests que le commit ne peut pas
avoir cassés. **Paramètres → Carte d'impact** dit quels fichiers touchent quels tests : chaque règle
associe un motif de fichiers à l'une de vos [étiquettes](./organizing#la-bibliotheque-de-tests) —
`src/checkout/**` → `checkout`. Une règle avec **aucun test** marque des fichiers qui ne touchent
rien, comme `docs/**` ou `*.md`.

Lancez l'exécution avec les fichiers modifiés par le commit —
`wfm run <plan> --changed-since origin/main`, ou l'entrée `changed-since` de la GitHub Action — et
elle exécute :

- les tests portant une étiquette vers laquelle pointe un fichier modifié ;
- les tests que la carte ne couvre pas (aucune de leurs étiquettes n'apparaît dans une règle),
  puisque rien ne dit que le changement ne peut pas les casser ;
- les tests en échec ou en erreur lors de la dernière exécution terminée du plan, pour que
  l'exécution censée montrer une correction la montre.

Elle penche du côté d'en exécuter plus : un fichier modifié qu'**aucune règle ne couvre** exécute
tout le plan, et sans aucune règle tous les tests s'exécutent. Le journal de l'exécution, le champ
`selection` de l'API et la CLI disent ce qui a été décidé — par exemple _3 changed file(s) affect
the tags checkout: 7 of 40 tests run_ — de sorte qu'un test non exécuté est un choix, pas un oubli.
**L'essayer sur une modification**, dans la même section des paramètres, montre quels tests une
liste de fichiers exécuterait, sans les exécuter.

Les motifs sont de style git : `**` n'importe quel chemin, `*` et `?` à l'intérieur d'un dossier,
`{ts,tsx}` l'un ou l'autre ; un motif sans `/` désigne un fichier n'importe où (`*.md`), et un motif
terminé par `/` un dossier entier.
