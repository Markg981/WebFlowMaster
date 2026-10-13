# Premiers pas

WebFlowMaster teste les applications web, les protocoles HTTP et API natifs, les applications
mobiles et les scénarios BDD. Vous construisez un test en l'enregistrant, en faisant glisser des
étapes ou en le décrivant en phrases ; vous regroupez les tests en **plans** ; les plans s'exécutent
à la demande, selon un planning ou depuis un pipeline de CI, dans un ou plusieurs navigateurs ; et
chaque exécution laisse un **rapport** avec captures d'écran, durées et, si vous le souhaitez, une
vidéo, une trace Playwright et le trafic réseau.

Pressé ? [Votre premier test en 10 minutes](../start/qa) est le chemin court ; cette page est le
chemin complet.

Ce guide s'adresse à celles et ceux qui écrivent et exécutent les tests. La mise en place d'une
installation et la gestion d'une organisation sont décrites dans
[Administration](/en/admin/administration) (en anglais). Pour l'exécution sur appareil, lisez
[Applications mobiles](./mobile-apps) ; pour les scénarios manuels ou Cucumber dédié, lisez
[BDD tests](./bdd-tests). Le mobile et Cucumber utilisent leurs propres cibles d'exécution plutôt
que la matrice de navigateurs.

## Se connecter

Connectez-vous avec le nom d'utilisateur et le mot de passe que le propriétaire de votre
organisation vous a donnés, généralement via un lien d'invitation. Selon la configuration de votre
organisation :

- **Authentification à deux facteurs** : après le mot de passe, un code à six chiffres de votre
  application d'authentification vous est demandé. Si votre organisation l'exige et que vous ne
  l'avez pas encore configurée, l'application vous demande de le faire d'abord (**Paramètres →
  Sécurité**).
- **Authentification unique** : choisissez **Se connecter avec le SSO**, saisissez votre adresse
  e-mail professionnelle et connectez-vous chez le fournisseur d'identité de votre entreprise. Si
  la page de connexion indique que votre organisation se connecte par authentification unique,
  votre mot de passe n'y fonctionne plus : utilisez ce bouton.

Mot de passe oublié ? Demandez un lien de réinitialisation à un propriétaire de votre organisation.

**Plusieurs organisations ?** Le propriétaire d'une autre organisation peut inviter votre nom
d'utilisateur existant ; ouvrez le lien d'invitation en étant connecté et acceptez : cette
organisation est ajoutée à votre compte. Un menu des organisations apparaît alors dans l'en-tête, à
côté de la recherche : choisissez-en une et toute l'application affiche cette organisation — ses
tests, plans, exécutions et paramètres, avec le rôle que vous y avez — et rien des autres. Là où
l'authentification unique est configurée sur un domaine vérifié, vous connecter via le fournisseur
de cette organisation vous y fait aussi entrer.

## S'orienter

![Le tableau de bord : exécutions, tendances et planifications, avec la barre latérale à gauche](/screenshots/dashboard.webp)

La barre latérale contient tout :

| Section                   | À quoi elle sert                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Tableau de bord**       | Vues privées et partagées des exécutions, tendances et planifications. Voir [Conversations et tableaux de bord](./collaboration). |
| **Testeur d’API**         | Construire et enregistrer des tests API. Voir [Tests API](./api-tests).                                                           |
| **Applications mobiles**  | Définitions d'applications natives, inspecteur et exécution sur appareil. Voir [Applications mobiles](./mobile-apps).             |
| **Créer un Test**         | Le constructeur de tests web. Voir [Tests web](./web-tests).                                                                      |
| **Bibliothèque de tests** | Tous les tests enregistrés, avec étiquettes et historique. Voir [Organiser les tests](./organizing).                              |
| **Gestionnaire de tests** | Importer des cas de test depuis Excel et les associer à des tests enregistrés.                                                    |
| **Suites**                | Listes de tests partagées par plusieurs plans.                                                                                    |
| **Plans de test**         | Quoi exécuter, où et comment ; le bouton **Exécuter**. Voir [Exécuter les tests](./running).                                      |
| **Relectures**            | Les modifications en attente d'approbation, quand votre organisation relit les tests avant qu'ils s'exécutent.                    |
| **Planification**         | Les plans qui s'exécutent d'eux-mêmes.                                                                                            |
| **Rapports**              | Toutes les exécutions terminées, les tests instables et la quarantaine. Voir [Résultats](./results).                              |
| **Paramètres**            | Vos préférences et votre mot de passe et, selon votre rôle, environnements, projets, membres, clés et le reste.                   |

**Ctrl+K** (**⌘K** sur Mac), ou **Rechercher** dans la barre du haut, ouvre la palette de commandes
depuis n'importe quelle page : tapez une partie d'un nom pour aller à une page, exécuter un plan de
test, passer du thème clair au thème sombre ou vous déconnecter. Les plans ne sont proposés qu'aux
éditeurs et aux propriétaires, qui peuvent lancer une exécution.

**Nouveautés**, dans le menu du compte (le cercle avec vos initiales, en haut à droite) et dans la
palette de commandes, liste ce qui a changé dans cette installation, du plus récent au plus ancien,
avec un lien vers la pull request de chaque changement : c'est le `CHANGELOG.md` que contient
l'installation, il décrit donc la version que vous utilisez. Un point sur le cercle signale des
changements que vous n'avez pas encore lus ; ouvrir la page le fait disparaître, dans ce
navigateur.

Sur un téléphone, la barre latérale est masquée : le bouton **menu** (☰) à gauche de la barre du
haut l'ouvre en tiroir, qui se ferme dès que vous choisissez une page ou appuyez sur **Échap**. Les
pages faites pour être lues — le tableau de bord, **Rapports** et le rapport d'une exécution —
tiennent dans la largeur d'un téléphone ou d'une tablette ; les tableaux larges défilent
horizontalement dans leur propre cadre. La construction des tests et des plans est pensée pour un
ordinateur.

Ce que vous pouvez faire dépend de votre **rôle** : les lecteurs consultent les tests et les
résultats ; les éditeurs peuvent aussi les créer, les modifier et les exécuter ; les propriétaires
gèrent en plus l'organisation. Les boutons que vous ne pouvez pas utiliser sont masqués ou
désactivés.

## Projets et environnements

Deux choses valent la peine d'être configurées avant le premier test, dans **Paramètres** :

- Un **projet** regroupe les tests d'une application. Il garde la bibliothèque de tests en ordre,
  et c'est là que le [référentiel d'éléments](./web-tests#element-repository) conserve les éléments
  partagés. Un propriétaire peut réserver un projet à certains membres.
- Un **environnement** (Staging, Production…) contient les valeurs dont un test a besoin sur cette
  cible — son adresse, des noms d'utilisateur, des mots de passe — sous forme de **secrets**
  chiffrés. Les tests y font référence avec <code v-pre>{{nom}}</code> : le même test s'exécute
  ainsi sur Staging ou sur Production selon l'environnement choisi. Voir
  [Variables et environnements](./web-tests#variables-and-environments).

## Commencer avec un projet d’exemple

Le tableau de bord d’une nouvelle organisation propose **Commencer avec un projet d’exemple** aux
éditeurs et aux propriétaires tant que l’organisation n’a pas de tests à elle. **Créer le projet
d’exemple** ajoute le projet _Northwind Shop (sample)_ : cinq tests web et trois tests API sur une
petite boutique de café que cette installation sert elle-même à `/demo-shop`, et quatre plans qui
les exécutent. Le premier plan, _Sample · Checkout smoke_, démarre aussitôt et le rapport de cette
exécution s’ouvre : en une minute, vous voyez une vraie exécution. Les autres sont dans
**Test plans** : _Storefront regression_ exécute tous les parcours sur Chromium, Firefox et WebKit,
_Orders API contract_ passe une commande puis la relit avec le numéro renvoyé par le premier appel,
et _Catalog checks (fails on purpose)_ échoue sur le contrôle de la bannière, pour montrer à quoi
ressemble un échec : l’étape, la capture d’écran, la vidéo et la trace.

Tout y est ordinaire : modifiez les tests, exécutez les plans, supprimez le projet et les tests
quand vous n’en avez plus besoin. **Plus tard** masque la proposition, dans ce navigateur. Si votre
organisation fait relire les tests avant de les exécuter, la première exécution ne démarre pas :
publiez les tests d’exemple, puis exécutez ses plans. Si les exécutions n’atteignent pas la
boutique, un administrateur définit `DEMO_SHOP_URL` ([Configuration](/en/admin/configuration)).

## Votre premier test, de bout en bout

1. **Créer un Test** : saisissez l'adresse de l'application, **Charger le site**, puis **Détecter
   les éléments**.
2. Faites glisser des actions dans la **Séquence du test** et donnez à chacune son élément, ou
   enregistrez-les. Cliquez sur **Exécuter le test** pour le voir s'exécuter.
3. **Enregistrer le test**, dans un projet.
4. **Plans de test → + Plan de test** : nommez le plan et ajoutez-y le test.
5. **Exécuter** le plan, puis ouvrez le rapport quand il se termine.
6. Quand il passe de façon fiable, **Planification → Créer une planification** pour l'exécuter
   chaque nuit, ou exécutez-le depuis votre pipeline ([CI integration](/en/integrations/ci), en
   anglais).

## Paramètres personnels

**Paramètres → Préférences** contient la langue de l'interface (English, Italiano, Français,
Deutsch) et le thème ; **Paramètres → Valeurs par défaut** le navigateur et les délais qu'utilise le
constructeur. **Paramètres → Sécurité** contient votre second facteur, et **Paramètres → Compte**
votre mot de passe.
