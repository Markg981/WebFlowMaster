# Conversations et tableaux de bord

## Discuter d'un test ou d'un résultat

Ouvrez **Commentaires** sur un test web, API ou mobile enregistré, ou sur le résultat d'un test dans
un rapport. Les membres, lecteurs compris, peuvent participer dès qu'ils peuvent lire cette cible.
Les conversations appartiennent à l'organisation courante et suivent les autorisations du projet de
la cible.

Écrivez un **Nouveau commentaire** pour démarrer une conversation, ou choisissez **Répondre** sur
une conversation ouverte. Les réponses restent sous le message d'origine ; il n'y a qu'un niveau de
réponses. Les messages sont en texte brut, jusqu'à 5 000 caractères.

Dépliez **Mentionner des membres** et sélectionnez les personnes que vous voulez mentionner,
jusqu'à 20 par message. La liste contient les membres de cette organisation qui peuvent lire le
test ou le résultat. Leurs noms d'utilisateur apparaissent à côté du message. Taper un nom
d'utilisateur seul ne sélectionne pas de mention. En modifiant un message, vous pouvez aussi
changer ses mentions.

Utilisez **Filtrer les conversations** pour afficher toutes les conversations, les conversations
ouvertes, les conversations résolues, ou celles **Où je suis mentionné**. Une mention dans une
réponse fait aussi apparaître sa conversation dans ce filtre. Les mentions sont visibles dans la
discussion et dans le filtre ; il n'y a ni boîte de réception séparée ni notification par e-mail.

L'auteur du message d'origine et les propriétaires de l'organisation peuvent **Résoudre la
conversation** ou **Rouvrir la conversation**. Une conversation résolue garde ses messages, mais
n'accepte de nouvelles réponses qu'après sa réouverture. Les auteurs peuvent modifier ou supprimer
leurs propres messages ; les propriétaires peuvent les modérer. Supprimer un message d'origine qui
a des réponses laisse l'indication **Ce commentaire a été supprimé** : son texte et ses mentions
disparaissent, tandis que les réponses des autres membres restent lisibles. Un message d'origine
supprimé n'accepte plus de réponses. Supprimer un test enregistré supprime les discussions sur ses
résultats passés tout en laissant les rapports disponibles.

## Choisir et partager des tableaux de bord

Sur **Tableau de bord**, sélectionnez le tableau de bord que vous voulez afficher. Vous pouvez en
créer plusieurs, les renommer, les dupliquer, les supprimer et choisir votre tableau par défaut. Un
duplicata est une copie privée que vous pouvez modifier indépendamment. Votre choix par défaut
s'applique à votre compte ; supprimer un tableau de bord efface les choix qui y faisaient
référence.

| Visibilité                  | Qui peut le lire                    | Qui peut le modifier ou le supprimer                |
| --------------------------- | ----------------------------------- | --------------------------------------------------- |
| Privé                       | Son créateur                        | Son créateur                                        |
| Partagé avec l'organisation | Les membres de la même organisation | Son créateur et les propriétaires de l'organisation |

Les propriétaires de l'organisation ne peuvent pas ouvrir le tableau de bord privé d'un autre
membre. Les autres membres peuvent dupliquer un tableau de bord partagé en copie privée. Partager un
tableau de bord partage sa configuration : chaque lecteur ne voit toujours que les données de tests
et de projets auxquelles il a accès. Un widget configuré pour un projet auquel le lecteur n'a pas
accès s'affiche comme indisponible, sans le nom ni les chiffres de ce projet.

Votre disposition personnelle existante devient un tableau de bord privé, avec l'ordre et la
visibilité des widgets. Les tableaux de bord appartiennent à leur créateur. Retirer ce membre
supprime ses tableaux privés et partagés ; les références des autres membres à ces tableaux sont
effacées. Dupliquez un tableau de bord partagé avant de retirer son créateur si vous devez le
conserver. Si vous n'avez aucune disposition enregistrée, votre premier tableau de bord privé
contient les cinq widgets d'origine : indicateurs, statut des exécutions, tendance, planifications à
venir et rapports récents.

## Modifier les widgets

Choisissez **Personnaliser le tableau de bord** sur un tableau de bord que vous pouvez gérer.
Ajoutez ou retirez des widgets, déplacez-les vers le haut ou le bas, affichez-les ou masquez-les,
et définissez leur titre et leur largeur, moitié ou pleine. Vous pouvez ajouter plusieurs fois le
même type de widget, par exemple pour comparer des projets ou des périodes. Un tableau de bord
contient au plus 20 widgets, widgets masqués compris.

Les options disponibles dépendent du widget :

- **ID du projet (facultatif)** limite les données à un projet accessible, par son identifiant
  numérique ; laissé vide, il utilise les données accessibles.
- **Période en jours** accepte de 1 à 365 jours.
- **Nombre maximal de résultats** accepte de 1 à 50 éléments pour les rapports récents ou les
  planifications.
- **Environnement** filtre les planifications à venir.

Enregistrez la disposition pour conserver les modifications d'une session à l'autre. Si quelqu'un
d'autre a enregistré ce tableau de bord depuis que vous avez ouvert l'éditeur, l'enregistrement
signale un conflit (HTTP 409) et garde votre brouillon. Rechargez la dernière version du tableau de
bord et appliquez à nouveau vos modifications ; le brouillon périmé ne peut pas écraser
l'enregistrement de l'autre personne.
