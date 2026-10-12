# Votre premier test en 10 minutes

Pour les testeurs. Il vous faut un compte avec le rôle **éditeur** (demandez une invitation à un
propriétaire de votre organisation) et l'adresse d'une application web à tester. N'importe quelle
page publique convient pour un premier essai.

## 1. Se connecter (1 minute)

Ouvrez le lien d'invitation, choisissez un mot de passe et connectez-vous. Si votre organisation
utilise l'authentification unique, choisissez **Se connecter avec le SSO** et saisissez votre
adresse professionnelle ; si elle exige l'authentification à deux facteurs, configurez-la quand
elle vous est demandée. Détails : [Se connecter](../guide/#se-connecter).

## 2. Un projet pour ranger le test (1 minute)

**Paramètres → Projets** : saisissez le nom de l'application dans **Nom du nouveau projet** et
cliquez sur **Créer le projet**. Sautez cette étape si le projet existe déjà, ou créez-le plus tard
depuis la fenêtre d'enregistrement (**Créer un nouveau projet**). Les projets gardent la
bibliothèque en ordre et regroupent les éléments partagés
([Projets et environnements](../guide/#projets-et-environnements)).

## 3. Construire le test (4 minutes)

1. Ouvrez **Créer un Test**, saisissez l'adresse dans **URL du site à tester** et cliquez sur
   **Charger le site**. Une capture d'écran de la page apparaît.
2. Cliquez sur **Détecter les éléments** : les boutons, champs et liens de la page sont listés avec
   leurs sélecteurs.
3. Faites glisser **Saisir du texte** depuis **Actions disponibles** dans la **Séquence du test**,
   déposez-y un champ pris dans **Éléments détectés** et saisissez la valeur.
4. Ajoutez **Cliquer sur un élément** pour le bouton, puis **Vérifier le texte** avec
   un élément et le texte que vous attendez ensuite. Un test sans vérification prouve seulement que
   la page n'a pas planté.
5. Cliquez sur **Exécuter le test** et regardez chaque étape passer au vert.

Vous préférez enregistrer ? **Enregistrer les actions de l’utilisateur**, sur la même page, ouvre
une fenêtre de navigateur et transforme vos clics et vos saisies en étapes ; il faut un écran, donc
cela fonctionne quand WebFlowMaster tourne sur votre propre machine
([Enregistrement](../guide/web-tests#enregistrement)). Vous préférez les mots ? Décrivez le test en phrases
([Décrire un test en phrases](../guide/web-tests#decrire-un-test-en-phrases)).

## 4. L'enregistrer (30 secondes)

**Enregistrer le test**, donnez-lui un nom qu'un collègue comprendra (« Connexion avec un compte
valide ») et choisissez le projet.

## 5. Le mettre dans un plan et l'exécuter (2 minutes)

1. **Plans de test → + Plan de test** : nommez le plan (« Smoke »), ajoutez le test, gardez le
   navigateur par défaut.
2. Cliquez sur **Exécuter**. L'exécution est mise en file d'attente, prise en charge par un worker
   et exécutée.

## 6. Lire le rapport (1 minute)

Ouvrez l'exécution quand elle est terminée, depuis le plan ou depuis **Rapports**. Chaque test
montre ses étapes, une capture d'écran de chacune, leur durée et, en cas d'échec, l'étape qui a
échoué et pourquoi ([Résultats](../guide/results)).

## Ensuite

- L'exécuter chaque nuit : **Planification → Créer une planification**
  ([Planification](../guide/running#planification)).
- Le même test sur Staging et sur Production : mettez l'adresse dans un
  [environnement](../guide/web-tests#variables-and-environments) et écrivez
  <code v-pre>{{baseUrl}}</code>.
- Beaucoup de lignes de données : [Datasets](../guide/web-tests#datasets).
- Votre API, votre application mobile : [Tests API](../guide/api-tests),
  [Applications mobiles](../guide/mobile-apps).
- Confiez-le à votre pipeline : [Votre première exécution depuis un pipeline](./devops).
