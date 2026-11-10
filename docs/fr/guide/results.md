# Résultats

## Entrées historiques et réexécution

Les rapports montrent les versions de tests capturées, la source publiée ou de travail, le
SHA-256 de chaque définition et les empreintes des datasets et de la configuration conservée. Les
exports HTML/PDF, Allure et JUnit incluent cette provenance sans les valeurs des instantanés ni les
identifiants.

Les éditeurs et les propriétaires peuvent choisir **Réexécuter la configuration historique** et
confirmer une nouvelle exécution manuelle. Elle utilise les tests, valeurs de datasets, choix de
navigateurs et paramètres conservés, même après des changements du catalogue ou du plan. Le
nouveau rapport renvoie à sa source et conserve des empreintes d'entrée identiques. Des tests
supprimés peuvent produire des résultats à partir des définitions enregistrées ; le plan d'origine
doit toutefois encore exister. Les rapports sans entrées mises en file d'attente vérifiées ne
proposent pas de réexécution historique.

Les accès, relectures et quotas actuels s'appliquent. Les secrets d'environnement, sessions
enregistrées, appareils, binaires de navigateurs, profils BDD, intégrations et l'application testée
utilisent leur état actuel. Des changements extérieurs peuvent modifier le résultat. La
réexécution ne met pas à jour le statut du build de CI d'origine.

## Tableau de bord

Le **Tableau de bord** montre comment se sont passées les dernières exécutions, les nombres de
réussites et d'échecs des 30 derniers jours (les exécutions qui ont atteint leur limite de temps sont comptées à part, comme **Délai dépassé**, dans le graphique des statuts et sa légende), les rapports les plus récents et les prochaines
exécutions planifiées.

## Rapports

**Rapports** liste toutes les exécutions terminées : leur plan, leur statut, leur heure de début,
leur durée, le nombre de tests réussis, en échec et ignorés, et qui ou quoi les a lancées (une
personne, une planification, un pipeline). Filtrez par plan et par statut, et ouvrez une exécution
avec **Voir le rapport**.

![Rapports : toutes les exécutions terminées](/screenshots/reports.webp)

## Le rapport d'une exécution

![Le rapport d'une exécution : totaux, durée et résultats par module](/screenshots/run-report.webp)

Le rapport liste chaque test dans chaque navigateur avec son résultat, et ses étapes avec leurs
durées. Autour :

- **Build** : pour une exécution lancée depuis la CI, le dépôt, la branche, le commit et le build
  testés.
- **Exécuté sur** : le runner ou les agents locaux qui l'ont exécutée.
- **Tentatives** : un test relancé après un échec montre ses tentatives ; un test qui n'a réussi
  qu'à une tentative ultérieure est marqué **instable**.
- **Quarantaine** : les échecs des tests en quarantaine sont affichés mais n'ont pas fait échouer
  l'exécution.
- La façon dont une exécution s'est terminée quand elle n'est pas allée au bout : **Annulée**,
  **Délai dépassé** ou **Non terminée** (le runner s'est arrêté).

![Les tests en échec dans le rapport, avec navigateur, raison et preuves](/screenshots/run-report-failure.webp)

Les **graphiques** montrent la répartition de l'exécution — réussis, en échec et ignorés, avec le
taux de réussite — et la même répartition par priorité et par sévérité ; survolez une barre pour
voir son nombre. Les **Filtres** restreignent les tests en échec et les résultats par module à un
composant, une sévérité ou un résultat ; les nombres sont alors ceux des tests affichés, et
**Effacer les filtres** ramène l'exécution entière.

### Résultats manuels {#manual-results}

Les [tests manuels](./organizing#manual-tests) d'une exécution apparaissent dans la carte **Tests
manuels**, une ligne par test, **En attente** jusqu'à ce que quelqu'un consigne son résultat ; une
exécution dont des tests sont en attente se termine tout de même comme terminée. Une exécution dont tous les tests ont été ignorés (par exemple par la politique « publié seulement ») se termine en **erreur** avec la raison « No test produced a verdict (all skipped) », affichée dans l'en-tête du rapport : auparavant, elle se terminait comme terminée et verte. C'est un changement de comportement. Une fois
l'exécution terminée, un éditeur ouvre la ligne, marque chaque étape **OK**, **KO** ou **Non fait**
avec une note, et consigne le verdict :

- **Réussi** compte avec les tests réussis.
- **Échec** compte avec les tests en échec et fait échouer l'exécution ; la raison affichée est la
  note ou, à défaut, la note de la première étape KO.
- **Bloqué** (il n'a pas pu être réalisé) compte avec les tests ignorés.

Chaque verdict recalcule les totaux et le statut de l'exécution : le rapport mêle ainsi résultats
manuels et automatisés. Une exécution terminée ou en échec passe de l'une à l'autre comme toute fin d'exécution, de sorte que le statut du commit, les notifications et la publication vers la gestion des tests sont rejoués avec le nouveau résultat. Une exécution annulée ou arrivée à expiration garde sa fin et n'annonce rien. Un verdict peut
être corrigé en le consignant à nouveau ; la ligne indique qui l'a consigné et quand, et chaque
saisie entre dans le journal d'audit.

### Publier vers TestRail, Xray ou Zephyr {#test-management}

Un plan dont les paramètres désignent une connexion sous **Publier les résultats dans** envoie
chaque exécution terminée à cet outil, le résultat de chaque test sous son cas :

| Outil                                       | Ce que devient une exécution                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **TestRail**                                | Un test run dans le projet (et la suite), avec uniquement les cas de l'exécution, et un résultat pour chacun. |
| **Xray Cloud**, **Xray Server/Data Center** | Un ticket Test Execution, ajouté au Test Plan Xray si la connexion en désigne un.                             |
| **Zephyr Scale** (Cloud)                    | Un test cycle, avec une test execution pour chaque cas.                                                       |

**Quel cas correspond à un test.** Dans **Paramètres → Gestion des tests**, **Cas de test** sur une
connexion liste tous les tests — web, API et applications mobiles — avec une case pour sa clé :
`C123` dans TestRail (ou simplement `123`), `SHOP-45` dans Xray, `SHOP-T12` dans Zephyr. Un test
dont le nom commence par une clé entre crochets — `[C123] Login` — n'a besoin de rien : la clé est
affichée en gris dans la case et utilisée telle quelle. Une clé saisie dans la case l'emporte sur
le nom. Les tests sans l'une ni l'autre sont laissés de côté, et la publication dit combien ; un cas
inconnu de l'outil ferait échouer tout l'import.

**Ce qui est envoyé pour un cas.** Réussi, en échec ou ignoré, et **Non exécuté** pour un test qui
attend encore un verdict manuel (TODO dans Xray, Not Executed dans Zephyr ; TestRail ne reçoit
aucun résultat pour lui). Un test exécuté dans plusieurs navigateurs, ou deux tests sur le même
cas, donnent un seul résultat, en échec si l'un a échoué, avec le résultat de chaque navigateur, la
raison d'un échec (jusqu'à 1000 caractères) et l'adresse du rapport dans son commentaire. Le titre
de l'exécution est le nom du plan et sa date de fin, en UTC.

La carte **Gestion des tests** du rapport indique où l'exécution a été envoyée, avec un lien vers
le run TestRail ou le ticket Xray, combien de cas ont été publiés et combien de tests n'avaient pas
de cas, et pourquoi une publication a échoué (un mauvais jeton, un cas refusé par l'outil). Une exécution dont l'outil n'a pris qu'une partie des cas est **Publié en partie**, et celle dont il n'a pris aucun est **Échec**, jamais Publiée ; un run TestRail créé avant l'échec de ses résultats reste lié. Les requêtes qui subissent une erreur réseau, un 429 ou un 502-504 sont retentées jusqu'à trois fois.
**Publier à nouveau** renvoie l'exécution — une fois les verdicts manuels saisis, ou quand l'outil
était indisponible — vers la connexion du plan ou vers une autre ; chaque envoi crée un nouveau run
dans l'outil. Une publication en échec ne change jamais le résultat de l'exécution.

### Analyse des échecs par l'IA {#ai-failure-analysis}

Quand l'installation dispose d'une clé d'IA (`GEMINI_API_KEY`), chaque test en échec dans **Tests
échoués** a un bouton **Analyser avec l'IA**. Un éditeur clique dessus et l'IA lit ce que le
rapport contient déjà : la raison donnée par le runner, les étapes autour de l'échec avec leurs
erreurs, les requêtes en échec et lentes, et la capture d'écran. Elle répond, dans la langue de
l'interface, avec :

- une **catégorie** : **Localisateur** (l'élément est là mais le test le cherche de la mauvaise
  façon), **Bug de l'application**, **Délais**, **Données de test**, **Environnement** ou
  **Incertaine** ;
- son degré de certitude, et l'étape qu'elle met en cause ;
- pourquoi elle le pense, et quoi faire ensuite ;
- pour un localisateur, un **Sélecteur proposé**, à copier ou à mettre dans l'étape avec
  **Appliquer au test**.

**Appliquer au test** modifie le sélecteur de cette seule étape et enregistre le test comme une
nouvelle version, que l'historique permet d'annuler ; les plans l'utilisent une fois publiée. Le
bouton est proposé quand l'étape appartient au test lui-même — une étape à l'intérieur d'un groupe
d'étapes se modifie dans le groupe — et pour les exécutions faites à partir de cette version de
WebFlowMaster, dont les étapes enregistrent à quelle étape du test elles correspondaient.

L'analyse est conservée sur le résultat : la rouvrir, pour qui que ce soit, ne coûte rien, et
**Analyser à nouveau** en demande une nouvelle. C'est une cause probable, pas un verdict —
confrontez-la aux étapes. Les valeurs qui ressemblent à des mots de passe, des codes ou des clés ne
sont jamais envoyées (voir [AI features](/en/security/#ai-features), en anglais), et chaque analyse
entre dans le journal d'audit.

### Le détail d'une étape

Ouvrir une étape montre sa **capture d'écran**, l'erreur sur laquelle elle a échoué et — quand le
plan les conserve — la **vidéo** et la **trace Playwright** du test. Téléchargez la trace et
ouvrez-la avec `npx playwright show-trace` ou sur trace.playwright.dev : elle rejoue chaque action
avec la page telle qu'elle était, la console et le réseau.

#### Qui peut télécharger une trace {#who-can-download-a-trace}

Une trace est une **preuve brute** : elle conserve le contenu de la page et chaque requête avec son
corps, un mot de passe saisi pendant le test s'y trouve donc en clair. Seuls les **éditeurs** et les
**propriétaires** peuvent télécharger les traces et les fichiers HAR ; un lecteur voit le reste du
rapport et une note indiquant que la trace existe. Le serveur en décide à chaque téléchargement :
connaître l'adresse n'y change rien. Une clé d'API a en plus besoin du scope `runs:evidence`.

| Fichier                                                          | Lecteur | Éditeur, propriétaire |
| ---------------------------------------------------------------- | ------- | --------------------- |
| Captures d'écran, différences visuelles, vidéo                   | ✓       | ✓                     |
| Rapport Lighthouse, fichiers téléchargés par un test             | ✓       | ✓                     |
| Trace Playwright, HAR                                            | —       | ✓                     |
| Tout autre fichier de l'exécution (noms anciens ou non reconnus) | —       | ✓                     |

Les fichiers d'un test d'un **projet restreint** ne sont disponibles que pour les personnes du projet
(et pour les propriétaires). Pour tous les autres, ils n'existent pas : ils reçoivent la même réponse
que pour un fichier qui n'a jamais été écrit.

La même restriction couvre le rapport du plan, la vue d'exécution en direct et l'export JUnit (y
compris celui récupéré avec une clé d'API, qui agit comme l'utilisateur de la clé) : un test d'un
projet restreint dont vous ne faites pas partie n'affiche que son nom et son verdict, sans étapes,
journaux, capture réseau ni analyse IA, et une exécution qui inclut un tel test ne peut pas être
suivie en direct.

Un test qui manipule visiblement un identifiant — une valeur `{{secret_…}}`, ou un champ, un
sélecteur ou une valeur nommés _password_ — **n'enregistre aucune trace**, même si le plan en
demande une ; le journal de l'exécution le dit. La vidéo et les captures d'écran sont conservées
comme demandé.

::: warning Les captures d'écran, vidéos et traces ne sont pas nettoyées
Rien ne retire un secret d'une image ou d'un enregistrement. Un navigateur dessine un champ de mot de
passe sous forme de points, mais une application peut afficher un jeton, une fiche personnelle ou un
code à usage unique n'importe où dans la page, et c'est ce que contiendront la capture et la vidéo.
Pour les parcours qui manipulent de vrais identifiants ou des données personnelles : utilisez des
comptes de test dédiés, réglez **Trace** sur _Jamais_ et **Vidéo** sur _Jamais_ ou _Quand le test
échoue_ dans le plan, et gardez `ARTIFACT_RETENTION_DAYS` court.
:::

#### Étapes réparées {#healed-steps}

Une étape marquée **réussi après réparation** a réussi sur un localisateur réparé, pas sur le sien
(voir [Runtime use, approval and publishing](/en/guide/web-tests#healing-approval), en anglais). Elle
reste un succès, et les étapes suivantes se sont exécutées normalement. Les étapes qui ont réussi
sur leur propre localisateur n'ont pas de badge. Le détail de l'étape montre :

- le **localisateur écrit** et celui **utilisé dans cette exécution** ;
- ce qui l'a trouvé : un repli connu, ou l'IA ;
- la **proposition** et son état actuel : _proposée_, _approuvée_ (avec la version de la copie de
  travail qu'elle est devenue), _rejetée_ ou _périmée_ (l'étape a changé après l'exécution, la
  proposition ne peut donc plus être approuvée).

Les éditeurs et propriétaires du projet voient **Approuver** et **Rejeter**. Approuver écrit la
réparation là où l'étape est écrite, sous l'empreinte enregistrée par l'exécution. Cela ne publie
rien : la nouvelle version ne passe en production que par l'étape habituelle de publication ou de
revue. Le journal de l'exécution contient un avertissement pour chaque étape réparée. Les propositions
sont aussi disponibles via `GET /api/healing-proposals?testId=…`.

Les résultats enregistrés avant l'existence des approbations montrent ce que l'exécution a fait à
l'époque (elle écrivait la réparation elle-même).

Le contour rouge qui marque l'élément sur lequel on agit est retiré après chaque action. Les captures
d'écran, les comparaisons visuelles et la page envoyée à l'IA montrent l'application telle qu'elle
est.

#### Tentatives et lignes de dataset {#attempts-and-rows}

Chaque ligne du rapport est un test sur un navigateur, dans une langue (et sur un appareil pour un
test mobile) : une **unité** de l'exécution. Les preuves d'une unité sont conservées par
**tentative** et, pour un test avec [dataset](./web-tests#datasets), par **ligne** de chaque
tentative. Une relance n'écrase pas les preuves de la première tentative, et une ligne n'écrase pas
celles d'une autre.

Quand un résultat a plus d'une tentative, ou des lignes de dataset, son détail s'ouvre avec deux
sélecteurs :

- **Tentatives** : _Tentative 1 · échec_, _Tentative 2 · réussi · résultat_… Le détail s'ouvre sur la
  tentative sur laquelle repose le résultat. Choisissez-en une plus ancienne pour ouvrir les preuves
  de l'échec que la relance a remplacé : sa capture d'écran, sa vidéo, sa trace et son HAR, et la
  raison de l'échec.
- **Lignes du jeu de données** : _Toutes les lignes_, ou une ligne avec son propre résultat et sa
  propre erreur. Choisir une ligne montre les étapes de cette ligne et sa propre vidéo, sa propre
  trace et son propre HAR, rien des autres lignes.

Le rapport garde les étapes de la tentative sur laquelle repose le résultat. Une tentative plus
ancienne montre ses preuves et sa raison, et indique que ses étapes sont dans sa trace. Les règles
ci-dessus sur qui peut télécharger une trace s'appliquent à chaque tentative et à chaque ligne.

Un lien peut ouvrir le rapport sur une tranche : ajoutez `?unit=<unit id>&attempt=<n>&row=<m>` à
l'adresse du rapport (row à partir de 0). L'API donne la même vue : `GET /api/v1/runs/{runId}/units`
liste les unités d'une exécution, et `GET /api/v1/runs/{runId}/units/{unitId}` renvoie chaque
tentative et chaque ligne avec des liens vers ses fichiers (voir l'[API](/en/reference/api), en
anglais). Depuis un pipeline, `wfm units <runId> [<unitId>]` les affiche.

Les preuves d'une tentative ne sont écrites qu'une fois. Un envoi tardif de la même tentative (par
exemple depuis un worker qui a perdu son travail) ne remplace pas un fichier vers lequel le rapport
pointe déjà. Les exécutions antérieures à cette version gardent leurs liens tels quels. Leurs
tentatives et leurs lignes n'ont pas été conservées séparément.

### Tests visuels {#visual-testing}

Quand les **Tests visuels** sont activés dans un plan, la capture d'écran de chaque étape est
comparée à sa **référence**. La première exécution après l'activation enregistre les références.
Ensuite, une étape dont la capture diffère montre la **Référence**, **Cette exécution** et la
**Différence**.

Une comparaison peut aussi ne pas avoir lieu : la référence stockée n'est pas une image lisible, le
magasin d'artefacts est injoignable, ou la capture d'écran de l'étape ne peut pas être prise. Cette
étape est **non vérifiée**, et le test se termine en **Erreur** — jamais réussi, et jamais compté comme
une différence visuelle. L'étape affiche la cause (`baseline-corrupt`, `storage-unavailable`,
`screenshot-unavailable`, `comparison-failed`) ; la raison se lit « Visual comparison could not run
(…) ». Les exports concordent : le rapport JSON garde la cause sur l'étape, Allure montre le test et
l'étape comme _broken_ sous **Visual comparison errors**, et JUnit écrit un `<error>`. Une référence
corrompue n'est jamais remplacée d'elle-même : lancez une exécution avec `updateBaselines: true` (voir
l'[API](/en/reference/api), en anglais) pour accepter les captures de cette exécution comme nouvelles
références.

#### Approuver une nouvelle baseline {#approve-baseline}

Quand une différence visuelle est voulue — une refonte, une nouvelle bannière —, un **éditeur** ou un
**propriétaire** peut l'accepter depuis le rapport : ouvrez les étapes du test, et sur l'étape qui
présente la différence appuyez sur **Approuver comme nouvelle baseline** puis confirmez. L'image de
cette exécution remplace la baseline stockée pour ce test, cette étape, ce navigateur et cette ligne
de dataset, et l'étape indique qui l'a approuvée et quand. L'exécution suivante est comparée à la
nouvelle image. L'approbation est inscrite dans le journal d'audit (`visual_baseline.approved`). Dans
un projet restreint, elle exige l'accès en modification au projet ; les lecteurs ne voient pas le
bouton. Le verdict de l'exécution elle-même ne change pas : elle reste en échec.

### Réseau

Quand le plan conserve le réseau, le rapport résume le trafic de chaque test : combien de
requêtes, combien en échec, combien de données reçues, et les requêtes en échec et les plus lentes.
**Télécharger le HAR** pour ouvrir la capture complète dans les outils de développement de
n'importe quel navigateur. Il ne contient jamais les corps des requêtes ou des réponses ; les cookies, les en-têtes d'autorisation et les paramètres de requête dont le nom ressemble à un identifiant sont remplacés par `[redacted]`. Un identifiant sous une autre forme — dans un chemin, dans un en-tête personnalisé — n'est pas reconnu, c'est pourquoi le HAR est une preuve brute comme la trace.

### Accessibilité

Une étape **Vérifier l'accessibilité** montre quelles règles ont été enfreintes, sur quels
éléments, et la gravité de chacune ; lesquelles sont respectées ; et lesquelles demandent une
vérification humaine.

## Exporter une exécution

**Exporter** télécharge l'exécution sous forme de :

| Format                  | Pour                                                     |
| ----------------------- | -------------------------------------------------------- |
| Rapport HTML            | Un seul fichier qui s'ouvre partout, captures comprises. |
| PDF                     | Le joindre à un ticket ou le conserver pour un audit.    |
| Résultats Allure (.zip) | `allure generate` ou un serveur Allure.                  |
| JUnit XML               | Le rapport de tests d'un système de CI.                  |

Un export contient les résultats et les captures d'écran des tests en échec, et rien d'autre des
preuves de l'exécution : ni trace, ni HAR, ni vidéo, ni lien vers l'un d'eux, quelle que soit la
personne qui exporte. Une capture d'écran d'un test d'un projet restreint dont la personne qui exporte
ne fait pas partie est omise.

Les tentatives et les lignes de dataset ne comptent jamais comme des tests à part : un export a un
test par unité, comme le rapport. Le rapport HTML les liste sous **Tentatives et lignes de dataset**.
Allure les attache à leur test comme _Attempts and dataset rows_. JUnit garde un `<testcase>` par
unité et les place dans la propriété `wfm.attempts`.

Une exécution terminée en **erreur**, **expirée** ou **annulée** n'est jamais exportée avec ses seuls
tests verts. JUnit ajoute un cas de test `<error>` nommé d'après la fin (par exemple _Run cancelled_),
et Allure un résultat _broken_ du même nom, tous deux portant la raison de l'exécution. L'en-tête du
rapport montre le statut de l'exécution, qu'elle soit allée au bout ou non : le même verdict que
l'API, le code de sortie de la CLI et chaque export.

**Exigences couvertes** montre les [exigences](./organizing#requirements) avec exactement les
résultats de cette exécution, et les exporte comme matrice de traçabilité.

## Créer un ticket

Quand un propriétaire a connecté Jira ou Azure DevOps, un test en échec dans le rapport a **Créer
un ticket**, qui ouvre un ticket avec le détail de l'échec, puis **Ouvrir dans le gestionnaire**.
Un plan peut aussi les créer de lui-même (voir [Paramètres du plan](./running#parametres-du-plan)).

## Tests instables et quarantaine

**Rapports** montre aussi les **Tests qui se contredisent** : sur les derniers jours, les tests dont
le verdict a changé d'une exécution à l'autre sans rien pour l'expliquer. Un test qui a été cassé
puis corrigé n'est pas listé, pas plus qu'un test dont le verdict a changé parce qu'il a été
modifié. Chaque test est compté pour lui-même, pas par nom : deux tests différents portant le même nom restent distincts, et un test renommé garde son historique sous son nouveau nom. Les tests mobiles sont comptés par appareil
([applications mobiles](./mobile-apps#unstable)).

Un test **réussi à la relance** est lui aussi listé, même si chaque exécution s'est terminée au vert et qu'aucun verdict n'a jamais changé : trois exécutions qui ont chacune réussi à la deuxième tentative affichent **3× réussi à la relance**, et une dernière exécution verte ne retire pas le test de la liste. Les relances, les changements de verdict, les exécutions qui n'ont jamais tourné à cause d'une erreur d'infrastructure et les modifications sont comptés séparément et jamais additionnés les uns aux autres. Seules les exécutions comparables partagent un historique : le même test, avec la même définition (un simple renommage ne le sépare pas, un changement de ses étapes, données ou dépendances si), sur le même navigateur, environnement, langue et appareil. **Preuves** liste ce qui s'est passé, le plus récent d'abord, chaque élément lié au rapport de l'exécution, ouvert sur la tentative qui le montre — pour une relance, la première tentative qui a échoué et pourquoi. Une exécution enregistrée avant la conservation des tentatives indique que la cause n'a pas été enregistrée plutôt que d'en deviner une.

Un test instable peut être mis en **quarantaine**, avec la raison. Il continue de s'exécuter et ses
résultats sont conservés, mais ses échecs ne font plus échouer les exécutions, n'arrêtent plus les
plans, ne créent plus de tickets et ne cassent plus les pipelines. **Tests en quarantaine** montre
comment chacun s'est comporté depuis ; une fois qu'il réussit de nouveau, **Libérer** le test avec
une note sur ce qui l'a corrigé. Les tests web, API et [mobiles](./mobile-apps#quarantine) peuvent
tous être mis en quarantaine.

## Durée de conservation des preuves

Les captures d'écran, vidéos, traces et captures réseau sont supprimées après la durée de
conservation de votre installation (90 jours par défaut). Le rapport l'indique alors ; ses
résultats et verdicts restent.
