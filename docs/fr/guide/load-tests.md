# Tests de charge

Le [contrôle de performance](./api-tests#performance) d'un test API répète une requête au sein
d'une exécution fonctionnelle : au plus 200 requêtes, 10 à la fois, avec les mêmes valeurs à chaque
fois. Il répond à la question « ce point d'accès est-il devenu plus lent ? ». Un **test de charge**
répond à une autre question : comment le système se comporte-t-il quand de nombreux utilisateurs
parcourent un flux en même temps, pendant des minutes, avec une charge qui augmente ?

Ouvrez **Tests de charge** dans la navigation. Un test de charge répète des tests API que vous avez
déjà enregistrés dans le [Testeur d’API](./api-tests) ; il ne s'exécute jamais dans le cadre d'un
plan.

## Le scénario

Un test de charge est une séquence de tests API enregistrés — se connecter, ajouter au panier,
payer — que chaque **utilisateur virtuel** exécute dans l'ordre, encore et encore. Un passage dans
la séquence est une **itération**.

- Ce qu'un test [capture](./api-tests#captures) est envoyé par les tests suivants de la même
  itération, comme dans un plan : le jeton de la connexion part dans la requête du panier.
- Un test échoue quand sa requête ne peut pas être envoyée ou qu'une de ses assertions n'est pas
  vérifiée. Un test en échec termine l'itération — les tests suivants enverraient ce qu'il n'a pas
  capturé — et l'utilisateur commence la suivante.
- **Pause après (ms)** attend après un test, comme le ferait une personne qui lit la page. Jusqu'à
  60 s.

Jusqu'à 20 tests API par scénario. Chaque test est envoyé avec sa propre méthode, son URL, ses
en-têtes, son corps, son authentification, ses assertions et ses captures, exactement comme dans un
plan.

## Le profil de charge

Le nombre d'utilisateurs virtuels suit des **paliers**. Chaque palier le fait évoluer linéairement,
de la valeur où s'est arrêté le palier précédent (0 au départ) jusqu'à sa cible
d'**utilisateurs virtuels**, sur sa **durée** :

| Palier | Durée | Utilisateurs virtuels | Ce qui se passe                        |
| ------ | ----- | --------------------- | -------------------------------------- |
| 1      | 60 s  | 50                    | montée de 0 à 50                       |
| 2      | 600 s | 50                    | maintien de 50 utilisateurs 10 minutes |
| 3      | 60 s  | 0                     | descente jusqu'à 0                     |

Jusqu'à 10 paliers ; 200 utilisateurs virtuels et 3 600 s au total, sauf si l'installation en
décide autrement (`LOAD_MAX_VIRTUAL_USERS`, `LOAD_MAX_DURATION_S` :
[configuration](/en/admin/configuration#load-tests), en anglais). Un test qui dépasse la limite est
refusé en la nommant. Un utilisateur au-delà de la cible courante s'arrête à la fin de son
itération : une descente ne coupe donc jamais un scénario en deux. L'éditeur dessine le profil au
fur et à mesure que vous le modifiez.

Le **préchauffage** (en secondes) est le début de l'exécution, envoyé mais non évalué : les caches,
les compilateurs JIT et les pools de connexions s'y remplissent. Ses requêtes sont comptées à part
et grisées sur la chronologie. Le préchauffage doit se terminer avant la fin du dernier palier.

## Des données par utilisateur virtuel

Sans jeu de données, chaque utilisateur virtuel envoie les mêmes valeurs. Choisissez l'un des jeux
de [données de test](./organizing#test-data) de l'organisation, et
`{{data.<jeu>.<colonne>}}` dans les tests API devient la ligne propre à chaque utilisateur :

- **Une ligne propre à chaque utilisateur virtuel** — l'utilisateur 1 lit la ligne 1,
  l'utilisateur 2 la ligne 2, et ainsi de suite. Le jeu doit avoir au moins autant de lignes que
  d'utilisateurs virtuels au pic, pour que deux utilisateurs ne partagent jamais un compte ;
  enregistrer ou lancer un test avec moins de lignes est refusé, en indiquant combien il en manque.
- **La ligne suivante à chaque itération** — chaque itération, de n'importe quel utilisateur, prend
  la ligne suivante et recommence au début une fois à la fin. N'importe quel nombre de lignes
  convient.

`{{load.vu}}` (1, 2, …) et `{{load.iteration}}` (1, 2, … pour chaque utilisateur) sont toujours
disponibles, par exemple pour rendre unique une référence de commande :
`order-{{load.vu}}-{{load.iteration}}`.

## Seuils et verdict

Chaque seuil est facultatif et évalué sur les requêtes envoyées après le préchauffage :

- **Médiane (p50)**, **95e centile (p95)**, **99e centile (p99)** et **La plus lente**, en ms ;
- **Requêtes échouées**, en pourcentage ;
- **Débit minimal**, en requêtes par seconde sur la durée évaluée.

Une exécution **réussit** quand elle va jusqu'au bout en respectant tous les seuils, et **échoue**
en nommant chaque seuil dépassé (« p95 412 ms > 300 ms », « débit 38 req/s < 50 req/s »). Une
exécution qui n'a évalué aucune requête échoue aussi. **Annulée** signifie que quelqu'un l'a
arrêtée, en file d'attente ou en cours ; **Impossible à exécuter** signifie qu'elle n'a jamais
démarré — un test API ou le jeu de données a été supprimé, le jeu de données a trop peu de lignes,
le profil dépasse les limites de l'installation ; **Worker perdu** signifie que le worker qui
l'exécutait a cessé de répondre (un plantage, un redéploiement qui n'a pas attendu) : son résumé
jusqu'à ce moment est conservé, et l'exécution ne s'est pas terminée.

## Lancer et suivre une exécution

Ouvrez les **exécutions** d'un test de charge, choisissez un environnement (ses variables et ses
secrets résolvent les `{{placeholders}}` comme dans un plan), puis **Lancer une exécution**.
L'exécution est **En file d’attente** jusqu'à ce qu'un worker de charge la prenne — immédiatement
s'il y en a un de libre — puis **En cours**. La page la suit toutes les 2 secondes :

- la progression, les utilisateurs virtuels actuels et au pic ;
- la chronologie : utilisateurs virtuels, requêtes par seconde et p95 dans le temps, avec le
  préchauffage grisé ;
- pour chaque test API et pour l'ensemble des requêtes : requêtes, erreurs, p50, p90, p95, p99 et
  la plus lente ;
- les itérations terminées et échouées, et les premières erreurs distinctes.

**Arrêter l'exécution** termine immédiatement une exécution en file d'attente, et une exécution en
cours en moins de 2 secondes ; les requêtes déjà parties se terminent. Chaque test de charge garde
ses 10 dernières exécutions sur la page, avec leur résumé et leur verdict.

### Où s'exécute une exécution

Une exécution de charge est un job dans une file d'attente qui lui est propre, exécuté par **l'un
des workers de l'installation**, à part des plans, des runners et des agents : elle ne prend pas
d'emplacement de runner, un plan ne la ralentit pas, et elle survit à un redémarrage du serveur
web — une exécution en cours continue, une exécution en file d'attente y reste. Comme la charge
part du réseau du worker, testez depuis un endroit d'où les workers atteignent le système testé.

- Une seule exécution de charge à la fois par organisation, en file d'attente ou en cours : deux se
  mesureraient l'une l'autre. L'installation peut en autoriser davantage
  (`LOAD_MAX_RUNS_PER_ORGANIZATION`) ; au-delà de la limite, un lancement est refusé et le dit.
- Un worker exécute une exécution de charge à la fois, sauf configuration contraire
  (`LOAD_WORKER_CONCURRENCY`) ; quand tous les workers sont occupés, une exécution attend
  **En file d’attente** et part dès qu'un worker se libère.
  L'[administrateur](/en/admin/load-testing#sizing-a-load-worker) (page en anglais) dimensionne et
  fait évoluer les workers.
- Une exécution est menée par un seul worker, entièrement : ses utilisateurs virtuels ne sont pas
  répartis entre workers. Au-delà de ce qu'un worker peut envoyer, on obtient plus de charge avec
  plus de workers exécutant plus d'exécutions — de plusieurs organisations, ou d'une organisation
  dont la limite a été relevée.
- Une exécution compte dans les [minutes d'exécution](/en/admin/administration#quotas) (en
  anglais) de l'organisation, comme un test API.
- Si le worker qui mène une exécution s'arrête, l'exécution se termine en **Worker perdu** environ
  deux minutes plus tard, et l'organisation peut en lancer une autre.

Les centiles proviennent d'un échantillon uniforme d'au plus 10 000 durées par test : au-delà, ce
sont des estimations ; les nombres, les erreurs, le minimum, la moyenne et le maximum sont exacts.
La chronologie compte au plus 240 points.

## Autorisations

Les lecteurs voient les tests de charge et leurs exécutions. Les éditeurs les créent, les
modifient, les exécutent, les arrêtent et les suppriment. Un test de charge dans un projet
restreint appartient au projet, comme ses tests API.
