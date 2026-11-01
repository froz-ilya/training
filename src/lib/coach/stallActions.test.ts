import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/schema';
import { chooseStallAction, loadExerciseView, saveExerciseSettings, undoStallAction } from './data';

const ID = 'leg-press';
const view = async () => (await loadExerciseView(ID))!;
const setting = () => db.exerciseSettings.get(ID);

describe('undoing a plateau choice', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('removes the choice, so it can be made again', async () => {
    await chooseStallAction(await view(), 'frequency');
    const [record] = await db.stallRecords.toArray();
    await undoStallAction(await view(), record);
    expect(await db.stallRecords.count()).toBe(0);
    await chooseStallAction(await view(), 'frequency');
    expect(await db.stallRecords.count()).toBe(1);
  });

  it('puts the user’s own rep range back', async () => {
    await saveExerciseSettings(ID, { repLow: 6, repHigh: 9 });
    await chooseStallAction(await view(), 'repRange');
    expect((await setting())?.repLow).not.toBe(6);
    const [record] = await db.stallRecords.toArray();
    await undoStallAction(await view(), record);
    expect(await setting()).toMatchObject({ repLow: 6, repHigh: 9 });
  });

  it('puts the goal back', async () => {
    await saveExerciseSettings(ID, { goal: 'progress' });
    await chooseStallAction(await view(), 'maintain');
    expect((await setting())?.goal).toBe('maintain');
    const [record] = await db.stallRecords.toArray();
    await undoStallAction(await view(), record);
    expect((await setting())?.goal).toBe('progress');
  });

  it('goes back to the default for a record that never saved what it replaced', async () => {
    await saveExerciseSettings(ID, { repLow: 12, repHigh: 15 });
    const record = { id: 'old', exerciseId: ID, action: 'repRange' as const, date: '2031-01-05' };
    await db.stallRecords.add(record);
    await undoStallAction(await view(), record);
    expect(await db.stallRecords.count()).toBe(0);
    expect((await setting())?.repLow).toBeUndefined();
    expect((await setting())?.repHigh).toBeUndefined();
  });
});
