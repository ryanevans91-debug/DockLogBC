import { database } from './database';

// SQL schema for DockLogger database
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS user (
  id INTEGER PRIMARY KEY,
  last_name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  man_number TEXT NOT NULL,
  current_board TEXT,
  file_number TEXT,
  work_pin TEXT,
  day_rate REAL,
  afternoon_rate REAL,
  graveyard_rate REAL,
  average_hours_target INTEGER DEFAULT 600,
  pension_target REAL,
  career_hours REAL DEFAULT 0,
  gemini_api_key TEXT,
  anthropic_api_key TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rated_jobs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  has_extra_hour INTEGER DEFAULT 0,
  is_big_hour INTEGER DEFAULT 0,
  has_meal_hour INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  shift_type TEXT NOT NULL,
  job_type TEXT NOT NULL,
  rated_job_id INTEGER,
  hall_job_name TEXT,
  hours REAL NOT NULL,
  location TEXT,
  ship TEXT,
  notes TEXT,
  earnings REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rated_job_id) REFERENCES rated_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  category TEXT,
  extracted_data TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);

CREATE TABLE IF NOT EXISTS share_groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  identifier TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS time_off (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_time_off_date ON time_off(date);
CREATE INDEX IF NOT EXISTS idx_time_off_type ON time_off(type);

CREATE TABLE IF NOT EXISTS period_summaries (
  id INTEGER PRIMARY KEY,
  period_type TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  total_hours REAL NOT NULL,
  total_earnings REAL NOT NULL,
  days_worked INTEGER NOT NULL,
  summary_data TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stat_holidays (
  id INTEGER PRIMARY KEY,
  year INTEGER NOT NULL,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  qualification_start TEXT NOT NULL,
  qualification_end TEXT NOT NULL,
  pay_date TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stat_holidays_year ON stat_holidays(year);
CREATE INDEX IF NOT EXISTS idx_stat_holidays_date ON stat_holidays(date);
`;

// Initialize database with schema
export async function initializeSchema(): Promise<void> {
  try {
    await database.execute(SCHEMA);
    console.log('Database schema initialized');

    // Run migrations for existing databases
    await runMigrations();
  } catch (error) {
    console.error('Schema initialization error:', error);
    throw error;
  }
}

// Run database migrations for schema updates
async function runMigrations(): Promise<void> {
  try {
    // Migration: Add anthropic_api_key column to user table if it doesn't exist
    const userColumns = await database.query<{ name: string }>(`PRAGMA table_info(user)`);
    const hasAnthropicKey = userColumns.some(col => col.name === 'anthropic_api_key');

    if (!hasAnthropicKey) {
      await database.execute(`ALTER TABLE user ADD COLUMN anthropic_api_key TEXT`);
      console.log('Migration: Added anthropic_api_key column to user table');
    }
  } catch (error) {
    console.error('Migration error:', error);
    // Don't throw - migrations are best-effort
  }
}

// TypeScript types matching the schema
export interface User {
  id: number;
  last_name: string;
  first_name: string;
  man_number: string;
  current_board: string | null;
  file_number: string | null;
  work_pin: string | null;
  day_rate: number | null;
  afternoon_rate: number | null;
  graveyard_rate: number | null;
  average_hours_target: number;
  pension_target: number | null;
  career_hours: number;
  gemini_api_key: string | null;
  anthropic_api_key: string | null;
  created_at: string;
}

export interface RatedJob {
  id: number;
  name: string;
  has_extra_hour: boolean;
  is_big_hour: boolean;
  has_meal_hour: boolean;
  created_at: string;
}

export interface Entry {
  id: number;
  date: string;
  shift_type: 'day' | 'afternoon' | 'graveyard';
  job_type: 'rated' | 'hall';
  rated_job_id: number | null;
  hall_job_name: string | null;
  hours: number;
  location: string | null;
  ship: string | null;
  notes: string | null;
  earnings: number | null;
  created_at: string;
}

export interface Document {
  id: number;
  name: string;
  type: 'image' | 'pdf' | 'timesheet' | 'other';
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  category: 'manning_sheet' | 'toolbox_talk' | 'vacation_pay' | 'pay_stub' | 'timesheet' | 'other' | null;
  extracted_data: string | null;
  notes: string | null;
  created_at: string;
}

export interface ShareGroup {
  id: number;
  name: string;
  platform: 'whatsapp' | 'telegram';
  identifier: string;
  created_at: string;
}

export interface TimeOff {
  id: number;
  date: string;
  type: 'vacation' | 'sick';
  notes: string | null;
  created_at: string;
}

export interface PeriodSummary {
  id: number;
  period_type: 'half_year' | 'year';
  period_start: string;
  period_end: string;
  total_hours: number;
  total_earnings: number;
  days_worked: number;
  summary_data: string | null;
  created_at: string;
}

export interface StatHolidayRecord {
  id: number;
  year: number;
  name: string;
  date: string;
  qualification_start: string;
  qualification_end: string;
  pay_date: string | null;
  created_at: string;
}

// Shift definitions with times and default hours
export const SHIFTS = {
  day: {
    name: 'Day',
    start: '8:00am',
    end: '4:30pm',
    defaultHours: 8
  },
  afternoon: {
    name: 'Afternoon',
    start: '4:30pm',
    end: '1:00am',
    defaultHours: 8
  },
  graveyard: {
    name: 'Graveyard',
    start: '1:00am',
    end: '8:00am',
    defaultHours: 6.5
  }
} as const;
