import { writable } from 'svelte/store';
import { database } from '$lib/db/database';
import { documents } from './documents';
import type { PeriodSummary } from '$lib/db/schema';

// Get the current half-year period (Jan-Jun or Jul-Dec)
export function getCurrentHalfYearPeriod(): { start: string; end: string; label: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  if (month < 6) {
    // January - June
    return {
      start: `${year}-01-01`,
      end: `${year}-06-30`,
      label: `Jan - Jun ${year}`
    };
  } else {
    // July - December
    return {
      start: `${year}-07-01`,
      end: `${year}-12-31`,
      label: `Jul - Dec ${year}`
    };
  }
}

// Get the previous half-year period
export function getPreviousHalfYearPeriod(): { start: string; end: string; label: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  if (month < 6) {
    // Previous period was Jul-Dec of last year
    return {
      start: `${year - 1}-07-01`,
      end: `${year - 1}-12-31`,
      label: `Jul - Dec ${year - 1}`
    };
  } else {
    // Previous period was Jan-Jun of this year
    return {
      start: `${year}-01-01`,
      end: `${year}-06-30`,
      label: `Jan - Jun ${year}`
    };
  }
}

// Check if we're in a new period that needs summary
export function isNewPeriod(lastSummaryDate: string | null): boolean {
  if (!lastSummaryDate) return false;

  const currentPeriod = getCurrentHalfYearPeriod();
  const lastDate = new Date(lastSummaryDate);
  const periodStart = new Date(currentPeriod.start);

  // If the last summary was before the current period started, we need a new summary
  return lastDate < periodStart;
}

function createPeriodSummariesStore() {
  const { subscribe, set, update } = writable<PeriodSummary[]>([]);

  return {
    subscribe,

    async load() {
      try {
        const result = await database.query<PeriodSummary>(
          'SELECT * FROM period_summaries ORDER BY period_start DESC'
        );
        set(result);
      } catch (error) {
        console.error('Failed to load period summaries:', error);
        set([]);
      }
    },

    async checkAndCreatePeriodSummary() {
      try {
        const currentPeriod = getCurrentHalfYearPeriod();
        const previousPeriod = getPreviousHalfYearPeriod();

        // Check if we already have a summary for the previous period
        const existingSummary = await database.query<PeriodSummary>(
          'SELECT * FROM period_summaries WHERE period_start = ? AND period_end = ?',
          [previousPeriod.start, previousPeriod.end]
        );

        if (existingSummary.length > 0) {
          // Summary already exists
          return null;
        }

        // Check if we have any entries for the previous period
        const entries = await database.query<{ count: number; hours: number; earnings: number }>(
          `SELECT COUNT(*) as count, COALESCE(SUM(hours), 0) as hours, COALESCE(SUM(earnings), 0) as earnings
           FROM entries WHERE date >= ? AND date <= ?`,
          [previousPeriod.start, previousPeriod.end]
        );

        if (!entries[0] || entries[0].count === 0) {
          // No entries for previous period, nothing to summarize
          return null;
        }

        const { count, hours, earnings } = entries[0];

        // Create summary data
        const summaryData = {
          period: previousPeriod.label,
          totalHours: hours,
          totalEarnings: earnings,
          daysWorked: count,
          averageHoursPerDay: count > 0 ? hours / count : 0,
          averageEarningsPerDay: count > 0 ? earnings / count : 0,
          targetHours: 600,
          targetMet: hours >= 600
        };

        // Save to period_summaries table
        await database.run(
          `INSERT INTO period_summaries (period_type, period_start, period_end, total_hours, total_earnings, days_worked, summary_data)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ['half_year', previousPeriod.start, previousPeriod.end, hours, earnings, count, JSON.stringify(summaryData)]
        );

        // Also save as a document for user review
        const docName = `Period Summary - ${previousPeriod.label}`;
        const docContent = `
DOCKLOGBC PERIOD SUMMARY
${previousPeriod.label}
========================

HOURS WORKED
Total Hours: ${hours.toFixed(1)} hrs
Target: 600 hrs
${hours >= 600 ? 'TARGET MET!' : `Shortfall: ${(600 - hours).toFixed(1)} hrs`}

EARNINGS
Total Earnings: $${earnings.toFixed(2)}
Average per Day: $${(count > 0 ? earnings / count : 0).toFixed(2)}

DAYS WORKED
Total Days: ${count}
Average Hours/Day: ${(count > 0 ? hours / count : 0).toFixed(1)} hrs

BOARD MOVE ELIGIBILITY
${hours >= 600 ? 'ELIGIBLE - Average hours target met!' : 'NOT ELIGIBLE - Did not meet 600 hour target'}

Generated: ${new Date().toLocaleDateString()}
        `.trim();

        await documents.add({
          name: docName,
          type: 'other',
          file_path: `summaries/${previousPeriod.start}_${previousPeriod.end}.txt`,
          file_size: docContent.length,
          mime_type: 'text/plain',
          category: 'other',
          extracted_data: JSON.stringify(summaryData),
          notes: docContent
        });

        await this.load();
        return summaryData;
      } catch (error) {
        console.error('Failed to create period summary:', error);
        return null;
      }
    },

    async getLatestSummary(): Promise<PeriodSummary | null> {
      try {
        const result = await database.query<PeriodSummary>(
          'SELECT * FROM period_summaries ORDER BY period_start DESC LIMIT 1'
        );
        return result[0] || null;
      } catch (error) {
        console.error('Failed to get latest summary:', error);
        return null;
      }
    }
  };
}

export const periodSummaries = createPeriodSummariesStore();
