# Organiser les tests

## La bibliothèque de tests

**Bibliothèque de tests** liste tous les tests web enregistrés : leurs étiquettes, leur point de
départ et la date de leur dernier enregistrement. Cherchez par nom, ou filtrez en cliquant sur une
étiquette. Depuis chaque ligne, vous pouvez ouvrir son **Historique**, changer ses étiquettes ou le
**Supprimer** (avec son historique).

![La bibliothèque de tests avec étiquettes, types et derniers résultats](/screenshots/test-library.webp)

La bibliothèque charge 25 résumés par page et affiche le total correspondant à vos filtres.
Utilisez **Précédent** et **Suivant** pour parcourir. La recherche par nom ignore la casse et
cherche le texte littéral (y compris `%` et `_`) ; plusieurs étiquettes sélectionnées exigent
toutes les étiquettes. Les filtres de projet et de statut s'appliquent avant la pagination, et
changer un filtre ramène à la première page. Les tests API, les tests mobiles et les données de
test partagées utilisent aussi des listes paginées. Chaque liste ne charge les définitions
complètes qu'au besoin : modifier un test manuel ou BDD récupère ses étapes, modifier un jeu de
données récupère sa table, et charger ou exécuter un test API ou mobile récupère sa configuration
exécutable. Les réponses des listes contiennent des métadonnées et des nombres, pas toutes les
étapes ni toutes les valeurs des datasets.

Les **Tags** sont les étiquettes propres à votre organisation — `smoke`, `checkout`, `nightly` —
ajoutées depuis la ligne du test. C'est sur elles que sélectionnent les [suites dynamiques](#suites).
**Paramètres → Tags** liste chaque étiquette avec le nombre de tests qui la portent ; un éditeur
peut l'y renommer (tous les tests suivent) ou la supprimer, ce qui la retire de tous les tests qui
la portaient.

## Tests manuels {#manual-tests}

Utilisez **Bibliothèque de tests → Nouveau test manuel** pour enregistrer une procédure humaine avec
ses étapes. Un plan consigne les résultats manuels au lieu de transformer des phrases en actions de
navigateur. Relisez-le et publiez-le avec le même processus de versions. L'édition et l'exécution
Gherkin sont décrites dans [Tests BDD](./bdd-tests).

**Fichiers Gherkin/Cucumber.** Dans **Fichiers**, sélectionnez **Gherkin (.feature)** pour exporter
des tests web, ou ouvrez un fichier `.feature` et prévisualisez son import. Le Gherkin multilingue
standard comprend Rule, Background, doc strings, tableaux d'étapes et Examples étiquetés.
Choisissez l'exécution manuelle ou un profil Cucumber autorisé sur l'agent dédié de votre
organisation. Les imports exécutables portables exigent une liaison de destination explicite ; les
définitions de support sont du JavaScript/TypeScript installé par l'opérateur. Les métadonnées
WebFlowMaster restaurent les actions de navigateur d'origine ou les définitions BDD versionnées.
Voir [le détail des fichiers Gherkin](./gherkin-files).

## Commentaires

Ouvrez **Commentaires** sur un test web, API ou mobile enregistré, ou sur le résultat d'un test dans
un rapport. Répondez, mentionnez des membres qui peuvent lire la cible et résolvez les
conversations. Voir
[Discuter d'un test ou d'un résultat](./collaboration#discuter-d-un-test-ou-d-un-resultat) pour les autorisations,
les filtres et le comportement à la suppression.

## Tableaux de bord

Gardez plusieurs tableaux de bord privés ou partagez-les avec votre organisation. Choisissez un
tableau par défaut et personnalisez les instances de widgets, les filtres, les titres et les
largeurs. Les dispositions personnelles existantes sont conservées. Voir
[Choisir et partager des tableaux de bord](./collaboration#choisir-et-partager-des-tableaux-de-bord).

## Écrire un test manuel

Tout ne vaut pas la peine d'être automatisé : une vérification faite une fois par release, un flux
qui demande le jugement d'une personne, un appareil qu'aucun navigateur ne peut remplacer.
**Nouveau test manuel** dans la bibliothèque en écrit un : un nom et ses étapes, chacune avec une
**Action** à réaliser et le **Résultat attendu**. Il apparaît dans la bibliothèque avec un badge
**Manuel**, et son crayon modifie les étapes. Chaque étape a besoin de son action : les étapes vides
sont retirées à l'enregistrement, et un test manuel sans aucune étape est refusé — via l'API aussi.

Un test manuel est un test comme les autres : il a des versions et des relectures, porte des
étiquettes, entre dans des suites et des plans. Dans une exécution, il n'ouvre aucun navigateur — il
attend dans le rapport de l'exécution le verdict de quelqu'un (voir
[Résultats manuels](./results#manual-results)), une fois par exécution quels que soient les
navigateurs et les langues du plan.

## Historique et versions {#history-and-versions}

Les tests web, API et mobiles ont leurs propres **versions**, numérotées à partir de 1. Enregistrer
une configuration exécutable modifiée crée une révision ; enregistrer une configuration inchangée
n'en crée pas. **Historique** montre les révisions de la plus récente à la plus ancienne, avec leur
auteur et leur date, et permet de les comparer. Les comparaisons API couvrent le protocole, la
requête, l'autorisation, les assertions, les captures, la performance et le nettoyage ; les
comparaisons mobiles couvrent la plateforme, l'application, l'appareil, l'OS, la grille et les
étapes.

**Restaurer** enregistre la configuration antérieure comme nouvelle révision de la copie de
travail et conserve toutes les révisions intermédiaires. Cela ne la publie pas et ne change pas la
version qu'exécutent les plans.

Les tests API et mobiles existants commencent à la version 1, avec la configuration enregistrée au
moment de la migration. Les modifications antérieures ne peuvent pas être reconstituées ; les
anciens résultats sans version restent sans version.

## Tests en fichiers {#tests-as-files}

**Bibliothèque de tests → Fichiers** exporte les tests web et API d'un projet — ou de tous — dans un
seul fichier YAML ou JSON, à conserver dans un dépôt à côté de l'application, à relire dans des
pull requests et à importer dans une autre installation. Le fichier contient ce que sont les tests
(étapes, préconditions, nettoyage, datasets, requêtes, assertions, champs de rapport) et rien de ce
qui appartient à cette installation : ni identifiants, ni auteurs, ni dates, de sorte qu'un diff ne
montre que ce qui a changé dans les tests. Un secret littéral dans l'autorisation d'un test API est
écrit comme une variable (<code v-pre>{{bearer_token}}</code>…) : définissez-la dans un
environnement là où les tests sont importés.

**Importer** relit un tel fichier. **Voir ce qui change** liste chaque test comme nouveau, mis à
jour, inchangé ou non importé (avec la raison) ; **Importer** enregistre ensuite : un test du même
nom est mis à jour et reçoit une nouvelle [version](#history-and-versions), les autres sont créés
dans le projet choisi. Les étapes qui appellent un groupe d'étapes ou une action personnalisée, ou
qui désignent un élément partagé, y font référence par identifiant : ces tests s'importent donc
dans leur propre organisation ; l'export indique combien il y en a. La CLI fait de même depuis un
pipeline : `wfm tests export` et `wfm tests import` ([CLI](/en/reference/cli), en anglais).

**En test Playwright.** L'icône de fichier sur un test web le télécharge comme fichier Playwright
Test (`*.spec.ts`), avec les étapes qu'exécute une exécution — groupes d'étapes et actions
personnalisées développés, éléments partagés résolus. Les variables proviennent de variables
d'environnement nommées `WFM_<NOM>` (`WFM_BASEURL` pour <code v-pre>{{baseUrl}}</code>) ; les
préconditions s'exécutent d'abord via la fixture request de Playwright, et le nettoyage ensuite,
quoi qu'il arrive ; un dataset devient un test par ligne. Les étapes sans équivalent hors de
WebFlowMaster — attendre un e-mail, une requête en base de données, l'analyse d'accessibilité —
sont écrites en commentaires, et les premières lignes du fichier disent combien.

## Publication et relectures {#publishing-and-reviews}

Ces règles s'appliquent aux tests **web, API et mobiles**. Un test enregistré est une **Copie de
travail**. Les plans exécutent la version **publiée** quand il y en a une ; si un test n'a jamais
été publié, les plans exécutent son dernier enregistrement — sauf si votre organisation exige des
relectures.

Le panneau de publication d'un test indique quelle version exécutent les plans et s'il existe des
modifications plus récentes :

- **Publier la version N** fait exécuter cette version par les plans dès leur prochaine exécution.
- **Revenir à celle-ci**, dans l'historique, fait de nouveau exécuter par les plans une version
  publiée antérieure.

Quand un propriétaire active **Exiger une relecture pour publier** (dans **Relectures**), publier
une version demande l'approbation d'un autre membre autorisé. La page partagée **Relectures**
regroupe les trois types de tests :

1. L'auteur utilise **Demander la relecture de la version N**, avec une note pour le relecteur.
2. Un autre membre ouvre **Relectures**, lit la modification et choisit soit **Approuver et
   publier**, soit **Refuser** avec un commentaire qui dit ce qui doit changer. Personne n'approuve
   sa propre modification.
3. Tant que rien n'est publié, les plans ignorent le test. Revenir à une version qui était en
   service auparavant reste possible sans relecture.

L'historique, la publication et les relectures respectent l'accès à l'organisation et aux projets
restreints. Modifier un test après publication laisse les plans sur la révision publiée. Une
exécution directe d'un test API ou une exécution de débogage mobile utilise la copie de travail
enregistrée ; l'exécution mobile capture cette configuration au moment de la demande, de sorte
qu'une modification ultérieure ne peut pas changer une exécution déjà demandée. Les résultats des
plans enregistrent la révision exécutée.

## Suites {#suites}

Une **suite** est une liste de tests tenue à un seul endroit et incluse par autant de plans que
nécessaire. **Suites → Nouvelle suite** en crée une de l'un de deux types :

- **Statique** : ces tests, dans l'ordre où vous les choisissez — tests web, API et
  d'[application mobile](./mobile-apps) indifféremment.
- **Dynamique** : tous les tests qui portent **toutes** les étiquettes choisies, déterminés à chaque
  création d'exécution. Un test étiqueté plus tard est inclus dans l'exécution suivante sans rien
  modifier — tests web, API et d'[application mobile](./mobile-apps#tags) indifféremment.

Une suite montre quels plans l'incluent. Supprimer une suite utilisée par des plans leur fait
cesser d'exécuter ses tests ; les exécutions déjà faites gardent ce qu'elles ont exécuté.

## Exigences et couverture {#requirements}

**Exigences** répond à la question qu'on se pose avant une release : quelles stories sont testées,
lesquelles échouent, et lesquelles n'ont aucun test.

Une exigence est un **Epic**, une **User story** ou une simple **Exigence**, avec une clé
(`SHOP-142`, `4711`, `REQ_12`), un titre et l'epic auquel elle appartient. Ajoutez-en une avec
**Nouvelle exigence**, ou **Importer depuis le tracker** via un Jira ou un Azure DevOps déjà connecté
dans **Paramètres → Gestionnaires de tickets** :

- **Les epics et stories du projet** (Jira : types de ticket Epic et Story ; Azure DevOps : Epic,
  Feature, User Story, Product Backlog Item, Requirement) ;
- **Ces clés** : `SHOP-142, SHOP-143`, ou des identifiants de work items ;
- **Une requête JQL** (Jira) ou **Une requête WIQL** (Azure DevOps), par exemple les stories d'une
  release.

Une story importée amène son epic, et chacune se range sous son parent. Importer de nouveau, ou
**Synchroniser les importés**, met à jour les titres, les types et le statut du tracker ; une
exigence saisie à la main avec la même clé devient l'exigence importée, en gardant ses tests. Rien
n'est jamais écrit dans le tracker. Au plus 500 éléments arrivent en une fois.

**Tests** sur une exigence relie les tests web, API et d'[application mobile](./mobile-apps) qui la
couvrent. Un epic compte ses propres tests et ceux de chacune de ses stories, chacun une fois. Sa
couverture se calcule à partir du **dernier résultat de chaque test**, tous les navigateurs de
cette exécution ensemble :

| Couverture      | Signification                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Réussie**     | Chaque test qui la couvre a réussi lors de sa dernière exécution.                                                             |
| **En échec**    | Au moins un a échoué (sur n'importe quel navigateur).                                                                         |
| **Non exécuté** | Aucun n'a échoué, mais certains ne se sont jamais exécutés, ont été ignorés, ou sont des tests manuels en attente de verdict. |
| **Aucun test**  | Rien ne la couvre.                                                                                                            |

**Résultats de** restreint les exécutions prises en compte : la dernière exécution de chaque test
n'importe où, ou la dernière exécution d'un plan — le plan de release, par exemple. **Exigences
couvertes** dans le rapport d'une exécution ouvre la page avec exactement les résultats de cette
exécution. Les nombres au-dessus du tableau donnent le total, la part avec au moins un test, et
combien sont dans chaque état. Les nombres d'une ligne ouvrent ses tests, chacun avec son dernier
résultat et un lien vers le rapport de cette exécution.

**Exporter la matrice (CSV)** télécharge la matrice de traçabilité de ce qui est affiché : une ligne
par exigence et test couvrant, avec son dernier résultat, son exécution et son plan, et une ligne
pour chaque exigence qu'aucun test ne couvre.

Un test relié qui se trouve dans un projet que vous ne pouvez pas voir est compté (_+1 dans des
projets que vous ne pouvez pas voir_) mais pas nommé, exclu de l'état, et reste relié quand vous
changez les autres. Les lecteurs consultent ; les éditeurs ajoutent, importent, relient et
suppriment. Supprimer une exigence supprime ses liens, jamais les tests ; ce qu'elle contenait
remonte au premier niveau.

### Des tests à partir d'une story {#tests-from-a-story}

Le bouton étincelle sur la ligne d'une exigence lui propose des cas de test, quand l'opérateur a
configuré le modèle d'IA. Il lit la story telle que le tracker l'a **maintenant** — sa description
et ses critères d'acceptation (Jira : les champs nommés _Acceptance criteria_ ; Azure DevOps :
_Acceptance Criteria_) — ou, pour une exigence saisie ici, sa description. **Proposer des tests**
en demande jusqu'au nombre choisi (6 par défaut, 12 au plus), rédigés dans la langue de
l'interface : le chemin principal, les erreurs qu'un utilisateur peut commettre et les limites,
chacun avec le critère qu'il couvre, ses préconditions et ses étapes (une action et le résultat
attendu).

Rien n'est créé tant que vous ne le décidez pas. Chaque cas peut être renommé et corrigé — étapes
ajoutées, retirées, réécrites — et décoché ; **Créer** transforme les cas cochés en **tests
manuels**, reliés à l'exigence, avec les préconditions comme première étape. Ils s'exécutent dans
les plans comme tout test manuel, et leurs étapes sont des phrases que la
[description d'un test en phrases](./web-tests#decrire-un-test-en-phrases) transforme plus
tard en test automatisé. Un nom déjà pris fait refuser l'ensemble et s'affiche en rouge ; rien
n'est créé à moitié. **Proposer à nouveau** demande de nouveaux cas. Réservé aux éditeurs ; le
texte de la story est envoyé au modèle (voir [AI features](/en/security/#ai-features), en anglais),
et rien n'est écrit dans le tracker.

## Gestionnaire de tests

**Gestionnaire de tests** s'adresse aux équipes dont les cas de test vivent dans Excel.
**Téléverser l’Excel** (.xlsx, jusqu'à 10 Mo) importe un cas par ligne, avec son identifiant, sa
priorité et son objectif. Associez chaque cas à un test enregistré (**Choisissez une séquence**),
sélectionnez les cas, puis **Exécuter la sélection** ; le statut et le dernier rapport de chaque
cas s'affichent à côté.

## Données de test partagées {#test-data}

Les mêmes clients, produits ou cartes étaient autrefois copiés de test en test, et finissaient par
diverger. **Données de test** les garde une seule fois pour toute l'organisation : un jeu a un nom
(`customers`), une description et une table. Les lecteurs peuvent lire les jeux ; les éditeurs les
créent et les modifient.

Le gestionnaire liste les noms, descriptions et nombres de lignes et de colonnes par pages de 25,
avec le total correspondant et les commandes **Précédent**/**Suivant**. Cherchez par nom littéral,
sans tenir compte de la casse. Ouvrez **Modifier** pour charger les colonnes et lignes du jeu
sélectionné ; parcourir la liste ne télécharge pas toutes les tables. Créer, modifier ou supprimer
un jeu rafraîchit la liste.

Un jeu s'utilise de deux façons :

- **Des valeurs, dans n'importe quel test.** <code v-pre>{{data.customers.email}}</code> est la
  colonne `email` de la première ligne de `customers`, dans une étape d'interface, une requête API
  ou une étape mobile, dans les plans comme dans le constructeur. Les valeurs d'environnement de
  même nom l'emportent : un environnement peut ainsi en remplacer une.
- **Des lignes, pour un test d'interface.** Dans le dataset du test, **Utiliser un jeu de données
  partagé** fait exécuter le test une fois par ligne du jeu, avec ses colonnes en
  <code v-pre>{{colonne}}</code> — voir [Datasets](./web-tests#datasets).

Les noms sont faits de lettres minuscules, de chiffres et de tirets bas ; les colonnes de lettres,
de chiffres et de tirets bas, pour qu'un placeholder puisse les nommer. Un jeu contient jusqu'à
1 000 lignes et 50 colonnes. Un jeu sur lequel un test s'exécute ne peut pas être supprimé tant que
ce test l'utilise ; le refus nomme les tests. La création, la modification et la suppression d'un
jeu sont consignées dans le journal d'audit.
