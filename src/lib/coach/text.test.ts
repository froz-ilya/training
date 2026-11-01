import { afterEach, describe, expect, it } from 'vitest';
import { setUiLang, t } from '../i18n.svelte';
import type { Exercise } from '../types';
import type { ExerciseStatus } from './status';
import type { Session } from './strength';
import { suggestSets, type Suggestion } from './suggest';
import { reasonText, statusText } from './text';

const press: Exercise = {
  id: 'press',
  names: { en: 'Press', de: 'Drücken', ru: 'Жим' },
  muscle: 'chest',
  equipment: 'barbell',
  load: 'weight',
  compound: true,
};
const dip: Exercise = { ...press, id: 'dip', equipment: 'bodyweight', load: 'body' };
const plank: Exercise = { ...press, id: 'plank', muscle: 'abs', equipment: 'bodyweight', load: 'time', compound: false };

const thisYear = new Date().getFullYear();
const on = (monthDay: string) => `${thisYear}-${monthDay}`;

function at(date: string, position: number, weightKg: number, reps: number, seconds?: number): Session {
  return { workoutId: date, date, position, sets: [{ kind: 'work', weightKg, reps, seconds }] };
}

const LAST_TIME = { en: /last time/, de: /[Ll]etzte[sn] Mal/, ru: /прошлый раз/ } as const;
const MARCH = { en: 'March', de: 'März', ru: 'марта' } as const;
const languages = ['en', 'de', 'ru'] as const;

/** Built on 2 March at the same position, while the latest session was at another. */
function fromEarlier(setting?: Parameters<typeof suggestSets>[2]['setting']): Suggestion {
  const history = [at(on('03-02'), 3, 50, 8), at(on('03-09'), 1, 60, 8)];
  return suggestSets(press, history, { today: on('03-12'), position: 3, setting })!;
}

describe('reason text', () => {
  afterEach(() => setUiLang('en'));

  describe.each(languages)('in %s', (lang) => {
    it('says last time for the latest session', () => {
      setUiLang(lang);
      const s = suggestSets(press, [at(on('03-09'), 1, 60, 8)], { today: on('03-12') })!;
      expect(reasonText(s)).toMatch(LAST_TIME[lang]);
    });

    it('names the date for an earlier session, keeping the same weight', () => {
      setUiLang(lang);
      const s = fromEarlier();
      expect(s.reason).toBe('moreReps');
      expect(s.weightKg).toBe(50);
      expect(reasonText(s)).not.toMatch(LAST_TIME[lang]);
      expect(reasonText(s)).toContain(MARCH[lang]);
    });

    it.each(['afterBreak', 'afterBreakReps', 'afterBreakTime', 'afterBreakSame'] as const)('names the date for %s built on an earlier session', (reason) => {
      setUiLang(lang);
      const params = { ...fromEarlier().params, days: 40, baseDate: on('03-02') };
      expect(reasonText({ ...fromEarlier(), reason, params })).toContain(MARCH[lang]);
    });

    it('says where a climb back is heading, with the date when built on an earlier session', () => {
      setUiLang(lang);
      const s = fromEarlier();
      const params = { ...s.params, before: { weightKg: 100, reps: 8 } };
      const climb = { ...s, reason: 'climbBack' as const, params };
      expect(reasonText(climb)).toContain('100');
      expect(reasonText(climb)).toContain(MARCH[lang]);
      expect(reasonText({ ...climb, params: { ...params, baseDate: undefined } })).not.toContain(MARCH[lang]);
    });

    it('adds what else a break changed as sentences of their own', () => {
      setUiLang(lang);
      const s = { ...fromEarlier(), reason: 'afterBreak' as const };
      const plain = reasonText(s);
      const full = reasonText({ ...s, params: { ...s.params, keptMuscle: 'chest' as const, fewerSets: true } });
      expect(full.startsWith(`${plain} `)).toBe(true);
      expect(full).toContain(t('exercises.muscle.chest'));
      expect(full.endsWith(t('coach.reason.fewerSets'))).toBe(true);
    });

    it('names the date when holding to a maintain goal', () => {
      setUiLang(lang);
      const s = fromEarlier({ exerciseId: 'press', goal: 'maintain' });
      expect(s.reason).toBe('maintain');
      expect(reasonText(s)).not.toMatch(LAST_TIME[lang]);
      expect(reasonText(s)).toContain(MARCH[lang]);
    });

    it('names the date when comparing the place in the workout', () => {
      setUiLang(lang);
      const history = [at(on('03-02'), 2, 60, 10), at(on('03-05'), 5, 40, 10), at(on('03-09'), 5, 40, 10)];
      const s = suggestSets(press, history, { today: on('03-12'), position: 3 })!;
      expect(s.reason).toBe('laterInWorkout');
      expect(reasonText(s)).not.toMatch(LAST_TIME[lang]);
      expect(reasonText(s)).toContain(MARCH[lang]);
    });

    it('names the date for a timed exercise', () => {
      setUiLang(lang);
      const history = [at(on('03-02'), 3, 0, 0, 60), at(on('03-09'), 1, 0, 0, 90)];
      const s = suggestSets(plank, history, { today: on('03-12'), position: 3 })!;
      expect(s.reason).toBe('moreTime');
      expect(reasonText(s)).toContain(MARCH[lang]);
      expect(reasonText(s)).toContain('1:05');
    });
  });

  it('adds the year only when it is another one', () => {
    const s = fromEarlier();
    expect(reasonText({ ...s, params: { ...s.params, baseDate: '2020-03-02' } })).toContain('2020');
    expect(reasonText(s)).not.toContain(String(thisYear));
  });

  it('shows added weight as added weight', () => {
    const s = suggestSets(dip, [at(on('03-09'), 1, 10, 8)], { today: on('03-12') })!;
    expect(reasonText(s)).toContain('+10 kg × 8');
  });

  it('never says lighter when the weight stayed', () => {
    const s = suggestSets(dip, [at('2026-02-01', 1, 0, 12)], { today: '2026-02-17' })!;
    expect(s.weightKg).toBe(0);
    expect(reasonText(s)).toBe('16 days since last time, so fewer reps to start.');
  });

  it('talks about time, not reps, on a timed exercise', () => {
    const logged = at(on('03-09'), 1, 0, 1, 60);
    const later = suggestSets(plank, [logged], { today: on('03-12'), position: 2 })!;
    expect(later.reason).toBe('laterInWorkout');
    expect(reasonText(later)).toBe('Later in the workout than last time, so less time is normal.');
    const back = suggestSets(plank, [at('2026-02-01', 1, 0, 0, 60)], { today: '2026-06-01' })!;
    expect(reasonText(back)).toContain('less time');
  });

  it('keeps fewer reps for exercises with reps', () => {
    const s = suggestSets(press, [at(on('03-09'), 1, 60, 10)], { today: on('03-12'), position: 2 })!;
    expect(reasonText(s)).toBe('Later in the workout than last time, so fewer reps is normal.');
  });
});

describe('status text', () => {
  afterEach(() => setUiLang('en'));

  const status: ExerciseStatus = { state: 'returning', best: 0, bestDate: null, sessionsSinceBest: 0, weeksSinceBest: 0, daysSinceLast: null, maybeMachineChange: false };
  const restarted = { ...status, restartedOn: on('03-02') };

  it.each(languages)('explains a restarted comparison in %s', (lang) => {
    setUiLang(lang);
    expect(statusText(restarted, 0)).toContain(MARCH[lang]);
    expect(statusText(restarted, 2)).toContain(MARCH[lang]);
    expect(statusText(restarted, 2)).not.toBe(statusText(restarted, 0));
  });

  it('says when suggestions start, and otherwise why there is no trend yet', () => {
    expect(statusText(restarted, 0)).toContain('next session');
    expect(statusText(restarted, 2)).toContain('Too few sessions');
  });

  it('says what the progress really was, in every language', () => {
    const progressing: ExerciseStatus = { ...status, state: 'progressing' };
    const texts = { en: /top set/, de: /stärkster Satz/, ru: /лучший подход/ } as const;
    const back = { en: /towards your best/, de: /Bestwert/, ru: /рекорду/ } as const;
    for (const lang of languages) {
      setUiLang(lang);
      expect(statusText({ ...progressing, acrossSets: true }, 3)).toMatch(texts[lang]);
      expect(statusText({ ...progressing, buildingBack: true }, 3)).toMatch(back[lang]);
    }
    setUiLang('en');
    expect(statusText(progressing, 3)).toContain('A new best');
  });

  it('uses the usual text otherwise', () => {
    expect(statusText(status, 3)).toContain('You had a break');
  });
});
