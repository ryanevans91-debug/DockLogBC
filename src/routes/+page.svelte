<script lang="ts">
	import { user, userDisplayName, hasCompletedOnboarding, stats, periodSummaries, getCurrentHalfYearPeriod, entries } from '$lib/stores';
	import { getAverageHoursStatus } from '$lib/utils';
	import type { AverageHoursStatus } from '$lib/utils';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import { Browser } from '@capacitor/browser';
	import { CapacitorHttp } from '@capacitor/core';
	import { parseTimesheetWithAI, parseStatScheduleWithAI, getApiKey, type ParsedTimesheetEntry } from '$lib/utils/ai';
	import { statHolidayQueries } from '$lib/db/queries';
	import { loadStatHolidaysFromDb } from '$lib/constants/statHolidays';

	let avgHoursStatus = $state<AverageHoursStatus | null>(null);
	let loading = $state(true);
	let currentPeriod = $state(getCurrentHalfYearPeriod());

	// Data modal state
	let showDataModal = $state(false);
	let showImportModal = $state(false);
	let importedData = $state<Array<{date: string; shift_type: string; hours: number; job_name: string; earnings?: number; location?: string; ship?: string}>>([]);
	let importFileName = $state('');
	let importing = $state(false);
	let parsingWithAI = $state(false);

	// Work pins data
	interface WorkPins {
		day: string | null;
		afternoon: string | null;
		graveyard: string | null;
		lastUpdated: string | null;
	}
	let workPins = $state<WorkPins>({ day: null, afternoon: null, graveyard: null, lastUpdated: null });
	let pinsLoading = $state(true);

	onMount(async () => {
		// Redirect to onboarding if user hasn't set up profile
		if (!$hasCompletedOnboarding) {
			goto('/onboarding');
			return;
		}

		// Check for period summary (6-month reset)
		await periodSummaries.checkAndCreatePeriodSummary();

		// Load all data
		await Promise.all([
			stats.load(),
			loadAverageHoursStatus(),
			loadWorkPins()
		]);

		loading = false;
	});

	async function refreshWorkPins() {
		pinsLoading = true;
		await loadWorkPins();
	}

	async function loadAverageHoursStatus() {
		avgHoursStatus = await getAverageHoursStatus($user);
	}

	async function loadWorkPins() {
		try {
			// Use CapacitorHttp to bypass CORS on mobile
			const response = await CapacitorHttp.get({
				url: 'https://ilwu502.ca/greaseboard/work-pins/',
				headers: {
					'Accept': 'text/html'
				}
			});
			const html = response.data;

			// Parse the gbData from the HTML - need to match the full JSON object
			const gbDataMatch = html.match(/var\s+gbData\s*=\s*(\{[\s\S]*?\});\s*\n/);
			if (gbDataMatch) {
				const gbData = JSON.parse(gbDataMatch[1]);

				// Get user's board (e.g., "A" from profile)
				const userBoard = $user?.current_board?.toUpperCase() || '';
				const boardSearchTerm = userBoard ? `${userBoard} BOARD` : 'WORK';

				// Extract pin numbers from work_pins based on user's board
				if (gbData.work_pins) {
					const pins = gbData.work_pins;

					// Helper to find board pin or fall back to WORK
					const findBoardPin = (shiftJobs: any[]) => {
						if (!shiftJobs || shiftJobs.length === 0) return '--';
						// First try to find user's specific board
						const boardJob = shiftJobs.find((j: any) => j.job === boardSearchTerm);
						if (boardJob?.from) return boardJob.from;
						// Fall back to WORK if no board match
						const workJob = shiftJobs.find((j: any) => j.job === 'WORK');
						return workJob?.from || '--';
					};

					// Day shift (8am)
					workPins.day = findBoardPin(pins.for_8am);

					// Afternoon shift (4:30pm)
					workPins.afternoon = findBoardPin(pins.for_430pm);

					// Graveyard shift (1am)
					workPins.graveyard = findBoardPin(pins.for_1am);

					workPins.lastUpdated = new Date().toLocaleTimeString('default', { hour: 'numeric', minute: '2-digit' });
				}
			}
		} catch (error) {
			console.error('Failed to load work pins:', error);
			workPins = { day: '--', afternoon: '--', graveyard: '--', lastUpdated: null };
		}
		pinsLoading = false;
	}

	async function openExternalLink(url: string) {
		try {
			await Browser.open({ url });
		} catch {
			// Fallback for web
			window.open(url, '_blank');
		}
	}

	// Data import/export functions
	async function handleFileImport(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		importFileName = file.name;
		const isImage = file.type.startsWith('image/');
		const isPdf = file.type === 'application/pdf';
		const isCsv = file.name.endsWith('.csv');

		const apiKey = getApiKey($user?.anthropic_api_key);
		if ((isImage || isPdf) && !apiKey) {
			alert('AI extraction is not available. Please contact the developer.');
			input.value = '';
			return;
		}

		const reader = new FileReader();
		reader.onload = async (e) => {
			try {
				if (isCsv) {
					const content = e.target?.result as string;
					importedData = parseCSV(content);
					if (importedData.length > 0) {
						showDataModal = false;
						showImportModal = true;
					} else {
						alert('No valid data found in file.');
					}
				} else if (isImage || isPdf) {
					parsingWithAI = true;
					const base64 = e.target?.result as string;

					// Try stat schedule first
					console.log('Trying to parse as stat schedule...');
					const statResult = await parseStatScheduleWithAI(apiKey, base64);
					console.log('Stat result:', statResult);

					if (statResult.success && statResult.holidays && statResult.holidays.length > 0) {
						// It's a stat schedule - save directly to database
						const year = statResult.year!;
						await statHolidayQueries.deleteByYear(year); // Replace existing
						await statHolidayQueries.addMany(
							statResult.holidays.map(h => ({
								year,
								name: h.name,
								date: h.date,
								qualification_start: h.qualification_start,
								qualification_end: h.qualification_end,
								pay_date: h.pay_date || null
							}))
						);
						await loadStatHolidaysFromDb(); // Refresh cache
						parsingWithAI = false;
						showDataModal = false;
						alert(`Imported ${statResult.holidays.length} stat holidays for ${year}!`);
						return;
					}

					// Not a stat schedule, try timesheet
					console.log('Trying to parse as timesheet...');
					const result = await parseTimesheetWithAI(apiKey, null, base64);
					console.log('Timesheet result:', result);

					if (result.success && Array.isArray(result.data) && result.data.length > 0) {
						importedData = result.data as ParsedTimesheetEntry[];
						parsingWithAI = false;
						showDataModal = false;
						showImportModal = true;
					} else {
						parsingWithAI = false;
						const errorDetail = statResult.error || result.error || 'unknown format';
						alert(`Could not recognize this document (${errorDetail}). Make sure the image clearly shows a timesheet or stat holiday schedule.`);
					}
				} else {
					alert('Unsupported file type. Please use CSV, PDF, or image files.');
				}
			} catch (error) {
				console.error('Import error:', error);
				alert('Failed to parse file. Please try again.');
				parsingWithAI = false;
			}
		};

		if (isImage || isPdf) {
			reader.readAsDataURL(file);
		} else {
			reader.readAsText(file);
		}
		input.value = '';
	}

	function parseCSV(content: string): Array<{date: string; shift_type: string; hours: number; job_name: string; earnings?: number; location?: string; ship?: string}> {
		const lines = content.trim().split('\n');
		if (lines.length < 2) return [];

		const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
		const results: Array<{date: string; shift_type: string; hours: number; job_name: string; earnings?: number; location?: string; ship?: string}> = [];

		const dateIdx = headers.findIndex(h => h.includes('date'));
		const shiftIdx = headers.findIndex(h => h.includes('shift'));
		const hoursIdx = headers.findIndex(h => h.includes('hour'));
		const jobIdx = headers.findIndex(h => h.includes('job') || h.includes('position') || h.includes('title'));
		const earningsIdx = headers.findIndex(h => h.includes('earning') || h.includes('pay') || h.includes('amount'));
		const locationIdx = headers.findIndex(h => h.includes('location') || h.includes('terminal') || h.includes('site'));
		const shipIdx = headers.findIndex(h => h.includes('ship') || h.includes('vessel'));

		for (let i = 1; i < lines.length; i++) {
			const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
			if (values.length < 2) continue;

			const entry: any = {
				date: dateIdx >= 0 ? values[dateIdx] : '',
				shift_type: shiftIdx >= 0 ? values[shiftIdx]?.toLowerCase() || 'day' : 'day',
				hours: hoursIdx >= 0 ? parseFloat(values[hoursIdx]) || 8 : 8,
				job_name: jobIdx >= 0 ? values[jobIdx] : 'Imported'
			};

			if (earningsIdx >= 0 && values[earningsIdx]) {
				entry.earnings = parseFloat(values[earningsIdx].replace(/[$,]/g, '')) || undefined;
			}
			if (locationIdx >= 0 && values[locationIdx]) {
				entry.location = values[locationIdx];
			}
			if (shipIdx >= 0 && values[shipIdx]) {
				entry.ship = values[shipIdx];
			}

			if (entry.date && !isNaN(Date.parse(entry.date))) {
				if (entry.shift_type.includes('grave') || entry.shift_type.includes('night')) {
					entry.shift_type = 'graveyard';
				} else if (entry.shift_type.includes('after') || entry.shift_type.includes('pm') || entry.shift_type.includes('evening')) {
					entry.shift_type = 'afternoon';
				} else {
					entry.shift_type = 'day';
				}
				results.push(entry);
			}
		}
		return results;
	}

	async function confirmImport() {
		if (importing || importedData.length === 0) return;

		importing = true;
		try {
			let imported = 0;
			for (const entry of importedData) {
				await entries.add({
					date: new Date(entry.date).toISOString().split('T')[0],
					shift_type: entry.shift_type as 'day' | 'afternoon' | 'graveyard',
					job_type: 'hall',
					rated_job_id: null,
					hall_job_name: entry.job_name,
					hours: entry.hours,
					location: entry.location || null,
					ship: entry.ship || null,
					notes: `Imported from ${importFileName}`,
					earnings: entry.earnings || null
				});
				imported++;
			}

			alert(`Successfully imported ${imported} entries!`);
			showImportModal = false;
			importedData = [];
		} catch (error) {
			console.error('Import error:', error);
			alert('Failed to import some entries. Please try again.');
		} finally {
			importing = false;
		}
	}

	function cancelImport() {
		showImportModal = false;
		importedData = [];
		importFileName = '';
	}

	async function exportToCsv() {
		showDataModal = false;

		try {
			// Load all entries
			await entries.load();
			const allEntries = get(entries);

			if (allEntries.length === 0) {
				alert('No entries to export.');
				return;
			}

			// Create CSV header
			const headers = ['Date', 'Shift Type', 'Hours', 'Job Name', 'Earnings', 'Location', 'Ship'];

			// Create CSV rows
			const rows = allEntries.map(entry => {
				const jobName = entry.job_type === 'hall'
					? entry.hall_job_name || 'Hall Job'
					: 'Rated Job';

				return [
					entry.date,
					entry.shift_type,
					entry.hours.toString(),
					jobName,
					entry.earnings?.toString() || '',
					entry.location || '',
					entry.ship || ''
				].map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',');
			});

			const csvContent = [headers.join(','), ...rows].join('\n');

			// Create download for web/mobile
			const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.setAttribute('href', url);
			link.setAttribute('download', `docklogbc-export-${new Date().toISOString().split('T')[0]}.csv`);
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);

			alert(`Exported ${allEntries.length} entries to CSV!`);
		} catch (error) {
			console.error('Export error:', error);
			alert('Failed to export data. Please try again.');
		}
	}
</script>

<div class="p-4 space-y-4">
	<!-- Header -->
	<header class="mb-6">
		<p class="text-gray-500 text-sm">Welcome back,</p>
		<h1 class="text-2xl font-bold text-gray-900">{$userDisplayName}</h1>
		{#if $user}
			<p class="text-gray-500 text-sm">Man #{$user.man_number} {$user.current_board ? `| ${$user.current_board} Board` : ''}</p>
		{/if}
	</header>

	{#if loading}
		<div class="flex justify-center py-8">
			<div class="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
		</div>
	{:else}
		<!-- Average Hours Card -->
		{#if avgHoursStatus}
			<div class="card-elevated">
				<div class="flex justify-between items-start mb-2">
					<div>
						<h2 class="font-semibold text-gray-900">Average Hours</h2>
						<p class="text-xs text-gray-500">{currentPeriod.label} • Board move eligibility</p>
					</div>
					<span class="text-sm text-gray-500">{avgHoursStatus.daysRemaining} days left</span>
				</div>
				<div class="progress-bar mb-2">
					<div
						class="progress-fill {avgHoursStatus.onTrack ? 'bg-blue-600' : 'bg-amber-500'}"
						style="width: {avgHoursStatus.progressPercent}%"
					></div>
				</div>
				<div class="flex justify-between items-center">
					<p class="text-sm text-gray-600">
						<span class="font-semibold text-gray-900">{avgHoursStatus.currentHours.toFixed(1)}</span>
						/ {avgHoursStatus.targetHours} hrs
					</p>
					{#if avgHoursStatus.hoursNeeded > 0}
						<p class="text-xs {avgHoursStatus.onTrack ? 'text-green-600' : 'text-amber-600'}">
							{avgHoursStatus.onTrack ? 'On track' : `Need ${avgHoursStatus.pacePerDay.toFixed(1)} hrs/day`}
						</p>
					{:else}
						<p class="text-xs text-green-600 font-medium">Target reached!</p>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Work Pins Card -->
		<div class="card">
			<div class="flex items-center justify-between mb-3">
				<div class="flex items-center gap-2">
					<div class="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
						<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 text-amber-600">
							<path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
						</svg>
					</div>
					<div>
						<h3 class="font-medium text-gray-900">Work Pins</h3>
						{#if workPins.lastUpdated}
							<p class="text-xs text-gray-400">Updated {workPins.lastUpdated}</p>
						{/if}
					</div>
				</div>
				<div class="flex items-center gap-2">
					<button
						onclick={refreshWorkPins}
						disabled={pinsLoading}
						class="p-1.5 text-gray-400 hover:text-gray-600 disabled:opacity-50"
						aria-label="Refresh work pins"
					>
						<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 {pinsLoading ? 'animate-spin' : ''}">
							<path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
						</svg>
					</button>
					<button
						onclick={() => openExternalLink('https://ilwu502.ca/greaseboard/work-pins/')}
						class="font-medium text-blue-500 hover:text-blue-600 text-sm"
					>
						Greaseboard
					</button>
				</div>
			</div>
			{#if pinsLoading}
				<div class="flex justify-center py-2">
					<div class="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
				</div>
			{:else}
				<div class="grid grid-cols-3 gap-2 text-center">
					<div class="bg-gray-50 rounded-lg p-2">
						<p class="text-xs text-gray-500">Day</p>
						<p class="text-lg font-bold text-gray-900">{workPins.day || '--'}</p>
						<p class="text-xs text-gray-400">8am</p>
					</div>
					<div class="bg-gray-50 rounded-lg p-2">
						<p class="text-xs text-gray-500">Afternoon</p>
						<p class="text-lg font-bold text-gray-900">{workPins.afternoon || '--'}</p>
						<p class="text-xs text-gray-400">4:30pm</p>
					</div>
					<div class="bg-gray-50 rounded-lg p-2">
						<p class="text-xs text-gray-500">Graveyard</p>
						<p class="text-lg font-bold text-gray-900">{workPins.graveyard || '--'}</p>
						<p class="text-xs text-gray-400">1am</p>
					</div>
				</div>
			{/if}
		</div>

		<!-- External Links - Pre-D and ADP -->
		<div class="grid grid-cols-2 gap-3">
			<!-- Pre-D Card (formerly Memberlink) -->
			<button
				onclick={() => openExternalLink('https://workers.ilwu502.ca/')}
				class="card hover:bg-gray-50 transition-colors text-left"
			>
				<div class="flex items-center gap-2 mb-1">
					<div class="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
						<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 text-blue-600">
							<path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
						</svg>
					</div>
					<span class="font-medium text-gray-900">Pre-D</span>
				</div>
				<p class="text-xs text-gray-500">Member Link Login</p>
			</button>

			<!-- ADP Card -->
			<button
				onclick={() => openExternalLink('https://reports.adp.ca')}
				class="card hover:bg-gray-50 transition-colors text-left"
			>
				<div class="flex items-center gap-2 mb-1">
					<div class="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
						<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 text-green-600">
							<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
						</svg>
					</div>
					<span class="font-medium text-gray-900">ADP</span>
				</div>
				<p class="text-xs text-gray-500">View Pay Stubs</p>
			</button>
		</div>

		<!-- Documents Card -->
		<a href="/documents" class="block card hover:bg-gray-50 transition-colors">
			<div class="flex items-center gap-3">
				<div class="w-10 h-10 bg-primary-light rounded-lg flex items-center justify-center">
					<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-primary">
						<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
					</svg>
				</div>
				<div class="flex-1">
					<h3 class="font-medium text-gray-900">Documents</h3>
					<p class="text-sm text-gray-500">Manning sheets, pay stubs & more</p>
				</div>
				<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 text-gray-400">
					<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
				</svg>
			</div>
		</a>


		<!-- Camera Card -->
		<a href="/camera" class="block card-elevated bg-blue-600 text-white">
			<div class="flex items-center justify-center gap-3 py-2">
				<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
					<path stroke-linecap="round" stroke-linejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
				</svg>
				<span class="font-semibold">Camera</span>
			</div>
			<p class="text-center text-sm text-blue-100 -mt-1">Capture manning sheets, toolbox talks</p>
		</a>
	{/if}
</div>


<!-- Import Verification Modal -->
{#if showImportModal}
	<div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
		<div class="card w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col">
			<h2 class="text-lg font-semibold text-gray-900 mb-2">Verify Import</h2>
			<p class="text-sm text-gray-600 mb-4">
				Found {importedData.length} entries in {importFileName}
			</p>

			<div class="flex-1 overflow-y-auto mb-4 -mx-4 px-4">
				<table class="w-full text-sm">
					<thead class="bg-gray-50 sticky top-0">
						<tr>
							<th class="text-left py-2 px-2 font-medium text-gray-700">Date</th>
							<th class="text-left py-2 px-2 font-medium text-gray-700">Shift</th>
							<th class="text-left py-2 px-2 font-medium text-gray-700">Hours</th>
							<th class="text-left py-2 px-2 font-medium text-gray-700">Job</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-100">
						{#each importedData.slice(0, 20) as entry}
							<tr>
								<td class="py-2 px-2 text-gray-900">{entry.date}</td>
								<td class="py-2 px-2 text-gray-600 capitalize">{entry.shift_type}</td>
								<td class="py-2 px-2 text-gray-600">{entry.hours}</td>
								<td class="py-2 px-2 text-gray-600 truncate max-w-[100px]">
									{entry.job_name}
									{#if entry.location || entry.ship}
										<span class="block text-xs text-gray-400">{entry.location || ''}{entry.location && entry.ship ? ' - ' : ''}{entry.ship || ''}</span>
									{/if}
								</td>
							</tr>
						{/each}
						{#if importedData.length > 20}
							<tr>
								<td colspan="4" class="py-2 px-2 text-center text-gray-500 italic">
									...and {importedData.length - 20} more entries
								</td>
							</tr>
						{/if}
					</tbody>
				</table>
			</div>

			<div class="grid grid-cols-2 gap-3 pt-4 border-t">
				<button
					onclick={cancelImport}
					class="py-2 border border-gray-300 rounded-lg text-gray-700"
				>
					Cancel
				</button>
				<button
					onclick={confirmImport}
					disabled={importing}
					class="py-2 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-50"
				>
					{importing ? 'Importing...' : 'Import All'}
				</button>
			</div>
		</div>
	</div>
{/if}

