import type { Equipment, Exercise, Lang, Load, Muscle } from '../types';

/**
 * The exercise catalogue that ships with the app. Ids are permanent: stored sets point at them,
 * so an id never changes and is never reused. Names and aliases can change freely.
 * src/lib/catalog/exercises.test.ts keeps the list consistent.
 */

interface Extras {
  load?: Load;
  compound?: boolean;
  aliases?: string[];
  levels?: boolean;
}

function ex(
  id: string,
  muscle: Muscle,
  equipment: Equipment,
  names: [en: string, de: string, ru: string],
  extras: Extras = {},
): Exercise {
  const { load = 'weight', compound = false, aliases, levels } = extras;
  return { id, muscle, equipment, load, compound, aliases, levels, names: { en: names[0], de: names[1], ru: names[2] } };
}

const COMPOUND = { compound: true };

export const CATALOG: Exercise[] = [
  // Chest
  ex('barbell-bench-press', 'chest', 'barbell', ['Barbell bench press', 'Bankdrücken mit Langhantel', 'Жим штанги лёжа'], {
    ...COMPOUND,
    aliases: ['жим штанги горизонтально', 'жим лежа', 'bench press', 'bankdrücken'],
  }),
  ex('incline-barbell-press', 'chest', 'barbell', ['Incline barbell press', 'Schrägbankdrücken mit Langhantel', 'Жим штанги на наклонной скамье'], {
    ...COMPOUND,
    aliases: ['жим штанги наклон', 'жим штанги на наклонной', 'incline bench press', 'schrägbankdrücken'],
  }),
  ex('decline-barbell-press', 'chest', 'barbell', ['Decline barbell press', 'Negativbankdrücken', 'Жим штанги с обратным наклоном'], COMPOUND),
  ex('dumbbell-bench-press', 'chest', 'dumbbell', ['Dumbbell bench press', 'Kurzhantel-Bankdrücken', 'Жим гантелей лёжа'], COMPOUND),
  ex('incline-dumbbell-press', 'chest', 'dumbbell', ['Incline dumbbell press', 'Kurzhantel-Schrägbankdrücken', 'Жим гантелей на наклонной скамье'], {
    ...COMPOUND,
    aliases: ['жим гантелей наклон', 'жим гантелей наклон скамья'],
  }),
  ex('machine-chest-press', 'chest', 'machine', ['Machine chest press', 'Brustpresse', 'Жим сидя в тренажёре на грудь'], {
    ...COMPOUND,
    aliases: ['жим сидя в блочном на грудь', 'жим в блочном на грудь', 'chest press', 'жим сидя в блочном'],
  }),
  ex('plate-loaded-chest-press', 'chest', 'machine', ['Plate-loaded chest press', 'Hammer-Brustpresse', 'Жим в хаммере на грудь'], {
    ...COMPOUND,
    aliases: ['жим хаммер', 'хаммер жим'],
  }),
  ex('plate-loaded-incline-press', 'chest', 'machine', ['Plate-loaded incline press', 'Hammer-Schrägbankpresse', 'Жим в хаммере под наклоном'], {
    ...COMPOUND,
    aliases: ['жим хаммер наклон'],
  }),
  ex('pec-deck', 'chest', 'machine', ['Pec deck', 'Butterfly-Maschine', 'Сведение рук в тренажёре'], {
    aliases: ['chest fly', 'бабочка', 'сведение локтей', 'сведение локтей в тренажере', 'pectoral', 'butterfly'],
  }),
  ex('dumbbell-fly', 'chest', 'dumbbell', ['Dumbbell fly', 'Fliegende mit Kurzhanteln', 'Разводка гантелей лёжа'], {
    aliases: ['разводка гантелей'],
  }),
  ex('incline-dumbbell-fly', 'chest', 'dumbbell', ['Incline dumbbell fly', 'Schrägbank-Fliegende', 'Разводка гантелей на наклонной скамье'], {
    aliases: ['разводки гантелей наклон', 'разводки гантелей наклон скамья'],
  }),
  ex('cable-crossover', 'chest', 'cable', ['Cable crossover', 'Kabelzug-Crossover', 'Сведение рук в кроссовере'], {
    aliases: ['кроссовер', 'сведение в кроссовере'],
  }),
  ex('dips', 'chest', 'bodyweight', ['Dips', 'Dips', 'Брусья'], {
    load: 'body',
    compound: true,
    aliases: ['отжимания на брусьях'],
  }),
  ex('push-up', 'chest', 'bodyweight', ['Push-up', 'Liegestütz', 'Отжимания от пола'], {
    load: 'body',
    compound: true,
    aliases: ['отжимания', 'отжимания от пола широким хватом', 'отжимания широким хватом'],
  }),
  ex('close-grip-push-up', 'triceps', 'bodyweight', ['Close-grip push-up', 'Enger Liegestütz', 'Отжимания узким упором'], {
    load: 'body',
    compound: true,
    aliases: ['отжимания от пола узкой постановкой', 'отжимания узкие', 'отжимания от пола узким хватом', 'отжимания узким хватом от пола', 'отжимания от пола хват узкий', 'отжимания трицепс', 'отжимания узким хватом'],
  }),
  ex('incline-push-up', 'chest', 'bodyweight', ['Incline push-up', 'Schrägliegestütz', 'Отжимания от опоры'], {
    load: 'body',
    compound: true,
    levels: true,
    aliases: ['отжимания от смита', 'отжимания от смита узким хватом'],
  }),

  // Back
  ex('pull-up', 'back', 'bodyweight', ['Pull-up', 'Klimmzug', 'Подтягивания прямым хватом'], {
    load: 'body',
    compound: true,
    aliases: ['подтягивания прямой хват', 'подтягивания прямой', 'подтягивания', 'подтягивания прямым'],
  }),
  ex('chin-up', 'back', 'bodyweight', ['Chin-up', 'Klimmzug im Untergriff', 'Подтягивания обратным хватом'], {
    load: 'body',
    compound: true,
    aliases: ['подтягивания обратный хват', 'подтягивания обратный', 'подтягивания обратным'],
  }),
  ex('neutral-grip-pull-up', 'back', 'bodyweight', ['Neutral-grip pull-up', 'Klimmzug im Neutralgriff', 'Подтягивания параллельным хватом'], {
    load: 'body',
    compound: true,
    aliases: ['подтягивания параллельный хват', 'подтягивания параллельный', 'подтягивания боковой хват'],
  }),
  ex('inverted-row', 'back', 'bodyweight', ['Inverted row', 'Umgekehrtes Rudern', 'Австралийские подтягивания'], {
    load: 'body',
    compound: true,
    levels: true,
    aliases: ['австралийские', 'австралийские подтягивания прямой хват', 'подтягивания австралийские', 'австралийские обратным', 'подтягивания австралийские обратным', 'австралийские прямым', 'австралийские прямым хватом', 'австралийские подтягивания прямой', 'австралийские подтягивания обратным хватом', 'австралийские подтягивания прямым хватом', 'подтягивания австралийские прямой хват', 'австралийские обратным хватом'],
  }),
  ex('trx-row', 'back', 'other', ['TRX row', 'TRX-Rudern', 'Тяга в петлях TRX'], {
    load: 'body',
    compound: true,
    aliases: ['трх подтягивания', 'подтягивания в петлях', 'подтягивания трх'],
  }),
  ex('lat-pulldown', 'back', 'cable', ['Lat pulldown', 'Latzug', 'Тяга верхнего блока'], {
    ...COMPOUND,
    aliases: ['вертикальная тяга', 'вертикальный блок', 'вертикальный блок широким', 'вертикальный блок прямой хват', 'вертикальный блок прямым', 'вертикальный блок широкий', 'вертикальная тяга широким', 'вертикальная тяга обычным'],
  }),
  ex('close-grip-pulldown', 'back', 'cable', ['Close-grip pulldown', 'Enger Latzug', 'Тяга верхнего блока узким хватом'], {
    ...COMPOUND,
    aliases: ['вертикальный блок узкой рукоятью', 'вертикальный блок узкий', 'тяга вертикального блока узкой рукоятью', 'вертикальный блок узкой'],
  }),
  ex('machine-pulldown', 'back', 'machine', ['Machine pulldown', 'Latzug-Maschine', 'Вертикальная тяга в хаммере'], {
    ...COMPOUND,
    aliases: ['тяга вертикального хаммера', 'вертикальный хаммер', 'рычажная тяга вертикально'],
  }),
  ex('selectorized-pulldown', 'back', 'machine', ['Lat pulldown machine', 'Latzug am Gerät', 'Тяга верхнего блока (тренажёр)'], {
    ...COMPOUND,
    aliases: ['пулдаун', 'тяга верхнего блока в тренажёре'],
  }),
  ex('neutral-grip-pulldown', 'back', 'cable', ['Neutral-grip pulldown', 'Latzug im Neutralgriff', 'Тяга верхнего блока нейтральным хватом'], {
    ...COMPOUND,
    aliases: ['вертикальный блок боковой', 'вертикальный блок боковой хват', 'вертикальная тяга боковой', 'вертикальная тяга боковым'],
  }),
  ex('underhand-pulldown', 'back', 'cable', ['Underhand pulldown', 'Latzug im Untergriff', 'Тяга верхнего блока обратным хватом'], {
    ...COMPOUND,
    aliases: ['вертикальный блок обратный хват', 'вертикальный блок обратным'],
  }),
  ex('straight-arm-pulldown', 'back', 'cable', ['Straight-arm pulldown', 'Überzüge am Kabelzug', 'Пуловер в блоке'], {
    aliases: ['пуловер'],
  }),
  ex('seated-cable-row', 'back', 'cable', ['Seated cable row', 'Rudern am Kabelzug', 'Горизонтальная тяга блока'], {
    ...COMPOUND,
    aliases: ['горизонтальный блок', 'горизонтальная тяга', 'горизонтальная тяга блока'],
  }),
  ex('chest-supported-row', 'back', 'machine', ['Chest-supported row', 'Rudern mit Brustauflage', 'Тяга блока с упором в грудь'], {
    ...COMPOUND,
    aliases: ['лоу роу блок'],
  }),
  ex('wide-cable-row', 'back', 'cable', ['Wide-grip cable row', 'Breites Rudern am Kabelzug', 'Горизонтальная тяга блока широким хватом'], COMPOUND),
  ex('neutral-grip-cable-row', 'back', 'cable', ['Neutral-grip cable row', 'Rudern am Kabelzug im Neutralgriff', 'Горизонтальная тяга блока нейтральным хватом'], {
    ...COMPOUND,
    aliases: ['горизонтальный блок боковой'],
  }),
  ex('close-grip-cable-row', 'back', 'cable', ['Close-grip cable row', 'Enges Rudern am Kabelzug', 'Горизонтальная тяга блока узким хватом'], COMPOUND),
  ex('upper-back-row', 'back', 'machine', ['Upper back row', 'Rudern für den oberen Rücken', 'Тяга на верх спины'], {
    ...COMPOUND,
    aliases: ['upper back'],
  }),
  ex('machine-row', 'back', 'machine', ['Machine row', 'Rudermaschine', 'Тяга в хаммере'], {
    ...COMPOUND,
    aliases: ['лоу роу хаммер', 'low row', 'горизонтальный хаммер', 'тяга горизонтального хаммера'],
  }),
  ex('barbell-row', 'back', 'barbell', ['Barbell row', 'Langhantelrudern', 'Тяга штанги в наклоне'], {
    ...COMPOUND,
    aliases: ['bent-over row', 'тяга штанги наклон', 'тяга штанги в наклоне прямым'],
  }),
  ex('dumbbell-row', 'back', 'dumbbell', ['Dumbbell row', 'Kurzhantelrudern', 'Тяга гантели в наклоне'], {
    ...COMPOUND,
    aliases: ['тяга гантелей наклон скамья', 'тяга гантелей наклон', 'тяга гантели', 'тяга гантелей', 'тяга гантелей на наклонной скамье'],
  }),
  ex('t-bar-row', 'back', 'barbell', ['T-bar row', 'T-Bar-Rudern', 'Тяга Т-грифа'], {
    ...COMPOUND,
    aliases: ['т-тяга', 'тяга т грифа'],
  }),
  ex('underhand-barbell-row', 'back', 'barbell', ['Underhand barbell row', 'Langhantelrudern im Untergriff', 'Тяга штанги в наклоне обратным хватом'], {
    ...COMPOUND,
    aliases: ['тяга штанги в наклоне обратным'],
  }),
  ex('deadlift', 'back', 'barbell', ['Deadlift', 'Kreuzheben', 'Становая тяга'], { ...COMPOUND, aliases: ['становая'] }),
  ex('romanian-deadlift', 'legs', 'barbell', ['Romanian deadlift', 'Rumänisches Kreuzheben', 'Румынская тяга'], {
    ...COMPOUND,
    aliases: ['мертвая тяга'],
  }),
  ex('back-extension', 'back', 'other', ['Back extension', 'Rückenstrecken', 'Гиперэкстензия'], {
    load: 'body',
    aliases: ['экстензии', 'экстензия', 'гиперэкстензии'],
  }),
  ex('shrug', 'back', 'dumbbell', ['Shrug', 'Schulterheben', 'Шраги'], { aliases: ['шраги с гантелями', 'шраги со штангой'] }),

  // Legs
  ex('barbell-squat', 'legs', 'barbell', ['Barbell squat', 'Kniebeuge mit Langhantel', 'Присед со штангой'], {
    ...COMPOUND,
    aliases: ['присед', 'приседания', 'приседания со штангой', 'squat', 'kniebeuge'],
  }),
  ex('smith-squat', 'legs', 'smith', ['Smith machine squat', 'Kniebeuge an der Multipresse', 'Присед в Смите'], {
    ...COMPOUND,
    aliases: ['присед смит', 'приседания в смите', 'присед в смите'],
  }),
  ex('front-squat', 'legs', 'barbell', ['Front squat', 'Frontkniebeuge', 'Фронтальный присед'], COMPOUND),
  ex('bodyweight-squat', 'legs', 'bodyweight', ['Bodyweight squat', 'Kniebeuge ohne Gewicht', 'Приседания без веса'], {
    load: 'body',
    compound: true,
    aliases: ['приседания на полу'],
  }),
  ex('plie-squat', 'legs', 'dumbbell', ['Plié squat', 'Plié-Kniebeuge', 'Присед плие'], {
    ...COMPOUND,
    aliases: ['плие'],
  }),
  ex('goblet-squat', 'legs', 'dumbbell', ['Goblet squat', 'Goblet-Kniebeuge', 'Гоблет-присед'], COMPOUND),
  ex('hack-squat', 'legs', 'machine', ['Hack squat', 'Hackenschmidt-Kniebeuge', 'Гакк-присед'], {
    ...COMPOUND,
    aliases: ['гакк', 'гак присед'],
  }),
  ex('leg-press', 'legs', 'machine', ['Leg press', 'Beinpresse', 'Жим ногами'], {
    ...COMPOUND,
    aliases: ['жим ногами блок'],
  }),
  ex('leg-press-narrow', 'legs', 'machine', ['Leg press, narrow stance', 'Beinpresse, enger Stand', 'Жим ногами, узкая постановка'], {
    ...COMPOUND,
    aliases: ['жим ногами блок ноги узко', 'жим ногами узко'],
  }),
  ex('plate-loaded-leg-press', 'legs', 'machine', ['Plate-loaded leg press', 'Hammer-Beinpresse', 'Жим ногами в хаммере'], {
    ...COMPOUND,
    aliases: ['жим ногами хаммер'],
  }),
  ex('single-leg-press', 'legs', 'machine', ['Single-leg press', 'Einbeinige Beinpresse', 'Жим одной ногой'], {
    ...COMPOUND,
    aliases: ['жим одной ногой блок'],
  }),
  ex('leg-extension', 'legs', 'machine', ['Leg extension', 'Beinstrecker', 'Разгибание ног сидя'], {
    aliases: ['разгибание ног'],
  }),
  ex('lying-leg-curl', 'legs', 'machine', ['Lying leg curl', 'Beinbeuger liegend', 'Сгибание ног лёжа'], {
    aliases: ['сгибание ног'],
  }),
  ex('seated-leg-curl', 'legs', 'machine', ['Seated leg curl', 'Beinbeuger sitzend', 'Сгибание ног сидя']),
  ex('bulgarian-split-squat', 'legs', 'dumbbell', ['Bulgarian split squat', 'Bulgarische Kniebeuge', 'Болгарские выпады'], {
    load: 'body',
    compound: true,
    aliases: ['болгарские выпады от смита', 'болгарские приседания', 'выпады болгарские от смита'],
  }),
  ex('lunge', 'legs', 'dumbbell', ['Lunge', 'Ausfallschritt', 'Выпады'], { load: 'body', compound: true, aliases: ['выпады с гантелями'] }),
  ex('smith-lunge', 'legs', 'smith', ['Smith machine lunge', 'Ausfallschritt an der Multipresse', 'Выпады в Смите'], {
    ...COMPOUND,
    aliases: ['выпады смит'],
  }),
  ex('pistol-squat', 'legs', 'bodyweight', ['Pistol squat', 'Pistol Squat', 'Присед на одной ноге'], {
    load: 'body',
    compound: true,
    aliases: ['пистолетик', 'пистолетик на каждую ногу', 'пистолет'],
  }),
  ex('wall-sit', 'legs', 'bodyweight', ['Wall sit', 'Wandsitzen', 'Стульчик у стены'], {
    load: 'time',
    aliases: ['стульчик', 'стульчик у стенки'],
  }),
  ex('step-up', 'legs', 'dumbbell', ['Step-up', 'Aufsteiger', 'Заступы на степ'], {
    load: 'body',
    compound: true,
    aliases: ['заступы', 'заступы на тумбу', 'заступы на тумбу одной ногой'],
  }),
  ex('hip-thrust', 'glutes', 'barbell', ['Hip thrust', 'Hüftstoßen', 'Ягодичный мост'], {
    ...COMPOUND,
    aliases: ['мост'],
  }),
  ex('hip-adductor', 'legs', 'machine', ['Hip adductor machine', 'Adduktorenmaschine', 'Сведение ног в тренажёре'], {
    aliases: ['adductor', 'сведение ног сидя', 'сведение ног'],
  }),
  ex('hip-abductor', 'glutes', 'machine', ['Hip abductor machine', 'Abduktorenmaschine', 'Разведение ног в тренажёре'], {
    aliases: ['abductor', 'разведение ног сидя', 'разведение ног'],
  }),
  ex('standing-calf-raise', 'calves', 'machine', ['Standing calf raise', 'Wadenheben stehend', 'Подъём на носки стоя'], {
    aliases: ['икры блок', 'икры в блочном', 'икры', 'calf raise'],
  }),
  ex('smith-calf-raise', 'calves', 'smith', ['Smith machine calf raise', 'Wadenheben an der Multipresse', 'Подъём на носки в Смите'], {
    aliases: ['икры смит', 'икры в смите'],
  }),
  ex('seated-calf-raise', 'calves', 'machine', ['Seated calf raise', 'Wadenheben sitzend', 'Подъём на носки сидя'], {
    aliases: ['икры сидя'],
  }),
  ex('single-leg-calf-raise', 'calves', 'machine', ['Single-leg calf raise', 'Einbeiniges Wadenheben', 'Подъём на носок одной ногой'], {
    aliases: ['икры одной ногой', 'икры блок одной ногой', 'икры в блочном одной ногой', 'икры стоя на одной ноге', 'икры на одной ноге', 'икры одной ногой с гантелью', 'икры одной ногой в блочном'],
  }),

  // Shoulders
  ex('overhead-press', 'shoulders', 'barbell', ['Overhead press', 'Schulterdrücken mit Langhantel', 'Армейский жим'], {
    ...COMPOUND,
    aliases: ['жим штанги стоя', 'жим штанги на плечи'],
  }),
  ex('dumbbell-shoulder-press', 'shoulders', 'dumbbell', ['Dumbbell shoulder press', 'Kurzhantel-Schulterdrücken', 'Жим гантелей сидя на плечи'], {
    ...COMPOUND,
    aliases: ['жим гантелей на плечи', 'жим гантелей сидя'],
  }),
  ex('machine-shoulder-press', 'shoulders', 'machine', ['Machine shoulder press', 'Schulterpresse', 'Жим в тренажёре на плечи'], {
    ...COMPOUND,
    aliases: ['жим в блочном на плечи', 'shoulder press'],
  }),
  ex('smith-shoulder-press', 'shoulders', 'smith', ['Smith machine shoulder press', 'Schulterdrücken an der Multipresse', 'Жим в Смите на плечи'], {
    ...COMPOUND,
    aliases: ['жим в смите сидя на плечи', 'жим сидя в смите на плечи'],
  }),
  ex('plate-front-raise', 'shoulders', 'other', ['Plate front raise', 'Frontheben mit Hantelscheibe', 'Подъём блина перед собой'], {
    aliases: ['подъем блина', 'подъем блина стоя на плечи', 'подъем блина у стенки', 'блин', 'блин на плечи'],
  }),
  ex('lateral-raise', 'shoulders', 'dumbbell', ['Lateral raise', 'Seitheben', 'Махи гантелей в стороны'], {
    aliases: ['махи гантелей стоя', 'махи гантелей', 'махи в стороны', 'махи гантелей стоя на плечи', 'махи гантелей на плечи'],
  }),
  ex('machine-lateral-raise', 'shoulders', 'machine', ['Machine lateral raise', 'Seitheben an der Maschine', 'Отведение плеча в тренажёре'], {
    aliases: ['отведение плеча в тренажере', 'махи в тренажере'],
  }),
  ex('cable-lateral-raise', 'shoulders', 'cable', ['Cable lateral raise', 'Seitheben am Kabelzug', 'Махи в сторону в блоке'], {
    aliases: ['махи в блоке'],
  }),
  ex('rear-delt-fly', 'shoulders', 'dumbbell', ['Rear delt fly', 'Vorgebeugtes Seitheben', 'Махи гантелей в наклоне'], {
    aliases: ['махи в наклоне', 'разводка в наклоне'],
  }),
  ex('reverse-pec-deck', 'shoulders', 'machine', ['Reverse pec deck', 'Reverse-Butterfly', 'Обратная бабочка']),
  ex('upright-row', 'shoulders', 'barbell', ['Upright row', 'Aufrechtes Rudern', 'Тяга штанги к подбородку'], {
    ...COMPOUND,
    aliases: ['тяга штанги на плечи'],
  }),
  ex('smith-upright-row', 'shoulders', 'smith', ['Smith machine upright row', 'Aufrechtes Rudern an der Multipresse', 'Тяга в Смите на плечи'], {
    ...COMPOUND,
    aliases: ['тяга штанги в смите на плечи', 'тяга в смите на плечи', 'тяга штанги на плечи в смите'],
  }),
  ex('face-pull', 'shoulders', 'cable', ['Face pull', 'Face Pulls', 'Тяга к лицу'], { aliases: ['фейс пул'] }),

  // Biceps
  ex('barbell-curl', 'biceps', 'barbell', ['Barbell curl', 'Langhantelcurls', 'Подъём штанги на бицепс'], {
    aliases: ['штанга на бицепс стоя', 'штанга стоя на бицепс', 'штанга стоя прямая', 'штанга на бицепс', 'штанга бицепс', 'штанга на бицепс стоя прямая'],
  }),
  ex('dumbbell-curl', 'biceps', 'dumbbell', ['Dumbbell curl', 'Kurzhantelcurls', 'Подъём гантелей на бицепс'], {
    aliases: ['гантели бицепс сидя', 'гантели на бицепс', 'гантели бицепс', 'гантели бицепс стоя', 'гантели на бицепс сидя', 'гантели на бицепс стоя'],
  }),
  ex('incline-dumbbell-curl', 'biceps', 'dumbbell', ['Incline dumbbell curl', 'Schrägbank-Curls', 'Подъём гантелей на наклонной скамье'], {
    aliases: ['гантели бицепс наклон', 'гантели на бицепс наклон'],
  }),
  ex('hammer-curl', 'biceps', 'dumbbell', ['Hammer curl', 'Hammercurls', 'Молотки'], {
    aliases: ['гантели бицепс молотки', 'молотки гантели', 'молотки сидя'],
  }),
  ex('preacher-curl', 'biceps', 'barbell', ['Preacher curl', 'Scott-Curls', 'Подъём на бицепс на скамье Скотта'], {
    aliases: ['скамья скотта'],
  }),
  ex('ez-bar-curl', 'biceps', 'barbell', ['EZ-bar curl', 'SZ-Curls', 'Подъём EZ-штанги на бицепс'], {
    aliases: ['штанга на бицепс стоя кривая', 'штанга на бицепс кривая', 'штанга кривая'],
  }),
  ex('machine-curl', 'biceps', 'machine', ['Machine curl', 'Bizepsmaschine', 'Сгибание рук в тренажёре'], {
    aliases: ['бицепс тренажер', 'тренажер на бицепс'],
  }),
  ex('cable-curl', 'biceps', 'cable', ['Cable curl', 'Bizepscurls am Kabelzug', 'Сгибание рук в блоке'], {
    aliases: ['бицепс блок', 'бицепс в блоке', 'подъем на бицепс в кроссовере', 'cable biceps curl'],
  }),
  ex('concentration-curl', 'biceps', 'dumbbell', ['Concentration curl', 'Konzentrationscurls', 'Концентрированный подъём на бицепс']),

  // Triceps
  ex('rope-pushdown', 'triceps', 'cable', ['Rope pushdown', 'Trizepsdrücken am Seil', 'Разгибание на трицепс с канатом'], {
    aliases: ['разгибание канатов на трицепс', 'разгибание канатов', 'канаты трицепс'],
  }),
  ex('cable-pushdown', 'triceps', 'cable', ['Cable pushdown', 'Trizepsdrücken am Kabelzug', 'Разгибание в блоке на трицепс'], {
    aliases: ['разгибание планки на трицепс', 'разгибание в блоке', 'трицепс блок', 'разгибание палки на трицепс'],
  }),
  ex('seated-dip-machine', 'triceps', 'machine', ['Seated dip machine', 'Dip-Maschine', 'Отжимания в тренажёре'], {
    ...COMPOUND,
  }),
  ex('skull-crusher', 'triceps', 'barbell', ['Skull crusher', 'French Press', 'Французский жим'], {
    aliases: ['французский жим лежа'],
  }),
  ex('overhead-triceps-extension', 'triceps', 'dumbbell', ['Overhead triceps extension', 'Trizepsstrecken über Kopf', 'Разгибание рук из-за головы'], {
    aliases: ['разгибание из-за головы'],
  }),
  ex('close-grip-bench-press', 'triceps', 'barbell', ['Close-grip bench press', 'Enges Bankdrücken', 'Жим штанги узким хватом'], {
    ...COMPOUND,
    aliases: ['жим узким хватом'],
  }),
  ex('bench-dip', 'triceps', 'bodyweight', ['Bench dip', 'Bankdips', 'Обратные отжимания'], {
    load: 'body',
    compound: true,
    aliases: ['отжимания от скамьи', 'отжимания обратные'],
  }),

  // Forearms
  ex('wrist-curl', 'forearms', 'dumbbell', ['Wrist curl', 'Unterarmcurls', 'Сгибание рук в запястьях'], {
    aliases: ['сгибание рук в запястьях гантели', 'сгибание запястий'],
  }),
  ex('reverse-wrist-curl', 'forearms', 'dumbbell', ['Reverse wrist curl', 'Umgekehrte Unterarmcurls', 'Разгибание рук в запястьях'], {
    aliases: ['разгибание рук в запястьях гантели'],
  }),
  ex('farmers-walk', 'forearms', 'dumbbell', ["Farmer's walk", 'Farmer’s Walk', 'Прогулка фермера'], { compound: true }),

  // Abs
  ex('crunch', 'abs', 'bodyweight', ['Crunch', 'Crunches', 'Скручивания'], {
    load: 'body',
    aliases: ['скручивания на полу', 'скручивания пол'],
  }),
  ex('plank-step-up', 'abs', 'bodyweight', ['Plank hand step-up', 'Stütz mit Händen auf die Stufe', 'Заступы на степ руками'], { load: 'body' }),
  ex('decline-crunch', 'abs', 'bodyweight', ['Decline crunch', 'Crunches auf der Schrägbank', 'Скручивания на наклонной скамье'], {
    load: 'body',
    aliases: ['скручивания на скамье', 'скручивания скамья', 'скамья пресс'],
  }),
  ex('cable-crunch', 'abs', 'cable', ['Cable crunch', 'Kabelzug-Crunches', 'Скручивания в блоке'], {
    aliases: ['скручивания блок', 'пресс блок'],
  }),
  ex('ab-machine', 'abs', 'machine', ['Ab machine', 'Bauchmaschine', 'Скручивания в тренажёре'], {
    aliases: ['хаммер пресс', 'пресс в тренажере', 'скручивания хаммер'],
  }),
  ex('oblique-machine', 'abs', 'machine', ['Oblique machine', 'Seitliche Bauchmaschine', 'Косые мышцы в тренажёре'], {
    aliases: ['хаммер пресс косые'],
  }),
  ex('hanging-leg-raise', 'abs', 'bodyweight', ['Hanging leg raise', 'Beinheben hängend', 'Подъём ног в висе'], {
    load: 'body',
    aliases: ['подъем ног на пресс на турнике', 'подъем ног в висе на турнике', 'подъем ног на турнике', 'подъем ног на пресс', 'подъем ног в висе на пресс', 'ноги на пресс в висе', 'ноги в висе на пресс', 'подъем ног прямых на пресс', 'ноги пресс на турнике', 'ноги пресс прямые'],
  }),
  ex('captains-chair-leg-raise', 'abs', 'bodyweight', ['Captain’s chair leg raise', 'Beinheben im Stütz', 'Подъём ног в упоре на локтях'], {
    load: 'body',
    aliases: ['подъем ног в висе на локтях', 'пресс в висе на локтях', 'подъем ног на пресс на локтях'],
  }),
  ex('dragon-flag', 'abs', 'bodyweight', ['Dragon flag', 'Dragon Flag', 'Флаг дракона'], {
    load: 'body',
    aliases: ['флаг дракона в динамике', 'флаг дракона динамика', 'флаг дракона с усложнением'],
  }),
  ex('dragon-flag-hold', 'abs', 'bodyweight', ['Dragon flag hold', 'Dragon Flag, statisch', 'Флаг дракона, статика'], {
    load: 'time',
    aliases: ['флаг дракона статика', 'флаг дракона в статике'],
  }),
  ex('v-up', 'abs', 'bodyweight', ['V-up', 'V-Ups', 'Книжка'], {
    load: 'body',
    aliases: ['книжка на пресс', 'книжка на полу'],
  }),
  ex('trx-knee-tuck', 'abs', 'other', ['TRX knee tuck', 'TRX-Knee-Tucks', 'Подтягивание коленей в петлях'], {
    load: 'body',
    aliases: ['петли пресс', 'петли пресс ноги прямые', 'петли трх', 'трх петли'],
  }),
  ex('mountain-climber', 'abs', 'bodyweight', ['Mountain climber', 'Bergsteiger', 'Подведение коленей из планки'], {
    load: 'body',
    aliases: ['подведение колен из планки'],
  }),
  ex('russian-twist', 'abs', 'bodyweight', ['Russian twist', 'Russian Twist', 'Русские скручивания'], { load: 'body' }),
  ex('plank', 'abs', 'bodyweight', ['Plank', 'Unterarmstütz', 'Планка на локтях'], { load: 'time', aliases: ['планка'] }),
  ex('high-plank', 'abs', 'bodyweight', ['High plank', 'Hoher Stütz', 'Планка на прямых руках'], { load: 'time' }),

  // Cardio and full body
  ex('treadmill', 'cardio', 'machine', ['Treadmill', 'Laufband', 'Беговая дорожка'], {
    load: 'time',
    aliases: ['беговая', 'беговая ходьба'],
  }),
  ex('elliptical', 'cardio', 'machine', ['Elliptical', 'Crosstrainer', 'Эллипс'], { load: 'time', aliases: ['элипс'] }),
  ex('exercise-bike', 'cardio', 'machine', ['Exercise bike', 'Ergometer', 'Велотренажёр'], { load: 'time' }),
  ex('rowing-machine', 'cardio', 'machine', ['Rowing machine', 'Rudergerät', 'Гребной тренажёр'], { load: 'time' }),
  ex('jumping-jack', 'cardio', 'bodyweight', ['Jumping jacks', 'Hampelmänner', 'Джампинг-джек'], {
    load: 'body',
    aliases: ['джампинги'],
  }),
  ex('burpee', 'fullBody', 'bodyweight', ['Burpee', 'Burpees', 'Бёрпи'], { load: 'body', compound: true }),
  ex('kettlebell-swing', 'fullBody', 'other', ['Kettlebell swing', 'Kettlebell Swing', 'Махи гирей'], { compound: true }),
  ex('clean-and-press', 'fullBody', 'barbell', ['Clean and press', 'Umsetzen und Drücken', 'Взятие на грудь и жим'], COMPOUND),
];

const byId = new Map(CATALOG.map((e) => [e.id, e]));

export function catalogExercise(id: string): Exercise | undefined {
  return byId.get(id);
}

export const MUSCLES: Muscle[] = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'legs',
  'glutes',
  'calves',
  'abs',
  'cardio',
  'fullBody',
];

/** Lower case, ё → е, no punctuation: how names are compared in search and import. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function exerciseName(exercise: Exercise, lang: Lang): string {
  return exercise.names[lang] || exercise.names.en || exercise.names.ru || exercise.names.de;
}

/** Every name of an exercise, in all languages, for search and matching. */
export function allNames(exercise: Exercise): string[] {
  return [...Object.values(exercise.names), ...(exercise.aliases ?? [])].filter(Boolean);
}

/** Exercises matching a search in any language, best matches first. */
export function searchExercises(list: Exercise[], query: string): Exercise[] {
  const words = normalizeName(query).split(' ').filter(Boolean);
  if (!words.length) return list;
  const scored: { exercise: Exercise; score: number }[] = [];
  for (const exercise of list) {
    let score = 0;
    for (const name of allNames(exercise).map(normalizeName)) {
      if (!words.every((w) => name.includes(w))) continue;
      score = Math.max(score, name.startsWith(words[0]) ? 2 : 1);
    }
    if (score) scored.push({ exercise, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.exercise);
}
