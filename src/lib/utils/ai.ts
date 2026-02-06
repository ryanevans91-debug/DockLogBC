// AI API utility for parsing timesheets, paystubs, and documents
// Primary: Anthropic Claude | Backup: Google Gemini

import { CapacitorHttp } from '@capacitor/core';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// Get API key from environment variable (fallback)
const ENV_GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const ENV_ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || '';

export function getApiKey(userKey?: string | null): string {
  return userKey || ENV_ANTHROPIC_KEY;
}

// Keep old names for backward compat
export const getAnthropicApiKey = getApiKey;
export function getGeminiApiKey(userKey?: string | null): string {
  return userKey || ENV_GEMINI_KEY;
}

// --- Types ---

export interface ParsedTimesheetEntry {
  date: string;
  shift_type: 'day' | 'afternoon' | 'graveyard';
  hours: number;
  job_name: string;
  earnings?: number;
  location?: string;
  ship?: string;
}

export interface ParsedPaystubLineItem {
  date: string;
  type: 'regular' | 'overtime';
  rate: number;
  hours: number;
  amount: number;
}

export interface ParsedPaystubData {
  line_items: ParsedPaystubLineItem[];
  gross_pay?: number;
  net_pay?: number;
  total_hours?: number;
  federal_tax?: number;
  provincial_tax?: number;
  cpp?: number;
  ei?: number;
  union_dues?: number;
  pension_contribution?: number;
  other_deductions?: number;
  pay_period_start?: string;
  pay_period_end?: string;
  // Legacy field - kept for backward compat
  hours_worked?: number;
}

export interface AIResponse {
  success: boolean;
  data?: ParsedTimesheetEntry[] | ParsedPaystubData;
  error?: string;
}

// Keep old name for backward compat
export type GeminiResponse = AIResponse;

export interface ParsedStatHoliday {
  name: string;
  date: string;
  qualification_start: string;
  qualification_end: string;
  pay_date?: string;
}

export interface StatScheduleResponse {
  success: boolean;
  year?: number;
  holidays?: ParsedStatHoliday[];
  error?: string;
}

// --- Claude (Primary) ---

function parseDataURL(dataURL: string): { mediaType: string; data: string } | null {
  const commaIndex = dataURL.indexOf(',');
  const semicolonIndex = dataURL.indexOf(';');

  if (commaIndex <= 0 || semicolonIndex <= 0) {
    console.error('Failed to parse DataURL - invalid format');
    return null;
  }

  let mediaType = dataURL.substring(5, semicolonIndex);
  const data = dataURL.substring(commaIndex + 1);

  if (mediaType === 'image/jpg') {
    mediaType = 'image/jpeg';
  }

  console.log('Parsed file:', mediaType, 'Data length:', data.length);
  return { mediaType, data };
}

async function callClaude(apiKey: string, prompt: string, imageBase64?: string): Promise<string> {
  const content: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = [];

  if (imageBase64) {
    const parsed = parseDataURL(imageBase64);
    if (parsed) {
      if (parsed.mediaType === 'application/pdf') {
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: parsed.data }
        });
      } else if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(parsed.mediaType)) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: parsed.mediaType, data: parsed.data }
        });
      } else {
        console.warn(`Unknown media type: ${parsed.mediaType}, attempting as image/jpeg`);
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: parsed.data }
        });
      }
    }
  }

  content.push({ type: 'text', text: prompt });

  const requestBody = {
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    messages: [{ role: 'user', content }]
  };

  console.log('Calling Claude API with content types:', content.map(c => c.type));
  console.log('API key present:', !!apiKey, 'Key prefix:', apiKey?.substring(0, 10));

  const response = await CapacitorHttp.post({
    url: ANTHROPIC_API_URL,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    data: requestBody
  });

  console.log('Claude API response status:', response.status);

  let responseData = response.data;
  if (typeof responseData === 'string') {
    try {
      responseData = JSON.parse(responseData);
    } catch {
      console.error('Failed to parse response as JSON:', responseData.substring(0, 500));
      throw new Error('Invalid response from API');
    }
  }

  if (response.status !== 200) {
    console.error('Claude API error:', JSON.stringify(responseData));
    const errorMsg = responseData?.error?.message || `API request failed with status ${response.status}`;
    throw new Error(errorMsg);
  }

  const text = responseData?.content?.[0]?.text || '';
  console.log('Claude API returned text:', text.substring(0, 500));
  return text;
}

// --- Gemini (Backup) ---

async function callGemini(apiKey: string, prompt: string, imageBase64?: string): Promise<string> {
  const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [];

  if (imageBase64) {
    const parsed = parseDataURL(imageBase64);
    if (parsed) {
      parts.push({ inline_data: { mime_type: parsed.mediaType, data: parsed.data } });
    }
  }

  parts.push({ text: prompt });

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Gemini API request failed');
  }

  const result = await response.json();
  return result.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// --- Helper: strip markdown and extract JSON ---

function extractJSON(response: string): string {
  let jsonStr = response.trim();
  if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
  else if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
  if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
  return jsonStr.trim();
}

// --- Public API ---

export async function parsePaystubWithClaude(
  apiKey: string,
  imageBase64: string
): Promise<AIResponse> {
  const prompt = `You are a JSON data extractor for Canadian longshoreman (ILWU) paystubs. Extract pay information and return ONLY a JSON object.

IMPORTANT - Date format on these paystubs:
Dates are 5 digits: YMMDD where Y = last digit of year. Example: "60129" means 2026-01-29 (6=2026, 01=January, 29=day). Convert ALL dates to YYYY-MM-DD format.

IMPORTANT - Current period vs Year-to-Date:
These paystubs show BOTH "Current" amounts and "Year-to-Date" (YTD) amounts. Extract ONLY the CURRENT PERIOD values, NOT year-to-date totals.

Extract TWO things:

1. LINE ITEMS - Each row in the earnings table. Each line has:
   - Earnings type: "Regular" or "Overtime" (overtime = extra hour or big hour bonus)
   - Date: 5-digit format (convert to YYYY-MM-DD)
   - Rate: hourly pay rate (number)
   - Current hrs/units: hours worked or overtime units (number)
   - Current amount: total pay for that line (number)

   For each line item, extract:
   - date: converted to "YYYY-MM-DD"
   - type: "regular" or "overtime"
   - rate: the hourly rate (number)
   - hours: the hrs/units value (number)
   - amount: the current amount (number)

2. TOTALS (current period only, NOT year-to-date):
   - gross_pay: Current period total gross earnings
   - net_pay: Current period net pay (take-home)
   - total_hours: Current period total hours
   - federal_tax, provincial_tax, cpp, ei, union_dues, pension_contribution: Current period deduction amounts
   - pay_period_start: First date in YYYY-MM-DD
   - pay_period_end: Last date in YYYY-MM-DD

Return ONLY this JSON structure:
{"line_items":[{"date":"2026-01-29","type":"regular","rate":45.50,"hours":8,"amount":364.00}],"gross_pay":0,"net_pay":0,"total_hours":0,"federal_tax":null,"provincial_tax":null,"cpp":null,"ei":null,"union_dues":null,"pension_contribution":null,"pay_period_start":null,"pay_period_end":null}

Replace values with actual data. Use null for fields not found. NO explanations, NO markdown, ONLY the JSON object.`;

  try {
    const response = await callClaude(apiKey, prompt, imageBase64);
    console.log('Paystub Claude raw response:', response);

    let jsonStr = extractJSON(response);

    // Try to find the full JSON object in the response
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    console.log('Paystub JSON to parse:', jsonStr.substring(0, 500));

    const data = JSON.parse(jsonStr) as ParsedPaystubData;
    console.log('Parsed paystub data:', data);

    // Backward compat: set hours_worked from total_hours
    if (data.total_hours && !data.hours_worked) {
      data.hours_worked = data.total_hours;
    }

    // Ensure line_items is an array
    if (!Array.isArray(data.line_items)) {
      data.line_items = [];
    }

    if (data.gross_pay || data.net_pay || data.line_items.length > 0) {
      return { success: true, data };
    } else {
      return { success: false, error: `No pay data found. Claude returned: ${response.substring(0, 200)}` };
    }
  } catch (error) {
    console.error('Claude paystub parsing error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to parse paystub'
    };
  }
}

// Keep old name
export const parsePaystubWithGemini = parsePaystubWithClaude;

export async function parseTimesheetWithAI(
  apiKey: string,
  content: string | null,
  imageBase64?: string
): Promise<AIResponse> {
  const prompt = `You are a timesheet data extractor. Analyze the provided timesheet data (image or text) and extract work entries.

For each entry, extract:
- date: The work date in YYYY-MM-DD format
- shift_type: Classify as "day" (morning shifts, typically 8am-4:30pm), "afternoon" (evening shifts, typically 4:30pm-1am), or "graveyard" (night shifts, typically 1am-8am)
- hours: Number of hours worked (decimal, e.g., 8 or 6.5)
- job_name: The job title, position, or work description
- earnings: Total earnings for that shift if shown (number only, no currency symbols)
- location: Work location if mentioned
- ship: Ship name if mentioned (this is for longshoremen/dock workers)

Return ONLY a valid JSON array of objects. No markdown, no explanation, just the JSON array.
Example format:
[{"date":"2024-01-15","shift_type":"day","hours":8,"job_name":"Crane Operator","earnings":450.00,"location":"Deltaport","ship":"MSC Oscar"}]

If no valid timesheet data is found, return an empty array: []

${content ? `\nText content to parse:\n${content}` : ''}`;

  try {
    // Try Claude first
    const response = await callClaude(apiKey, prompt, imageBase64);
    let jsonStr = extractJSON(response);

    const entries = JSON.parse(jsonStr) as ParsedTimesheetEntry[];

    const validEntries = entries
      .filter(e => e.date && e.hours)
      .map(e => ({
        ...e,
        date: normalizeDate(e.date),
        shift_type: normalizeShiftType(e.shift_type),
        hours: Number(e.hours) || 8,
        job_name: e.job_name || 'Imported',
        earnings: e.earnings ? Number(e.earnings) : undefined
      }));

    return { success: true, data: validEntries };
  } catch (error) {
    console.error('Claude timesheet parsing error, trying Gemini backup:', error);

    // Fallback to Gemini
    try {
      const geminiKey = getGeminiApiKey();
      if (!geminiKey) throw new Error('No Gemini API key available');

      const response = await callGemini(geminiKey, prompt, imageBase64);
      let jsonStr = extractJSON(response);

      const entries = JSON.parse(jsonStr) as ParsedTimesheetEntry[];

      const validEntries = entries
        .filter(e => e.date && e.hours)
        .map(e => ({
          ...e,
          date: normalizeDate(e.date),
          shift_type: normalizeShiftType(e.shift_type),
          hours: Number(e.hours) || 8,
          job_name: e.job_name || 'Imported',
          earnings: e.earnings ? Number(e.earnings) : undefined
        }));

      return { success: true, data: validEntries };
    } catch (geminiError) {
      console.error('Gemini backup also failed:', geminiError);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to parse timesheet'
      };
    }
  }
}

// Keep old name
export const parseTimesheetWithGemini = parseTimesheetWithAI;

export async function parseStatScheduleWithAI(
  apiKey: string,
  imageBase64: string
): Promise<StatScheduleResponse> {
  const prompt = `Analyze this image. If it contains a statutory holiday schedule (stat holidays, stat pay schedule, BC statutory holidays), extract the holiday information.

Look for tables or lists showing:
- Holiday names (New Year's Day, Family Day, Good Friday, Victoria Day, Canada Day, BC Day, Labour Day, Thanksgiving, Remembrance Day, Christmas Day, Boxing Day, etc.)
- Holiday dates
- Qualifying period dates (30-day qualifying window, qualification period)
- Pay dates (when stat pay is issued)

For each holiday found, extract:
- name: The holiday name
- date: Holiday date in YYYY-MM-DD format
- qualification_start: First day of qualifying period in YYYY-MM-DD format
- qualification_end: Last day of qualifying period in YYYY-MM-DD format
- pay_date: Pay date in YYYY-MM-DD format (if shown, otherwise null)

Determine the year from the dates shown.

Return ONLY a JSON object (no markdown, no explanation):
{"year":2026,"holidays":[{"name":"New Year's Day","date":"2026-01-01","qualification_start":"2025-11-30","qualification_end":"2025-12-29","pay_date":"2026-01-15"}]}

If this is NOT a stat holiday schedule, return exactly:
{"error":"not_stat_schedule"}`;

  try {
    // Try Claude first
    const response = await callClaude(apiKey, prompt, imageBase64);
    console.log('Stat schedule Claude response:', response);

    let jsonStr = extractJSON(response);
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    const data = JSON.parse(jsonStr);

    if (data.error) {
      return { success: false, error: data.error };
    }

    if (!data.year || !data.holidays || !Array.isArray(data.holidays)) {
      return { success: false, error: 'Invalid data format' };
    }

    const validHolidays = data.holidays.filter((h: ParsedStatHoliday) =>
      h.name && h.date && h.qualification_start && h.qualification_end
    );

    if (validHolidays.length === 0) {
      return { success: false, error: 'No valid holidays found' };
    }

    return { success: true, year: data.year, holidays: validHolidays };
  } catch (error) {
    console.error('Claude stat schedule parsing error, trying Gemini backup:', error);

    // Fallback to Gemini
    try {
      const geminiKey = getGeminiApiKey();
      if (!geminiKey) throw new Error('No Gemini API key available');

      const response = await callGemini(geminiKey, prompt, imageBase64);
      let jsonStr = extractJSON(response);
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonStr = jsonMatch[0];

      const data = JSON.parse(jsonStr);
      if (data.error) return { success: false, error: data.error };
      if (!data.year || !data.holidays || !Array.isArray(data.holidays)) {
        return { success: false, error: 'Invalid data format' };
      }

      const validHolidays = data.holidays.filter((h: ParsedStatHoliday) =>
        h.name && h.date && h.qualification_start && h.qualification_end
      );

      return validHolidays.length > 0
        ? { success: true, year: data.year, holidays: validHolidays }
        : { success: false, error: 'No valid holidays found' };
    } catch (geminiError) {
      console.error('Gemini backup also failed:', geminiError);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to parse stat schedule'
      };
    }
  }
}

// Keep old name
export const parseStatScheduleWithGemini = parseStatScheduleWithAI;

export async function testApiConnection(apiKey: string): Promise<boolean> {
  try {
    await callClaude(apiKey, 'Reply with just the word "OK"');
    return true;
  } catch {
    return false;
  }
}

// Keep old name
export const testGeminiConnection = testApiConnection;

// --- Helpers ---

function normalizeDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split('T')[0];
  }
  return dateStr;
}

function normalizeShiftType(shift: string): 'day' | 'afternoon' | 'graveyard' {
  const s = (shift || '').toLowerCase();
  if (s.includes('grave') || s.includes('night') || s.includes('mid')) return 'graveyard';
  if (s.includes('after') || s.includes('evening') || s.includes('pm') || s.includes('swing')) return 'afternoon';
  return 'day';
}
