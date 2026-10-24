// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys. Every text is a { en, fr } object. They never
// quote a text of the reader: only our own words, error codes and the values
// we checked (a serial number passed the strict pattern of
// src/ecotracker/model.js).
// -----------------------------------------------------------------------------

const seconds = (ms) => Math.max(1, Math.round(ms / 1000));
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));
const hours = (ms) => Math.max(1, Math.round(ms / 3_600_000));
export const delay = (ms) => {
  if (ms >= 2 * 3_600_000) return { en: `${hours(ms)} h`, fr: `${hours(ms)} h` };
  if (ms >= 60_000) return { en: `${minutes(ms)} min`, fr: `${minutes(ms)} min` };
  return { en: `${seconds(ms)} s`, fr: `${seconds(ms)} s` };
};

/** Our words for an error code of src/ecotracker/client.js (and `bad_serial` of src/app.js). */
const REASON = {
  timeout: { en: 'no answer', fr: 'pas de réponse' },
  unreachable: { en: 'unreachable', fr: 'injoignable' },
  http: { en: 'HTTP error', fr: 'erreur HTTP' },
  not_found: {
    en: 'no /v1/json page at this address (is it an EcoTracker? is its local API turned on?)',
    fr: 'pas de page /v1/json à cette adresse (est-ce bien un EcoTracker ? son API locale est-elle activée ?)',
  },
  server: { en: 'error of the reader', fr: 'erreur du lecteur' },
  rate_limited: { en: 'too many requests', fr: 'trop de requêtes' },
  too_large: { en: 'answer too large', fr: 'réponse trop grande' },
  not_data: { en: 'answer that is not data', fr: 'réponse qui n’est pas une donnée' },
  unknown_answer: {
    en: 'not an EcoTracker answer',
    fr: 'ce n’est pas une réponse d’un EcoTracker',
  },
  bad_serial: {
    en: 'the answer carries a serial number that cannot be read: its values are not used',
    fr: 'la réponse porte un numéro de série illisible : ses valeurs ne sont pas utilisées',
  },
};

export function reason(err) {
  const text = REASON[err?.code] ?? { en: 'unexpected error', fr: 'erreur inattendue' };
  const status =
    (err?.code === 'http' || err?.code === 'server') && Number.isInteger(err.status)
      ? ` ${err.status}`
      : '';
  return { en: `${text.en}${status}`, fr: `${text.fr}${status}` };
}

const kwh = (value) => Math.round(value * 1000) / 1000;

/** `ago` ms ago, or undefined for a read made by this click. */
const when = (ago) =>
  ago === undefined
    ? { en: 'Read now', fr: 'Lu à l’instant' }
    : { en: `Last read ${delay(ago).en} ago`, fr: `Dernière lecture il y a ${delay(ago).fr}` };

const join = (lang, first, notes) => [first[lang], ...notes.map((n) => n[lang])].join(' ');
const withNotes = (first, notes) => ({
  en: join('en', first, notes),
  fr: join('fr', first, notes),
});

const named = (serial) => (serial === undefined ? 'EcoTracker' : `EcoTracker ${serial}`);

/** The movement held, in words. */
const movement = ({ direction, from, to }) =>
  direction === 'down'
    ? {
        en: `a drop from ${kwh(from)} to ${kwh(to)} kWh`,
        fr: `une baisse de ${kwh(from)} à ${kwh(to)} kWh`,
      }
    : {
        en: `a jump from ${kwh(from)} to ${kwh(to)} kWh (${kwh(to - from)} kWh)`,
        fr: `un saut de ${kwh(from)} à ${kwh(to)} kWh (${kwh(to - from)} kWh)`,
      };

export const T = {
  incomplete: {
    en: 'Enter the address of your EcoTracker (its IP address on your network, e.g. 192.168.1.70).',
    fr: 'Saisissez l’adresse de votre EcoTracker (son adresse IP sur votre réseau, ex. 192.168.1.70).',
  },
  badAddress: {
    en: 'The reader address is not valid: enter an IP address or a host name, with an optional port (e.g. 192.168.1.70).',
    fr: 'L’adresse du lecteur n’est pas valide : saisissez une adresse IP ou un nom d’hôte, avec un port éventuel (ex. 192.168.1.70).',
  },
  /** `notes`: { en, fr } texts added after the failure (an index held back). */
  unreachable: (address, err, wait, notes = []) =>
    withNotes(
      {
        en: `The EcoTracker at ${address} could not be read (${reason(err).en}): new try in ${delay(wait).en}.`,
        fr: `L’EcoTracker à l’adresse ${address} n’a pas pu être lu (${reason(err).fr}) : nouvel essai dans ${delay(wait).fr}.`,
      },
      notes,
    ),
  /** HTTP 429 or 5xx: a pause, kept across restarts. */
  paused: (address, err, wait, notes = []) =>
    withNotes(
      {
        en: `The EcoTracker at ${address} asks to wait (${reason(err).en}): reads paused, new try in ${delay(wait).en}.`,
        fr: `L’EcoTracker à l’adresse ${address} demande d’attendre (${reason(err).fr}) : lectures en pause, nouvel essai dans ${delay(wait).fr}.`,
      },
      notes,
    ),
  noDevice: (serial, notes = []) =>
    withNotes(
      {
        en: `${named(serial)} found: create its device from the "Discover" tab to receive its values.`,
        fr: `${named(serial)} trouvé : créez son appareil depuis l’onglet « Découverte » pour recevoir ses valeurs.`,
      },
      notes,
    ),
  waiting: (address) => ({
    en: `Waiting for the first answer of the EcoTracker at ${address}.`,
    fr: `En attente de la première réponse de l’EcoTracker à l’adresse ${address}.`,
  }),
  /** `notes`: { en, fr } texts added after the connection message. */
  ok: (address, notes = []) =>
    withNotes(
      {
        en: `Connected to the EcoTracker (${address}).`,
        fr: `Connecté à l’EcoTracker (${address}).`,
      },
      notes,
    ),
  notes: {
    noSerial: {
      en: 'The reader gives no serial number: give it a fixed address in your router (DHCP reservation), it is needed. Another reader at this address could not always be told from it: a drop of the index, or a rise larger than the home could draw since the last accepted value (50 kW × hours without values), is held back; a smaller rise would be counted as consumption.',
      fr: 'Le lecteur ne donne pas de numéro de série : donnez-lui une adresse fixe dans votre box (réservation DHCP), c’est nécessaire. Un autre lecteur à cette adresse ne pourrait pas toujours en être distingué : une baisse de l’index, ou une hausse plus grande que ce que le foyer a pu consommer depuis la dernière valeur acceptée (50 kW × heures sans valeurs), est retenue ; une hausse plus petite serait comptée comme une consommation.',
    },
    shapeChanged: {
      en: 'After an outage, the reader answers with other fields than before: it may be another reader at this address. Nothing is sent until the fields come back. If it is the same reader (meter unlocked, update), click "Accept the held index" twice.',
      fr: 'Après une coupure, le lecteur répond avec d’autres champs qu’avant : ce peut être un autre lecteur à cette adresse. Rien n’est envoyé tant que les champs ne reviennent pas. Si c’est bien le même lecteur (compteur débloqué, mise à jour), cliquez deux fois sur « Accepter l’index retenu ».',
    },
    unitDoubt: (ratio) => ({
      en: `The consumption counter does not follow the power (it rose ${ratio.toPrecision(2)} times the energy the power gives): unit? The integration reads the counters in Wh, as the published API says; a reader in kWh would give an index 1000 times too small. The index is still sent.`,
      fr: `Le compteur de consommation ne suit pas la puissance (il a augmenté de ${ratio.toPrecision(2)} fois l’énergie donnée par la puissance) : unité ? L’intégration lit les compteurs en Wh, comme le dit l’API publiée ; un lecteur en kWh donnerait un index 1000 fois trop petit. L’index est quand même envoyé.`,
    }),
    tariffDoubt: {
      en: 'The tariff counters (T1 + T2) do not add up to the consumption counter: one of them may be in another unit.',
      fr: 'Les compteurs par tarif (T1 + T2) ne font pas le compteur de consommation : l’un d’eux est peut-être dans une autre unité.',
    },
    noPower: {
      en: 'The meter gives no power: it is probably PIN-locked (enter the PIN given by your grid operator on the meter to unlock its extended data). The indexes go on.',
      fr: 'Le compteur ne donne pas de puissance : il est sans doute verrouillé par PIN (saisissez sur le compteur le PIN donné par votre gestionnaire de réseau pour débloquer ses données étendues). Les index continuent.',
    },
    oldPower: (age) => ({
      en: `The reader says its power was measured ${delay(age).en} ago (optical head moved?): the live values are not sent.`,
      fr: `Le lecteur indique que sa puissance a été mesurée il y a ${delay(age).fr} (tête optique déplacée ?) : les valeurs instantanées ne sont pas envoyées.`,
    }),
    frozen: (age) => ({
      en: `The values of the reader have not changed for ${delay(age).en} (optical head moved, or a meter at rest): the live values are no longer sent; the index goes on.`,
      fr: `Les valeurs du lecteur n’ont pas changé depuis ${delay(age).fr} (tête optique déplacée, ou compteur au repos) : les valeurs instantanées ne sont plus envoyées ; l’index continue.`,
    }),
    notYetFresh: {
      en: 'The live values are sent once the reading is seen moving (a reading frozen before a restart is never sent as new).',
      fr: 'Les valeurs instantanées sont envoyées dès que le relevé bouge (un relevé figé avant un redémarrage n’est jamais envoyé comme neuf).',
    },
    noIndex: {
      en: 'The reader gives no usable consumption counter (energyCounterIn) right now: the consumption index waits for it.',
      fr: 'Le lecteur ne donne pas de compteur de consommation utilisable (energyCounterIn) en ce moment : l’index de consommation l’attend.',
    },
    otherReader: (serial) =>
      serial === null || serial === undefined
        ? {
            en: 'Another reader, without serial number, answers at this address: its values go to its own device, never to the previous one.',
            fr: 'Un autre lecteur, sans numéro de série, répond à cette adresse : ses valeurs vont à son propre appareil, jamais au précédent.',
          }
        : {
            en: `Another reader answers at this address (${serial}): its values go to its own device, never to the previous one.`,
            fr: `Un autre lecteur répond à cette adresse (${serial}) : ses valeurs vont à son propre appareil, jamais au précédent.`,
          },
    identityLost: (serial) => ({
      en: `The reader at this address no longer gives a serial number, while ${named(serial)} did: its values are not used (it may be another reader). If you replaced the reader with one without serial number, delete the device ${named(serial)} in Gladys: the new reader then gets its own device.`,
      fr: `Le lecteur à cette adresse ne donne plus de numéro de série, alors que ${named(serial)} en donnait un : ses valeurs ne sont pas utilisées (ce peut être un autre lecteur). Si vous avez remplacé le lecteur par un modèle sans numéro de série, supprimez l’appareil ${named(serial)} dans Gladys : le nouveau lecteur aura alors son propre appareil.`,
    }),
    held: (held) => {
      const m = movement(held);
      if (held.direction === 'down') {
        return {
          en: `The consumption index shows ${m.en}: held back, the last accepted value is sent again. If the meter was really replaced, click "Accept the held index" twice in the configuration of the integration: nothing is billed for the drop, the consumption goes on from there. Saving the configuration accepts nothing.`,
          fr: `L’index de consommation montre ${m.fr} : retenue, la dernière valeur acceptée est renvoyée. Si le compteur a vraiment été remplacé, cliquez deux fois sur « Accepter l’index retenu » dans la configuration de l’intégration : rien n’est facturé pour la baisse, la consommation repart de là. Enregistrer la configuration n’accepte rien.`,
        };
      }
      return {
        en: `The consumption index shows ${m.en}: held back, not sent to the energy monitoring. If you click "Accept the held index" twice in the configuration of the integration, this energy will be counted at once as consumption; accept only if it was really consumed. Saving the configuration accepts nothing.`,
        fr: `L’index de consommation montre ${m.fr} : retenu, non envoyé au suivi énergétique. Si vous cliquez deux fois sur « Accepter l’index retenu » dans la configuration de l’intégration, cette énergie sera comptée d’un coup comme consommation ; n’acceptez que si elle a vraiment été consommée. Enregistrer la configuration n’accepte rien.`,
      };
    },
  },
  accept: {
    nothing: {
      en: 'No consumption index is held back: nothing to accept.',
      fr: 'Aucun index de consommation n’est retenu : rien à accepter.',
    },
    /** First click: what a second click would take, and the bound of what may come between. */
    confirm: (held, within, margin) => {
      const m = movement(held);
      return {
        en: `Held back: ${m.en}. Nothing is accepted yet: click "Accept the held index" again between 3 seconds and ${delay(within).en} from now to accept this value, plus what the meter may measure between the two clicks (at most ${kwh(margin)} kWh). A different movement stays held.`,
        fr: `Retenu : ${m.fr}. Rien n’est encore accepté : cliquez de nouveau sur « Accepter l’index retenu » entre 3 secondes et ${delay(within).fr} à partir de maintenant pour accepter cette valeur, plus ce que le compteur peut mesurer entre les deux clics (au plus ${kwh(margin)} kWh). Un autre mouvement reste retenu.`,
      };
    },
    done: ({ direction, from, to }) =>
      direction === 'down'
        ? {
            en: `Accepted: the index goes from ${kwh(from)} down to ${kwh(to)} kWh at the next read; 0 kWh is counted for the drop, the consumption goes on from there. A different value stays held.`,
            fr: `Accepté : l’index passe de ${kwh(from)} à ${kwh(to)} kWh à la prochaine lecture ; 0 kWh est compté pour la baisse, la consommation repart de là. Une autre valeur reste retenue.`,
          }
        : {
            en: `Accepted: the index ${kwh(to)} kWh will be sent at the next read, and ${kwh(to - from)} kWh (plus what the home uses meanwhile) will be counted at once as consumption. A different value stays held.`,
            fr: `Accepté : l’index ${kwh(to)} kWh sera envoyé à la prochaine lecture, et ${kwh(to - from)} kWh (plus ce que le foyer consomme d’ici là) seront comptés d’un coup comme consommation. Une autre valeur reste retenue.`,
          },
    confirmShape: (within) => ({
      en: `The reader answers with other fields than before the outage. Nothing is accepted yet: click "Accept the held index" again between 3 seconds and ${delay(within).en} from now if it is the same reader; its values are then sent again (the index still checked by its guard).`,
      fr: `Le lecteur répond avec d’autres champs qu’avant la coupure. Rien n’est encore accepté : cliquez de nouveau sur « Accepter l’index retenu » entre 3 secondes et ${delay(within).fr} à partir de maintenant si c’est bien le même lecteur ; ses valeurs sont alors de nouveau envoyées (l’index toujours vérifié par sa garde).`,
    }),
    shapeDone: {
      en: 'Accepted: the new fields of the reader are kept; its values are sent from the next read, the index still checked by its guard.',
      fr: 'Accepté : les nouveaux champs du lecteur sont gardés ; ses valeurs sont envoyées dès la prochaine lecture, l’index toujours vérifié par sa garde.',
    },
    changed: {
      en: 'Not accepted: the held value changed since the first click. Look at the status, then click "Accept the held index" again to list it.',
      fr: 'Non accepté : la valeur retenue a changé depuis le premier clic. Regardez l’état, puis cliquez de nouveau sur « Accepter l’index retenu » pour la lister.',
    },
  },
  test: {
    /** The outcome of a read, `ago` ms ago (undefined: made by this click), the next in `next` ms. */
    reading: ({ serial, power, index, held }, ago, next) => {
      const p = power === undefined ? '?' : `${Math.round(power)} W`;
      const i =
        index === undefined
          ? { en: '?', fr: '?' }
          : held
            ? { en: `${kwh(index)} kWh (held back)`, fr: `${kwh(index)} kWh (retenu)` }
            : { en: `${kwh(index)} kWh`, fr: `${kwh(index)} kWh` };
      return {
        en: `${when(ago).en}: ${named(serial)}, net power ${p}, consumption index ${i.en}.${next > 0 ? ` Next read in ${delay(next).en}.` : ''}`,
        fr: `${when(ago).fr} : ${named(serial)}, puissance nette ${p}, index de consommation ${i.fr}.${next > 0 ? ` Prochaine lecture dans ${delay(next).fr}.` : ''}`,
      };
    },
    failed: (address, err, ago, next) => ({
      en: `${when(ago).en}: the reader at ${address} could not be read (${reason(err).en}). Next read in ${delay(next).en}.`,
      fr: `${when(ago).fr} : le lecteur à l’adresse ${address} n’a pas pu être lu (${reason(err).fr}). Prochaine lecture dans ${delay(next).fr}.`,
    }),
    notYet: (next) => ({
      en: `No read yet with this configuration: the first one comes in ${delay(next).en} (never more than one every 10 s).`,
      fr: `Pas encore de lecture avec cette configuration : la première vient dans ${delay(next).fr} (jamais plus d’une toutes les 10 s).`,
    }),
    slow: {
      en: 'The reader is slow to answer: look at the integration status in a minute.',
      fr: 'Le lecteur tarde à répondre : regardez l’état de l’intégration dans une minute.',
    },
  },
};
