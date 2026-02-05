// AI API utility for parsing timesheets and paystubs
// Supports both Anthropic (Claude) and Gemini APIs

import { CapacitorHttp } from '@capacitor/core';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// Get API key from environment variable (fallback)
const ENV_GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const ENV_ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || '';

// Helper to get the API key (user's key takes priority, then env)
export function getGeminiApiKey(userKey?: string | null): string {
  return userKey || ENV_GEMINI_KEY;
}

export function getAnthropicApiKey(userKey?: string | null): string {
  return userKey || ENV_ANTHROPIC_KEY;
}

export interface ParsedTimesheetEntry {
  date: string;
  shift_type: 'day' | 'afternoon' | 'graveyard';
  hours: number;
  job_name: string;
  earnings?: number;
  location?: string;
  ship?: string;
}

export interface ParsedPaystubData {
  gross_pay?: number;
  net_pay?: number;
  federal_tax?: number;
  provincial_tax?: number;
  cpp?: number;
  ei?: number;
  union_dues?: number;
  pension_contribution?: number;
  other_deductions?: number;
  pay_period_start?: string;
  pay_period_end?: string;
  hours_worked?: number;
}

export interface GeminiResponse {
  success: boolean;
  data?: ParsedTimesheetEntry[] | ParsedPaystubData;
  error?: string;
}

async function callClaude(apiKey: string, prompt: string, imageBase64?: string): Promise<string> {
  const content: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = [];

  if (imageBase64) {
    // Extract mime type and data from base64 string
    const matches = imageBase64.match(/^data:(.+);base64,(.+)$/);
    if (matches) {
      let mediaType = matches[1];
      const data = matches[2];

      // Normalize and validate media types
      // Claude vision supports: image/jpeg, image/png, image/gif, image/webp
      // Claude also supports PDF as document type
      if (mediaType === 'image/jpg') {
        mediaType = 'image/jpeg';
      }

      if (mediaType === 'application/pdf') {
        // PDFs use document type
        content.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: data
          }
        });
      } else if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mediaType)) {
        // Standard image types
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: data
          }
        });
      } else {
        // Try as jpeg if unknown image type
        console.warn(`Unknown media type: ${mediaType}, attempting as image/jpeg`);
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: data
          }
        });
      }
    }
  }

  content.push({ type: 'text', text: prompt });

  const requestBody = {
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content
      }
    ]
  };

  console.log('Calling Claude API with content types:', content.map(c => c.type));

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

  if (response.status !== 200) {
    console.error('Claude API error:', response.data);
    const errorMsg = response.data?.error?.message || `API request failed with status ${response.status}`;
    throw new Error(errorMsg);
  }

  const text = response.data?.content?.[0]?.text || '';
  console.log('Claude API returned text:', text.substring(0, 200));
  return text;
}

async function callGemini(apiKey: string, prompt: string, imageBase64?: string): Promise<string> {
  const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [];

  if (imageBase64) {
    // Extract mime type and data from base64 string
    const matches = imageBase64.match(/^data:(.+);base64,(.+)$/);
    if (matches) {
      parts.push({
        inline_data: {
          mime_type: matches[1],
          data: matches[2]
        }
      });
    }
  }

  parts.push({ text: prompt });

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096
      }
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Gemini API request failed');
  }

  const result = await response.json();
  return result.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

export async function parseTimesheetWithGemini(
  apiKey: string,
  content: string | null,
  imageBase64?: string
): Promise<GeminiResponse> {
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
    const response = await callGemini(apiKey, prompt, imageBase64);

    // Extract JSON from response (handle potential markdown wrapping)
    let jsonStr = response.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    }
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    const entries = JSON.parse(jsonStr) as ParsedTimesheetEntry[];

    // Validate and normalize entries
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
    console.error('Gemini parsing error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to parse timesheet'
    };
  }
}

export async function parsePaystubWithGemini(
  apiKey: string,
  imageBase64: string
): Promise<GeminiResponse> {
  // Legacy function - redirects to Claude
  return parsePaystubWithClaude(apiKey, imageBase64);
}

export async function parsePaystubWithClaude(
  apiKey: string,
  imageBase64: string
): Promise<GeminiResponse> {
  const prompt = `You are a JSON data extractor. Extract pay information from this paystub image and return ONLY a JSON object.

Extract these values as numbers (no currency symbols, just the number):
- gross_pay: Total earnings before deductions
- net_pay: Take-home pay after deductions
- hours_worked: Total hours worked
- federal_tax: Federal/income tax deducted
- provincial_tax: Provincial/state tax deducted
- cpp: Canada Pension Plan contribution
- ei: Employment Insurance contribution
- union_dues: Union dues deducted
- pension_contribution: Pension/retirement contribution
- pay_period_start: Start date as "YYYY-MM-DD"
- pay_period_end: End date as "YYYY-MM-DD"

Respond with ONLY this JSON structure, nothing else:
{"gross_pay":0,"net_pay":0,"hours_worked":0,"federal_tax":null,"provincial_tax":null,"cpp":null,"ei":null,"union_dues":null,"pension_contribution":null,"pay_period_start":null,"pay_period_end":null}

Replace 0 with actual values found. Use null for fields not found. NO explanations, NO markdown, ONLY the JSON object.`;

  try {
    const response = await callClaude(apiKey, prompt, imageBase64);
    console.log('Paystub Claude raw response:', response);

    // Extract JSON from response
    let jsonStr = response.trim();

    // Remove markdown code blocks if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    // Try to find JSON object in the response
    const jsonMatch = jsonStr.match(/\{[^{}]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    console.log('Paystub JSON to parse:', jsonStr);

    const data = JSON.parse(jsonStr) as ParsedPaystubData;
    console.log('Parsed paystub data:', data);

    // Check if we got at least some useful data
    if (data.gross_pay || data.net_pay || data.hours_worked) {
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

function normalizeDate(dateStr: string): string {
  // Try to parse various date formats and return YYYY-MM-DD
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split('T')[0];
  }
  return dateStr;
}

function normalizeShiftType(shift: string): 'day' | 'afternoon' | 'graveyard' {
  const s = (shift || '').toLowerCase();
  if (s.includes('grave') || s.includes('night') || s.includes('mid')) {
    return 'graveyard';
  }
  if (s.includes('after') || s.includes('evening') || s.includes('pm') || s.includes('swing')) {
    return 'afternoon';
  }
  return 'day';
}

export async function testGeminiConnection(apiKey: string): Promise<boolean> {
  try {
    await callGemini(apiKey, 'Reply with just the word "OK"');
    return true;
  } catch {
    return false;
  }
}

// Stat holiday schedule parsing
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

export async function parseStatScheduleWithGemini(
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
    const response = await callGemini(apiKey, prompt, imageBase64);
    console.log('Stat schedule Gemini response:', response);

    // Extract JSON from response
    let jsonStr = response.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    }
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    // Try to find JSON in the response if it's wrapped in text
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const data = JSON.parse(jsonStr);

    if (data.error) {
      console.log('Stat schedule parse returned error:', data.error);
      return { success: false, error: data.error };
    }

    // Validate the parsed data
    if (!data.year || !data.holidays || !Array.isArray(data.holidays)) {
      console.log('Stat schedule invalid format:', data);
      return { success: false, error: 'Invalid data format' };
    }

    // Validate each holiday has required fields
    const validHolidays = data.holidays.filter((h: ParsedStatHoliday) =>
      h.name && h.date && h.qualification_start && h.qualification_end
    );

    if (validHolidays.length === 0) {
      return { success: false, error: 'No valid holidays found' };
    }

    return {
      success: true,
      year: data.year,
      holidays: validHolidays
    };
  } catch (error) {
    console.error('Gemini stat schedule parsing error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to parse stat schedule'
    };
  }
}
