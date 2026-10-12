# Tests BDD avec Gherkin et Cucumber

Gherkin est une description lisible d'un comportement. WebFlowMaster conserve sa source et la
sélection de scénarios avec un test, et propose deux modes d'exécution : **Manuel**, où une
personne consigne les résultats, et **Cucumber**, qui exécute sur un agent local un projet de
support fourni par un opérateur. Importer un fichier `.feature` n'implémente pas ses étapes
automatiquement.

## Choisir le mode avant d'importer

Utilisez le mode manuel quand le scénario décrit une procédure de recette humaine ou quand les
définitions d'étapes ne sont pas encore implémentées. Utilisez Cucumber quand l'équipe possède déjà
des définitions d'étapes exécutables et qu'un opérateur de la plateforme peut installer leurs
dépendances figées sur un agent.

En interne, les définitions BDD utilisent la bibliothèque de tests et de versions de l'interface.
Leur identité comprend la source, le dialecte, le nom logique du fichier `.feature`, la ligne du
scénario et, pour un Outline, la ligne d'Examples sélectionnée. Background, Rule, étiquettes,
DocStrings et DataTables sont analysés en tant que Gherkin plutôt qu'aplatis en sélecteurs de
navigateur. Gardez la source et la sélection cohérentes quand vous modifiez.

## Préparer l'exécution Cucumber

1. L'opérateur provisionne un agent local autorisé avec un projet de support et un manifeste
   `WFM_BDD_PROFILES`. Installez le bundle enfant BDD à côté de l'agent. Les exemples JS/TS
   maintenus et le conteneur isolé se trouvent dans `deployment/bdd-agent/`.
2. L'agent annonce un pool, un identifiant de profil d'opérateur et une révision exacte. Une
   révision identifie l'implémentation de support installée ; changer un nom de fichier dans la
   feature n'installe pas de code.
3. Un propriétaire ouvre **Paramètres → Agents locaux** et crée un **profil d'exécution Cucumber**
   à partir d'une cible annoncée. Choisissez un accès à l'échelle de l'organisation ou propre à un
   projet, et le délai maximal. Les délais des profils sont validés entre 1 et 300 secondes. Le
   pool et l'identité du profil d'opérateur ne peuvent pas changer lors d'une mise à jour ; créez
   une nouvelle liaison pour changer de cible.
4. L'éditeur choisit un profil autorisé et sa révision lors de l'import ou de la modification du
   test BDD. Publiez via le processus normal de relecture et de versions si le plan utilise des
   tests publiés.

Voir [la configuration des agents locaux](/en/integrations/local-agents) (en anglais). Provisionner
le code d'étapes d'un client est une tâche d'opérateur ; l'import d'une feature transfère la
source, pas un exécutable de support arbitraire.

## Importer, modifier et partager

Dans **Bibliothèque de tests → Fichiers**, choisissez l'entrée Gherkin et examinez l'aperçu avant
d'importer. Un Outline peut produire plusieurs définitions de scénario ou d'exemple sélectionnées.
Vérifiez le projet, le mode et la liaison plutôt que de supposer qu'une liaison venue d'une autre
installation reste autorisée ici. L'import exige une liaison de destination pour l'exécution
Cucumber.

Pour un test BDD enregistré, **Modifier Gherkin** ouvre l'éditeur de source. Changez la source et
la ligne de scénario ou d'exemple ensemble ; l'enregistrement réanalyse la source et régénère ses
étapes. Choisissez-y le mode manuel ou Cucumber. Les étapes BDD sont pilotées par la source au sein
de la définition : l'éditeur d'étapes ordinaire ne peut pas les modifier indépendamment. La
conversion en étapes manuelles ordinaires est une action délibérée distincte ; enregistrez d'abord
les modifications de la source si cette conversion est nécessaire.

La CLI peut importer du Gherkin avec une destination Cucumber explicite :

```sh
npm run cli -- tests import scenarios.feature --dry-run --bdd-mode cucumber --bdd-profile DESTINATION_UUID --bdd-revision SUPPORT_REVISION
```

Examinez le résultat du dry-run avant de retirer `--dry-run`. Voir la
[référence de la CLI](/en/reference/cli) (en anglais) et [les tests en fichiers](./organizing).
L'export Gherkin concerne les tests d'interface et BDD, pas les définitions API ou mobiles ;
exportez un dialecte à la fois. Les métadonnées WebFlowMaster qui préservent la source et la
liaison de destination sont deux contrats différents : les métadonnées n'autorisent pas la cible
d'exécution de l'installation d'origine.

## Exécuter et interpréter le rapport

Ajoutez le test à un plan ou à une suite comme d'habitude. Les unités Cucumber s'exécutent
indépendamment de la matrice de navigateurs du plan ; les lignes de dataset peuvent produire des
unités distinctes. Le worker résout la liaison exacte autorisée, exécute les préconditions via
l'agent, invoque Cucumber, puis tente le nettoyage. Une précondition en échec peut bloquer ou
ignorer l'exécution selon la politique du plan. Le nettoyage est tout de même rapporté.

Le rapport contient les statuts des étapes et des hooks Cucumber, la durée, les erreurs et des
pièces jointes texte de taille bornée. Des étapes non définies, en attente ou en échec n'établissent
pas un scénario réussi. Le mode manuel exige au contraire la saisie du résultat par une personne.
Aucun des deux modes ne promet de vidéo ou de trace du navigateur pour du code de support
arbitraire ; choisissez le mécanisme de preuve que votre projet de support et le contrat de la
plateforme fournissent réellement.

Les secrets sont masqués dans les preuves normalisées et la sortie est bornée. Les imports de
source sont limités à 20 Mio, avec d'autres budgets pour les tests, les étapes et la sortie
conservée. Des preuves d'exécution trop volumineuses peuvent donner une erreur avec preuves
écartées plutôt qu'un rapport sans limite.

## Dépannage

| Symptôme                                           | À vérifier                                                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Aucun profil disponible                            | L'agent est connecté, le manifeste est valide, le pool et les identifiants de l'organisation sont corrects |
| Liaison refusée                                    | Le projet ou l'organisation de destination l'autorise et la révision exacte du profil correspond encore    |
| Scénario introuvable                               | La ligne du scénario et la ligne d'Examples correspondent à la source modifiée et au dialecte              |
| Étapes non définies                                | L'opérateur a installé le projet de support et les dépendances prévus pour cette révision                  |
| L'exécution échoue avant Cucumber                  | Préconditions, disponibilité d'un emplacement sur l'agent, connectivité et délai                           |
| Profil mis à jour mais l'ancien test publié échoue | Reliez la définition à la nouvelle révision et republiez                                                   |

Pour les limites de l'implémentation, lisez le [suite handbook](/en/internals/suite-handbook) (en
anglais). Notez le profil et la révision, l'environnement de l'agent et le rapport réel lors de la
recette d'une intégration.
