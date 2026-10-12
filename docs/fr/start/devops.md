# Votre première exécution depuis un pipeline

Pour les ingénieurs DevOps et de release. À la fin, un job de CI lance un plan de test
WebFlowMaster, attend qu'il se termine, fait échouer le build quand le plan échoue et publie les
résultats dans le rapport de tests du système de CI. Il vous faut un plan qui passe déjà quand on
le lance à la main ([Votre premier test en 10 minutes](./qa)) et un **propriétaire** pour créer le
compte de service, ou bien le rôle de propriétaire vous-même.

## 1. Un compte de service et sa clé (5 minutes)

Un pipeline ne doit pas dépendre du compte d'une personne.

1. **Paramètres → Clés API**, carte **Comptes de service** : un nom d'après le pipeline
   (« ci-shop »), rôle **éditeur** (lancer des exécutions demande au moins ce rôle), **Créer le
   compte**.
2. Dans la carte **Clés API** au-dessus : un nom, **Attribuée à** le compte de service, ce que la
   clé peut faire → _uniquement ce que je choisis, via /api/v1_ avec **Lancer des exécutions et les
   annuler** (`runs:write`) et **Lire les exécutions, leur statut et leurs rapports JUnit**
   (`runs:read`) ; ajoutez **Lister les plans de test** (`plans:read`) si le job recherche des
   plans. Réglez **Expire dans (jours)** sur ce qu'accepte votre politique de rotation, puis
   **Créer une clé**.
3. Copiez la clé depuis **Copiez cette clé maintenant** : elle n'est affichée **qu'une fois** et
   n'est conservée que sous forme de hash.

Stockez-la comme secret dans votre système de CI (`WFM_API_KEY`), jamais dans le dépôt. Stockez
l'adresse du serveur dans `WFM_URL` et l'identifiant du plan — sur la page du plan, ou via
`GET /api/v1/plans` — dans `WFM_PLAN_ID`. Détails :
[API keys and service accounts](/en/admin/administration#api-keys-and-service-accounts) (en
anglais).

## 2. L'essayer depuis votre machine (3 minutes)

Le serveur distribue une CLI toujours alignée sur sa version :

```bash
curl -fsSL "$WFM_URL/cli/wfm.mjs" -o wfm.mjs
node wfm.mjs run "$WFM_PLAN_ID" --wait --junit junit.xml
echo $?
```

**Le code de sortie fait foi :** `0` le plan a réussi, `1` il a échoué (erreur, annulation et
dépassement de délai compris), `2` l'étape elle-même n'a pas pu être menée à bien — mauvaise
adresse, clé invalide, serveur injoignable. Les échecs de tests en quarantaine ne font pas échouer
l'exécution. Détails : [The CLI](/en/integrations/ci#_2-the-cli) (en anglais).

## 3. L'ajouter au pipeline (10 minutes)

GitHub Actions, avec l'action du dépôt :

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: Markg981/WebFlowMaster/integrations/github-action@main
        with:
          url: ${{ vars.WFM_URL }}
          api-key: ${{ secrets.WFM_API_KEY }}
          plan: ${{ vars.WFM_PLAN_ID }}
          idempotency-key: ${{ github.run_id }}-${{ github.run_attempt }}
```

Une fois que cela fonctionne, épinglez l'action sur un tag de release ou un commit plutôt que sur
`@main`. GitLab CI, Jenkins, Azure Pipelines, Bitbucket Pipelines et CircleCI disposent de modèles
prêts à l'emploi qui fonctionnent de la même façon :
[Running test plans from CI](/en/integrations/ci) (en anglais).

La **clé d'idempotence** fait qu'une étape de CI relancée suit l'exécution qu'elle a déjà démarrée
au lieu d'en démarrer une seconde.

## 4. Vérifier le résultat (2 minutes)

Poussez un commit. Le job exécute le plan et :

- réussit ou échoue avec le plan ;
- écrit `webflowmaster-junit.xml`, que lit le rapport de tests du système de CI ;
- envoie avec l'exécution le dépôt, le commit, la branche et le lien du build, de sorte que le
  rapport WebFlowMaster renvoie vers le build.

## Ensuite

- Uniquement les tests touchés par un changement : `changed-since` et la
  [carte d'impact](../guide/running#impact).
- Un statut sur le commit ou la pull request :
  [Commit status on GitHub and GitLab](/en/integrations/ci#_10-commit-status-on-github-and-gitlab)
  (en anglais).
- Des rapports HTML, PDF ou Allure comme artefacts du build : les entrées `html`, `pdf` et
  `allure`.
- Des applications joignables uniquement dans votre réseau :
  [Local agents](/en/integrations/local-agents) (en anglais).
- Tout ce que l'API sait faire d'autre : [REST API](/en/reference/api) (en anglais).
