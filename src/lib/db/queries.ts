import { database } from './database';
import type { User, RatedJob, Entry, StatHolidayRecord } from './schema';

// User queries
export const userQueries = {
  async get(): Promise<User | null> {
    const results = await database.query<User>('SELECT * FROM user LIMIT 1');
    return results[0] || null;
  },

  async create(user: Omit<User, 'id' | 'created_at'>): Promise<number> {
    const result = await database.run(
      `INSERT INTO user (last_name, first_name, man_number, current_board, file_number, work_pin, day_rate, afternoon_rate, graveyard_rate, average_hours_target, pension_target, career_hours, gemini_api_key, anthropic_api_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.last_name,
        user.first_name,
        user.man_number,
        user.current_board,
        user.file_number,
        user.work_pin,
        user.day_rate,
        user.afternoon_rate,
        user.graveyard_rate,
        user.average_hours_target,
        user.pension_target,
        user.career_hours,
        user.gemini_api_key,
        user.anthropic_api_key
      ]
    );
    return result.lastId;
  },

  async update(user: Partial<User> & { id: number }): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (user.last_name !== undefined) {
      fields.push('last_name = ?');
      values.push(user.last_name);
    }
    if (user.first_name !== undefined) {
      fields.push('first_name = ?');
      values.push(user.first_name);
    }
    if (user.man_number !== undefined) {
      fields.push('man_number = ?');
      values.push(user.man_number);
    }
    if (user.current_board !== undefined) {
      fields.push('current_board = ?');
      values.push(user.current_board);
    }
    if (user.file_number !== undefined) {
      fields.push('file_number = ?');
      values.push(user.file_number);
    }
    if (user.work_pin !== undefined) {
      fields.push('work_pin = ?');
      values.push(user.work_pin);
    }
    if (user.day_rate !== undefined) {
      fields.push('day_rate = ?');
      values.push(user.day_rate);
    }
    if (user.afternoon_rate !== undefined) {
      fields.push('afternoon_rate = ?');
      values.push(user.afternoon_rate);
    }
    if (user.graveyard_rate !== undefined) {
      fields.push('graveyard_rate = ?');
      values.push(user.graveyard_rate);
    }
    if (user.average_hours_target !== undefined) {
      fields.push('average_hours_target = ?');
      values.push(user.average_hours_target);
    }
    if (user.pension_target !== undefined) {
      fields.push('pension_target = ?');
      values.push(user.pension_target);
    }
    if (user.career_hours !== undefined) {
      fields.push('career_hours = ?');
      values.push(user.career_hours);
    }
    if (user.gemini_api_key !== undefined) {
      fields.push('gemini_api_key = ?');
      values.push(user.gemini_api_key);
    }
    if (user.anthropic_api_key !== undefined) {
      fields.push('anthropic_api_key = ?');
      values.push(user.anthropic_api_key);
    }

    if (fields.length > 0) {
      values.push(user.id);
      await database.run(
        `UPDATE user SET ${fields.join(', ')} WHERE id = ?`,
        values
      );
    }
  }
};

// Rated jobs queries
export const ratedJobQueries = {
  async getAll(): Promise<RatedJob[]> {
    const results = await database.query<RatedJob>('SELECT * FROM rated_jobs ORDER BY name');
    return results.map(job => ({
      ...job,
      has_extra_hour: Boolean(job.has_extra_hour),
      is_big_hour: Boolean(job.is_big_hour),
      has_meal_hour: Boolean(job.has_meal_hour)
    }));
  },

  async getById(id: number): Promise<RatedJob | null> {
    const results = await database.query<RatedJob>(
      'SELECT * FROM rated_jobs WHERE id = ?',
      [id]
    );
    if (!results[0]) return null;
    return {
      ...results[0],
      has_extra_hour: Boolean(results[0].has_extra_hour),
      is_big_hour: Boolean(results[0].is_big_hour),
      has_meal_hour: Boolean(results[0].has_meal_hour)
    };
  },

  async create(job: Omit<RatedJob, 'id' | 'created_at'>): Promise<number> {
    const result = await database.run(
      `INSERT INTO rated_jobs (name, has_extra_hour, is_big_hour, has_meal_hour)
       VALUES (?, ?, ?, ?)`,
      [job.name, job.has_extra_hour ? 1 : 0, job.is_big_hour ? 1 : 0, job.has_meal_hour ? 1 : 0]
    );
    return result.lastId;
  },

  async update(job: Partial<RatedJob> & { id: number }): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (job.name !== undefined) {
      fields.push('name = ?');
      values.push(job.name);
    }
    if (job.has_extra_hour !== undefined) {
      fields.push('has_extra_hour = ?');
      values.push(job.has_extra_hour ? 1 : 0);
    }
    if (job.is_big_hour !== undefined) {
      fields.push('is_big_hour = ?');
      values.push(job.is_big_hour ? 1 : 0);
    }
    if (job.has_meal_hour !== undefined) {
      fields.push('has_meal_hour = ?');
      values.push(job.has_meal_hour ? 1 : 0);
    }

    if (fields.length > 0) {
      values.push(job.id);
      await database.run(
        `UPDATE rated_jobs SET ${fields.join(', ')} WHERE id = ?`,
        values
      );
    }
  },

  async delete(id: number): Promise<void> {
    await database.run('DELETE FROM rated_jobs WHERE id = ?', [id]);
  }
};

// Entries queries
export const entryQueries = {
  async getAll(): Promise<Entry[]> {
    const results = await database.query<Entry>(
      'SELECT * FROM entries ORDER BY date DESC'
    );
    return results;
  },

  async getById(id: number): Promise<Entry | null> {
    const results = await database.query<Entry>(
      'SELECT * FROM entries WHERE id = ?',
      [id]
    );
    return results[0] || null;
  },

  async getByDateRange(startDate: string, endDate: string): Promise<Entry[]> {
    const results = await database.query<Entry>(
      'SELECT * FROM entries WHERE date >= ? AND date <= ? ORDER BY date DESC',
      [startDate, endDate]
    );
    return results;
  },

  async create(entry: Omit<Entry, 'id' | 'created_at'>): Promise<number> {
    const result = await database.run(
      `INSERT INTO entries (date, shift_type, job_type, rated_job_id, hall_job_name, hours, location, ship, notes, earnings)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.date,
        entry.shift_type,
        entry.job_type,
        entry.rated_job_id,
        entry.hall_job_name,
        entry.hours,
        entry.location,
        entry.ship,
        entry.notes,
        entry.earnings
      ]
    );
    return result.lastId;
  },

  async update(entry: Partial<Entry> & { id: number }): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (entry.date !== undefined) {
      fields.push('date = ?');
      values.push(entry.date);
    }
    if (entry.shift_type !== undefined) {
      fields.push('shift_type = ?');
      values.push(entry.shift_type);
    }
    if (entry.job_type !== undefined) {
      fields.push('job_type = ?');
      values.push(entry.job_type);
    }
    if (entry.rated_job_id !== undefined) {
      fields.push('rated_job_id = ?');
      values.push(entry.rated_job_id);
    }
    if (entry.hall_job_name !== undefined) {
      fields.push('hall_job_name = ?');
      values.push(entry.hall_job_name);
    }
    if (entry.hours !== undefined) {
      fields.push('hours = ?');
      values.push(entry.hours);
    }
    if (entry.location !== undefined) {
      fields.push('location = ?');
      values.push(entry.location);
    }
    if (entry.ship !== undefined) {
      fields.push('ship = ?');
      values.push(entry.ship);
    }
    if (entry.notes !== undefined) {
      fields.push('notes = ?');
      values.push(entry.notes);
    }
    if (entry.earnings !== undefined) {
      fields.push('earnings = ?');
      values.push(entry.earnings);
    }

    if (fields.length > 0) {
      values.push(entry.id);
      await database.run(
        `UPDATE entries SET ${fields.join(', ')} WHERE id = ?`,
        values
      );
    }
  },

  async delete(id: number): Promise<void> {
    await database.run('DELETE FROM entries WHERE id = ?', [id]);
  },

  // Aggregate queries for stats
  async getTotalHours(startDate?: string, endDate?: string): Promise<number> {
    let query = 'SELECT SUM(hours) as total FROM entries';
    const values: string[] = [];

    if (startDate && endDate) {
      query += ' WHERE date >= ? AND date <= ?';
      values.push(startDate, endDate);
    }

    const results = await database.query<{ total: number }>(query, values);
    return results[0]?.total || 0;
  },

  async getTotalEarnings(startDate?: string, endDate?: string): Promise<number> {
    let query = 'SELECT SUM(earnings) as total FROM entries';
    const values: string[] = [];

    if (startDate && endDate) {
      query += ' WHERE date >= ? AND date <= ?';
      values.push(startDate, endDate);
    }

    const results = await database.query<{ total: number }>(query, values);
    return results[0]?.total || 0;
  },

  async getWorkDaysCount(startDate: string, endDate: string): Promise<number> {
    const results = await database.query<{ count: number }>(
      'SELECT COUNT(DISTINCT date) as count FROM entries WHERE date >= ? AND date <= ?',
      [startDate, endDate]
    );
    return results[0]?.count || 0;
  }
};

// Stat holidays queries
export const statHolidayQueries = {
  async getByYear(year: number): Promise<StatHolidayRecord[]> {
    const results = await database.query<StatHolidayRecord>(
      'SELECT * FROM stat_holidays WHERE year = ? ORDER BY date',
      [year]
    );
    return results;
  },

  async getAll(): Promise<StatHolidayRecord[]> {
    const results = await database.query<StatHolidayRecord>(
      'SELECT * FROM stat_holidays ORDER BY date'
    );
    return results;
  },

  async addMany(holidays: Omit<StatHolidayRecord, 'id' | 'created_at'>[]): Promise<void> {
    for (const holiday of holidays) {
      await database.run(
        `INSERT INTO stat_holidays (year, name, date, qualification_start, qualification_end, pay_date)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          holiday.year,
          holiday.name,
          holiday.date,
          holiday.qualification_start,
          holiday.qualification_end,
          holiday.pay_date
        ]
      );
    }
  },

  async deleteByYear(year: number): Promise<void> {
    await database.run('DELETE FROM stat_holidays WHERE year = ?', [year]);
  },

  async hasYear(year: number): Promise<boolean> {
    const results = await database.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM stat_holidays WHERE year = ?',
      [year]
    );
    return (results[0]?.count || 0) > 0;
  }
};
