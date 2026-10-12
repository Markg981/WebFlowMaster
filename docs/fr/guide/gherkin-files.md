# Fichiers Gherkin / Cucumber

La CLI suit le même processus d'import et d'export avec une clé API à accès complet :

```sh
wfm tests export --project 12 --format gherkin --out specs/shop.feature
wfm tests import specs/shop.feature --project 12 --dry-run
wfm tests import specs/shop.feature --project 12
```

L'import reconnaît le Gherkin à son contenu ; il n'exige pas `--format`. L'export utilise le nom de
fichier proposé par le serveur sauf si `--out` est fourni, avec `tests.feature` par défaut.

Dans **Tests en fichiers**, choisissez **Gherkin** pour exporter des tests web dans un fichier
`.feature`. Les tests API en sont exclus ; les lots YAML/JSON continuent d'inclure les deux types.
Importez un fichier `.feature` ou sélectionnez Gherkin avant de coller du texte, prévisualisez les
modifications, puis importez. Les noms existants sont mis à jour avec une nouvelle version ; les
nouveaux tests utilisent le projet sélectionné. L'accès suit les rôles de l'organisation et la
visibilité des projets.

Le parseur Gherkin officiel prend en charge tous les dialectes officiels via `# language:`, `Rule`,
les Background de Feature et de Rule, les descriptions, les Examples étiquetés, les doc strings et
les DataTables échappées. Chaque ligne d'Examples crée un test distinct avec le sélecteur de son
emplacement d'origine dans la source. Les arguments structurés et les étiquettes héritées restent
attachés aux étapes.

Choisissez l'exécution **Manuel** pour conserver la prose et les arguments en vue du verdict d'un
testeur, ou **Cucumber** avec un profil autorisé pour exécuter de vraies définitions
JavaScript/TypeScript sur l'agent dédié de votre organisation. L'import ne génère ni définitions
ni actions de navigateur. Le `this.parameters` du World contient les variables de l'exécution. Les
plans s'exécutent une fois par scénario ou ligne de dataset enregistré, indépendamment de la
matrice navigateurs/langues. Les étapes et hooks non définis, ambigus, en attente, ignorés ou en
échec ne comptent jamais comme réussis.

Un opérateur installe Cucumber.js **12.9.0**, les fichiers de support et les dépendances, puis
démarre l'agent **1.3.0** avec `WFM_BDD_PROFILES` pointant vers son manifeste. Seuls les
identifiants publics des profils, leurs libellés, révisions et limites sont annoncés. Un
propriétaire d'organisation associe un profil annoncé et un pool à l'organisation ou à un projet.
Les chemins des exécutables, les commandes et les loaders restent de la configuration
d'exploitation. Voir `deployment/bdd-agent/README.md` pour le déploiement et l'organisation du
projet. Les limites de processus et le conteneur dédié fourni constituent une isolation
opérationnelle ; Node n'est pas un bac à sable pour du code de support hostile.

Les imports exécutables portables exigent une liaison explicite vers une destination autorisée.
Pour l'import en CLI, ajoutez
`--bdd-mode cucumber --bdd-profile DESTINATION_UUID --bdd-revision SUPPORT_REVISION` ; utilisez
une liaison de `/api/bdd/profiles`, prévisualisez avec `--dry-run`, puis répétez sans. Les lots
YAML/JSON conservent eux aussi les définitions BDD. Un profil absent ou révoqué, ou une révision
qui ne correspond pas, échoue avant le chargement des modules de support. Les versions publiées
d'un test conservent leur source feature et la révision de support épinglée.

Les exports de WebFlowMaster incluent des métadonnées `# wfm-test:` qui préservent les actions
d'origine, la configuration BDD et les champs, y compris datasets, préparation et nettoyage. Les
étapes lisibles, les arguments structurés, les étiquettes et le contexte de Rule doivent
correspondre aux métadonnées. Supprimez les métadonnées d'un scénario avant d'importer
explicitement une prose modifiée. Les exports BDD sélectifs ne contiennent que les scénarios ou
lignes d'Examples choisis ; un Outline avec exactement une ligne préserve les espaces et arguments
multilignes impossibles à représenter autrement. Exportez un dialecte par fichier. Les scénarios
hors Rule précèdent les Rule, car Gherkin n'a pas de marqueur de fin de Rule.

Les fichiers sont limités à **20 Mio**, **2 000** tests développés, **100 000** étapes et **64 Mio**
de source et d'arguments développés conservés au total. Les limites à l'exécution sont de
**300 secondes**, **8 Mio** de sortie et **1 Mio** de pièces jointes au total. Seules les pièces
jointes en texte brut sont conservées ; les pièces jointes HTML ou binaires sont omises. Les
rapports échappent le texte et masquent les identifiants et les variables. Un test sans étapes ne
peut pas être exporté en Gherkin. Vérifiez les valeurs littérales avant de committer des fichiers ;
les références au référentiel d'éléments, aux groupes et aux actions personnalisées restent
propres à l'installation.
