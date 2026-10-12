# Votre première organisation avec authentification unique

Pour l'administrateur qui met en place une organisation. À la fin, vos collègues se connectent
avec leur compte d'entreprise, reçoivent un rôle selon leurs groupes et perdent l'accès quand ils
partent. Il vous faut le rôle **propriétaire** et, à portée de main, un administrateur de votre
fournisseur d'identité (Microsoft Entra ID, Okta, Google Workspace, Keycloak, ADFS…). Si
WebFlowMaster n'est pas encore installé, commencez par l'[Installation](/en/admin/installation) (en
anglais) : le premier compte enregistré devient propriétaire de la première organisation.

## 1. Nommer l'organisation et sécuriser votre propre compte (5 minutes)

1. **Paramètres → Compte** : changez le mot de passe initial si quelqu'un d'autre vous l'a donné.
2. **Paramètres → Sécurité** : configurez un second facteur avec une application
   d'authentification et gardez les codes de récupération en lieu sûr. Les propriétaires gardent la
   connexion par mot de passe même quand l'authentification unique est obligatoire : c'est donc ce
   compte qui permet d'entrer quand le fournisseur est en panne.
3. Invitez un second propriétaire (**Paramètres → Membres**), pour que l'organisation ne dépende
   jamais d'une seule personne.

## 2. Connecter le fournisseur d'identité (20 minutes)

OpenID Connect est le chemin le plus court quand le fournisseur le prend en charge ; SAML 2.0
fonctionne de la même façon du côté de WebFlowMaster
([Single sign-on](/en/admin/administration#single-sign-on), en anglais).

1. **Paramètres → Sécurité → Authentification unique**, protocole **OpenID Connect**. Copiez
   l'**URI de redirection**.
2. Chez le fournisseur, enregistrez une application web avec cette URI de redirection, les scopes
   `openid email profile` et un secret client.
3. De retour dans WebFlowMaster, saisissez l'**Émetteur (issuer)**, l'**ID client**, le **Secret
   client**, vos **Domaines e-mail** et le **Rôle des nouveaux comptes** (lecteur est la
   valeur prudente par défaut).
4. **Enregistrer**, puis **Tester le fournisseur**.
5. Déconnectez-vous et reconnectez-vous avec **Se connecter avec le SSO** en utilisant un compte de
   test de votre entreprise.

## 3. Prouver vos domaines (5 minutes)

Chaque domaine affiche un enregistrement DNS TXT, `_wfm-verification.<domaine>`. Publiez-le, puis
cliquez sur **Vérifier**. Sur une installation partagée, un domaine non prouvé n'achemine aucune
connexion, et le prouver empêche une autre organisation de le revendiquer.

## 4. Des rôles à partir des groupes (10 minutes)

Sous **Rôles depuis les groupes du fournisseur**, associez les groupes du fournisseur à des rôles :
par exemple `wfm-viewers` à lecteur, `wfm-testers` à éditeur, `wfm-admins` à propriétaire.
Demandez à l'administrateur du fournisseur d'envoyer les groupes dans le jeton (avec Entra ID,
associez les identifiants d'objet des groupes, pas leurs noms). Activez **Refuser qui n'est dans
aucun de ces groupes** pour faire des groupes la porte d'entrée : retirer quelqu'un des groupes chez
le fournisseur met alors fin à son accès ici lors de sa prochaine connexion.

## 5. La rendre obligatoire (2 minutes)

Quand un compte de test fonctionne de bout en bout, activez **La rendre obligatoire**. Les membres
autres que les propriétaires ne peuvent plus se connecter avec un mot de passe, et leurs sessions
ouvertes par mot de passe prennent fin. Les clés API continuent de fonctionner, les pipelines ne
sont donc pas concernés.

## 6. Consulter le journal d'audit (3 minutes)

**Paramètres → Journal d’audit** montre la modification des paramètres, chaque compte créé lors de
sa première connexion et chaque connexion avec `method: sso`
([Audit log](/en/admin/administration#audit-log), en anglais).

## Ensuite

- Créer et supprimer les comptes depuis le fournisseur dès qu'ils changent : le provisionnement
  SCIM, dans la même carte.
- Réserver certains projets à certaines personnes :
  [Restricted projects](/en/admin/administration#restricted-projects) (en anglais).
- Les pipelines : comptes de service et clés à portée limitée
  ([Votre première exécution depuis un pipeline](./devops)).
- Consommation et limites : [Quotas](/en/admin/administration#quotas) (en anglais).
