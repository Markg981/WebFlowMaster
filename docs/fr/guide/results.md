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
réussites et d'échecs des 30 derniers jours, les rapports les plus récents et les prochaines
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
exécution dont des tests sont en attente se termine tout de même comme terminée. Une fois
l'exécution terminée, un éditeur ouvre la ligne, marque chaque étape **OK**, **KO** ou **Non fait**
avec une note, et consigne le verdict :

- **Réussi** compte avec les tests réussis.
- **Échec** compte avec les tests en échec et fait échouer l'exécution ; la raison affichée est la
  note ou, à défaut, la note de la première étape KO.
- **Bloqué** (il n'a pas pu être réalisé) compte avec les tests ignorés.

Chaque verdict recalcule les totaux et le statut de l'exécution : le rapport mêle ainsi résultats
manuels et automatisés. Une exécution annulée ou arrivée à expiration garde sa fin. Un verdict peut
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
de cas, et pourquoi une publication a échoué (un mauvais jeton, un cas refusé par l'outil).
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

Une étape marquée **réparé** n'a trouvé son élément qu'après le remplacement de son sélecteur (voir
[Référentiel d'éléments](./web-tests#element-repository)).

### Tests visuels {#visual-testing}

Quand les **Tests visuels** sont activés dans un plan, la capture d'écran de chaque étape est
comparée à sa **référence**. La première exécution après l'activation enregistre les références.
Ensuite, une étape dont la capture diffère montre la **Référence**, **Cette exécution** et la
**Différence**.

### Réseau

Quand le plan conserve le réseau, le rapport résume le trafic de chaque test : combien de
requêtes, combien en échec, combien de données reçues, et les requêtes en échec et les plus lentes.
**Télécharger le HAR** pour ouvrir la capture complète dans les outils de développement de
n'importe quel navigateur. Il ne contient jamais les corps des requêtes ou des réponses, ni les
cookies, jetons ou mots de passe.

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
modifié. Les tests mobiles sont comptés par appareil
([applications mobiles](./mobile-apps#unstable)).

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
