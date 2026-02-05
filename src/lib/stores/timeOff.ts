import { writable, derived } from 'svelte/store';
import { database } from '$lib/db/database';
import type { TimeOff } from '$lib/db/schema';

function createTimeOffStore() {
  const { subscribe, set, update } = writable<TimeOff[]>([]);

  return {
    subscribe,

    async load() {
      try {
        const result = await database.query<TimeOff>(
          'SELECT * FROM time_off ORDER BY date DESC'
        );
        set(result);
      } catch (error) {
        console.error('Failed to load time off:', error);
        set([]);
      }
    },

    async add(timeOff: Omit<TimeOff, 'id' | 'created_at'>) {
      try {
        // Check if date already exists
        const existing = await database.query<TimeOff>(
          'SELECT * FROM time_off WHERE date = ?',
          [timeOff.date]
        );

        if (existing.length > 0) {
          // Update existing
          await database.run(
            'UPDATE time_off SET type = ?, notes = ? WHERE date = ?',
            [timeOff.type, timeOff.notes, timeOff.date]
          );
        } else {
          // Insert new
          await database.run(
            'INSERT INTO time_off (date, type, notes) VALUES (?, ?, ?)',
            [timeOff.date, timeOff.type, timeOff.notes]
          );
        }

        await this.load();
      } catch (error) {
        console.error('Failed to add time off:', error);
        throw error;
      }
    },

    async remove(date: string) {
      try {
        await database.run('DELETE FROM time_off WHERE date = ?', [date]);
        update(items => items.filter(t => t.date !== date));
      } catch (error) {
        console.error('Failed to remove time off:', error);
        throw error;
      }
    },

    async removeById(id: number) {
      try {
        await database.run('DELETE FROM time_off WHERE id = ?', [id]);
        update(items => items.filter(t => t.id !== id));
      } catch (error) {
        console.error('Failed to remove time off:', error);
        throw error;
      }
    },

    async getByDateRange(startDate: string, endDate: string): Promise<TimeOff[]> {
      try {
        return await database.query<TimeOff>(
          'SELECT * FROM time_off WHERE date >= ? AND date <= ? ORDER BY date',
          [startDate, endDate]
        );
      } catch (error) {
        console.error('Failed to get time off by range:', error);
        return [];
      }
    },

    async getByType(type: 'vacation' | 'sick'): Promise<TimeOff[]> {
      try {
        return await database.query<TimeOff>(
          'SELECT * FROM time_off WHERE type = ? ORDER BY date DESC',
          [type]
        );
      } catch (error) {
        console.error('Failed to get time off by type:', error);
        return [];
      }
    },

    async getYearToDate(type: 'vacation' | 'sick'): Promise<TimeOff[]> {
      const startOfYear = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
      const today = new Date().toISOString().split('T')[0];
      try {
        return await database.query<TimeOff>(
          'SELECT * FROM time_off WHERE type = ? AND date >= ? AND date <= ? ORDER BY date DESC',
          [type, startOfYear, today]
        );
      } catch (error) {
        console.error('Failed to get YTD time off:', error);
        return [];
      }
    }
  };
}

export const timeOff = createTimeOffStore();

// Derived store for vacation days
export const vacationDays = derived(timeOff, ($timeOff) =>
  $timeOff.filter(t => t.type === 'vacation')
);

// Derived store for sick days
export const sickDays = derived(timeOff, ($timeOff) =>
  $timeOff.filter(t => t.type === 'sick')
);

// Get YTD counts
export const vacationDaysYTD = derived(timeOff, ($timeOff) => {
  const startOfYear = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
  return $timeOff.filter(t => t.type === 'vacation' && t.date >= startOfYear);
});

export const sickDaysYTD = derived(timeOff, ($timeOff) => {
  const startOfYear = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
  return $timeOff.filter(t => t.type === 'sick' && t.date >= startOfYear);
});
