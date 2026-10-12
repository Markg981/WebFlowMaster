# Documentation de WebFlowMaster

WebFlowMaster est une plateforme d'automatisation des tests pour les applications web, les API HTTP
et les applications mobiles natives : enregistrez ou décrivez vos tests, organisez-les en plans et
en suites, exécutez-les sur plusieurs navigateurs selon un planning ou depuis la CI — y compris à
l'intérieur de réseaux que le serveur ne peut pas atteindre — et obtenez un rapport détaillé de
chaque exécution.

**Premier jour ?** [Par où commencer](./start/) propose un parcours court par rôle : le premier
test d'un testeur en 10 minutes, la première exécution d'un ingénieur DevOps depuis un pipeline, la
première organisation d'un administrateur avec authentification unique.

## Guide utilisateur

Pour celles et ceux qui écrivent et exécutent les tests :

- [Premiers pas](./guide/) — connexion, orientation, un premier test de bout en bout.
- [Tests web](./guide/web-tests) · [Tests API](./guide/api-tests) ·
  [Tests de charge](./guide/load-tests) · [BDD / Cucumber](./guide/bdd-tests) ·
  [Fichiers Gherkin](./guide/gherkin-files) · [Applications mobiles](./guide/mobile-apps)
- [Organiser les tests](./guide/organizing) ·
  [Conversations et tableaux de bord](./guide/collaboration) ·
  [Exécuter les tests](./guide/running) · [Résultats](./guide/results)

## Documentation de référence, en anglais

Le reste de la documentation existe en anglais (et en italien). Elle s'adresse surtout à celles et
ceux qui installent et administrent la plateforme ou la font évoluer :

- [WebFlowMaster at a glance](/en/overview) — ce qu'est le produit, comment il est construit, où
  se trouve chaque chose.
- [Install and administer](/en/admin/installation) — installation, exploitation, configuration,
  administration d'une organisation.
- [Security and compliance](/en/security/) — isolation, identité, chiffrement, audit, protection
  des données.
- [Integrations](/en/integrations/ci) — CI et agents locaux.
- [Reference](/en/reference/api) — API REST, ligne de commande `wfm`,
  [notes de version](/en/reference/changelog).
- [Internals](/en/internals/) — architecture et fonctionnement interne.

## PDF

`npm run docs:pdf` écrit chaque section de cette documentation en PDF, dans chaque langue, dans
`docs/pdf/` — pour un dossier d'audit ou une lecture hors ligne.
