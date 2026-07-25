import { parseGoalSequence } from '@orchescope/domain';
import type { Goal } from '@orchescope/schema';
import type { Database } from '../database.ts';
import { text } from '../rows.ts';

/**
 * Improvement goals.
 *
 * Goal identifiers are sequential per project and readable, so the next sequence is derived from the stored identifiers
 * rather than from a row count.
 */

export const createGoalsRepository = (input: { readonly database: Database }) => {
  const { database } = input;

  const nextGoalSequence = (projectId: string): number => {
    const rows = database.all('SELECT id FROM goal WHERE project_id = ?', projectId);
    let highest = 0;
    for (const row of rows) {
      const sequence = parseGoalSequence(text(row, 'id'));
      if (sequence !== undefined && sequence > highest) highest = sequence;
    }
    return highest + 1;
  };

  const saveGoal = (goal: Goal, projectId: string): void => {
    database.run(
      `INSERT INTO goal (id, project_id, finding_id, title, status, risk, created_at, updated_at, json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status,
                                     updated_at = excluded.updated_at,
                                     json = excluded.json`,
      goal.id,
      projectId,
      goal.findingId,
      goal.title,
      goal.status,
      goal.risk,
      goal.createdAt,
      goal.updatedAt,
      JSON.stringify(goal),
    );
  };

  const goalById = (goalId: string): Goal | undefined => {
    const row = database.get('SELECT json FROM goal WHERE id = ?', goalId);
    return row === undefined ? undefined : (JSON.parse(text(row, 'json')) as Goal);
  };

  const listGoals = (projectId: string, status?: string): readonly Goal[] => {
    const rows =
      status === undefined
        ? database.all('SELECT json FROM goal WHERE project_id = ? ORDER BY id', projectId)
        : database.all(
            'SELECT json FROM goal WHERE project_id = ? AND status = ? ORDER BY id',
            projectId,
            status,
          );
    return rows.map((row) => JSON.parse(text(row, 'json')) as Goal);
  };

  return {
    nextGoalSequence,
    saveGoal,
    goalById,
    listGoals,
  };
};
