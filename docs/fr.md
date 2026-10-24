# EcoTracker

Intégration non officielle, sans lien avec everHome. Elle lit un
**EcoTracker**, le lecteur optique everHome posé sur le port infrarouge d'un
compteur d'électricité, par son API locale : pas de cloud, pas de compte,
rien d'envoyé au lecteur sinon une lecture (`GET /v1/json`) toutes les
10 secondes.

**Jamais testé avec un vrai EcoTracker** : l'intégration a été écrite à partir
de la bibliothèque Python du fabricant (everhome-gmbh/ecotracker) et de la
description publiée de son API locale. Vos retours sont bienvenus.

## Ce que vous obtenez

Un appareil **EcoTracker** (ou **EcoTracker <numéro de série>** si le lecteur
en donne un), avec les valeurs que donne le compteur (un compteur n'en envoie
qu'une partie) :

| Fonction                                          | Nature                          | Champ du lecteur              |
| ------------------------------------------------- | ------------------------------- | ----------------------------- |
| Puissance nette (négative quand le foyer injecte) | capteur d'énergie, W            | `power`                       |
| Index de consommation                             | index d'énergie, kWh            | `energyCounterIn`             |
| Index de consommation, tarifs 1 et 2 (kWh)        | simple capteur                  | `energyCounterInT1`, `…T2`    |
| Index d'injection (kWh)                           | simple capteur                  | `energyCounterOut`            |
| Puissance nette, moyenne de la dernière minute    | simple capteur, W               | `powerAvg`                    |
| Puissance L1, L2, L3 (W)                          | simple capteur, sans historique | `powerPhase1` à `powerPhase3` |
| Signal Wi-Fi (dBm)                                | simple capteur, sans historique | `rssi` (s'il est donné)       |

- L'**index de consommation** alimente le suivi énergétique de Gladys, qui en
  tire la consommation et son coût. Il est publié chaque minute et vérifié
  d'abord : jamais 0 ; toute baisse, même d'1 Wh, ou un saut que le foyer
  n'a pas pu consommer (plus de 50 kW en moyenne) est **retenu** (la dernière
  valeur acceptée est renvoyée), gardé après un redémarrage et affiché dans
  l'état de l'intégration. Ni le temps ni la répétition ne le confirment.
- L'**injection** et les **tarifs** n'entrent jamais dans le suivi
  énergétique (l'injection serait facturée comme une consommation, les
  tarifs comptés deux fois) : simples capteurs.
- Le lecteur donne ses compteurs en Wh (description publiée de l'API et
  relevé réel) : ils sont convertis en kWh.
- Les puissances sont envoyées toutes les 10 secondes, seulement quand elles
  changent (et toutes les 10 minutes sinon). Elles ne sont pas envoyées :
  - quand le lecteur indique (champ `agePower`) que sa puissance a plus
    d'une minute ;
  - quand aucune valeur lue (puissances, compteurs) n'a bougé depuis
    15 minutes : le lecteur sert peut-être un vieux relevé (tête optique
    déplacée) ; un compteur au repos peut aussi le faire, l'état le dit ;
  - après un démarrage, tant que le relevé n'a pas bougé (une dizaine de
    secondes), sauf si `agePower` le dit récent : un relevé figé avant un
    redémarrage n'est pas envoyé comme neuf.

  L'index continue dans tous ces cas.

- Quand le compteur donne plus tard de nouvelles valeurs (compteur débloqué
  par son PIN), l'appareil reçoit de nouvelles fonctions : dans l'onglet
  **Découverte**, cliquez sur **Mettre à jour** sur l'appareil pour les
  ajouter (son historique est gardé).

## Installation

1. Installez l'EcoTracker sur votre compteur et connectez-le à votre Wi-Fi
   avec l'application everHome, comme l'explique le fabricant. Si
   l'application le propose, activez l'API locale du lecteur.
2. Trouvez son adresse IP (dans votre box ou l'application) et donnez-lui de
   préférence une adresse fixe dans votre box.
3. Dans Gladys, ouvrez l'intégration, saisissez cette adresse, enregistrez.
4. Dans l'onglet **Découverte**, créez l'appareil.

Si l'état indique que le compteur ne donne pas de puissance, il est sans
doute verrouillé par PIN : saisissez sur le compteur le PIN donné par votre
gestionnaire de réseau pour débloquer ses données étendues. Les index
continuent en attendant.

## Boutons

- **Tester la connexion** : lit le lecteur quand une lecture est due (jamais
  plus d'une toutes les 10 secondes), sinon donne la dernière lecture.
- **Accepter l'index retenu**, en deux clics, seulement si la valeur retenue
  est juste (nouveau compteur, longue coupure) :
  - le premier clic affiche le mouvement retenu (saut ou baisse) et
    n'accepte rien ;
  - le second clic, de 3 secondes à 5 minutes plus tard, prend cette valeur,
    plus ce que le compteur a pu mesurer entre les deux clics (au plus
    4,667 kWh) ;
  - si la valeur retenue a changé autrement entre les deux clics (autre
    sens, autre point de départ, saut plus grand), rien n'est pris :
    regardez l'état et recommencez.

  Un saut accepté est compté d'un coup comme consommation ; une baisse
  acceptée ne facture rien, la consommation repart de là. Enregistrer la
  configuration n'accepte jamais rien.

## Identité du lecteur

- Le lecteur réel connu ne donne pas de numéro de série dans sa réponse
  locale : l'appareil s'appelle alors **EcoTracker** (`ecotracker:reader`),
  et un autre lecteur qui répondrait à la même adresse ne peut pas en être
  distingué. L'état le rappelle ; la garde de l'index retient de toute façon
  le saut ou la baisse qu'il produirait.
- Si le lecteur donne un numéro de série (champ `serial`, lu par la
  bibliothèque du fabricant), l'appareil porte ce numéro et chaque réponse
  est vérifiée : un autre numéro à la même adresse a son propre appareil, ses
  valeurs ne vont jamais au précédent ; un numéro illisible n'est pas
  utilisé (état rouge, nouvel essai espacé).
- Une réponse sans numéro après un lecteur qui en donnait un n'est pas
  utilisée tant que l'appareil de ce lecteur existe : l'état le dit. Si vous
  avez remplacé le lecteur par un modèle sans numéro, supprimez l'ancien
  appareil dans Gladys : le nouveau lecteur aura son propre appareil.
- Passer d'un lecteur sans numéro à un lecteur avec numéro (par exemple
  après une mise à jour du lecteur) crée un nouvel appareil, sans
  l'historique de l'ancien.

## Limites

- Un lecteur par intégration.
- Un compteur illisible (texte, valeur négative, 0, hors bornes) n'est
  jamais utilisé : l'état le dit.
- Lecture seule : le lecteur ne reçoit aucune commande.

## Dépannage

L'état de l'intégration dit ce qui se passe : adresse manquante ou invalide,
lecteur injoignable ou réponse inattendue (nouvel essai après 10 s, doublé
jusqu'à 5 minutes), lecteur qui demande d'attendre (HTTP 429 ou 5xx :
lectures en pause de 1 minute à 6 heures, gardée après un redémarrage),
index retenu, valeurs anciennes. Pour regarder le lecteur vous-même, ouvrez
`http://<adresse>/v1/json` dans un navigateur sur le même réseau.
