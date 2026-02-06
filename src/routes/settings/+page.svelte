<script lang="ts">
	import { user, ratedJobs, theme, entries, documents, type ThemeMode } from '$lib/stores';
	import { SHIFTS } from '$lib/db';
	import { parsePaystubWithClaude, getAnthropicApiKey } from '$lib/utils/ai';

	// Form state - populated from user store
	let lastName = $state($user?.last_name || '');
	let firstName = $state($user?.first_name || '');
	let manNumber = $state($user?.man_number || '');
	let currentBoard = $state($user?.current_board || '');
	let fileNumber = $state($user?.file_number || '');
	let workPin = $state($user?.work_pin || '');
	let dayRate = $state<number | null>($user?.day_rate || null);
	let afternoonRate = $state<number | null>($user?.afternoon_rate || null);
	let graveyardRate = $state<number | null>($user?.graveyard_rate || null);
	let averageHoursTarget = $state($user?.average_hours_target || 600);
	let pensionTarget = $state<number | null>($user?.pension_target || null);

	// Update local state when user store changes
	$effect(() => {
		if ($user) {
			lastName = $user.last_name;
			firstName = $user.first_name;
			manNumber = $user.man_number;
			currentBoard = $user.current_board || '';
			fileNumber = $user.file_number || '';
			workPin = $user.work_pin || '';
			dayRate = $user.day_rate;
			afternoonRate = $user.afternoon_rate;
			graveyardRate = $user.graveyard_rate;
			averageHoursTarget = $user.average_hours_target;
			pensionTarget = $user.pension_target;
		}
	});

	// UI state
	let saving = $state(false);
	let showJobForm = $state(false);
	let newJobName = $state('');
	let newJobHourType = $state<'none' | 'extra' | 'big'>('none');
	let newJobMealHour = $state(false);
	let editingJobId = $state<number | null>(null);

	async function saveProfile() {
		if (saving) return;
		saving = true;

		try {
			await user.update({
				last_name: lastName.trim(),
				first_name: firstName.trim(),
				man_number: manNumber.trim(),
				current_board: currentBoard.trim() || null,
				file_number: fileNumber.trim() || null,
				work_pin: workPin.trim() || null,
				day_rate: dayRate,
				afternoon_rate: afternoonRate,
				graveyard_rate: graveyardRate,
				average_hours_target: averageHoursTarget,
				pension_target: pensionTarget
			});

			alert('Profile saved!');
		} catch (error) {
			console.error('Failed to save profile:', error);
			alert('Failed to save profile. Please try again.');
		} finally {
			saving = false;
		}
	}

	let csvInputRef = $state<HTMLInputElement | null>(null);
	let paystubInputRef = $state<HTMLInputElement | null>(null);
	let processingPaystub = $state(false);
	let showPaystubModal = $state(false);
	let paystubData = $state<{
		line_items: Array<{ date: string; type: string; rate: number; hours: number; amount: number }>;
		gross_pay?: number;
		net_pay?: number;
		total_hours?: number;
		hourly_rate?: number;
		federal_tax?: number;
		provincial_tax?: number;
		cpp?: number;
		ei?: number;
		union_dues?: number;
		pension_contribution?: number;
		pay_period_start?: string;
		pay_period_end?: string;
	} | null>(null);
	let paystubFile = $state<{ data: string; mimeType: string } | null>(null);

	function triggerCsvImport() {
		csvInputRef?.click();
	}

	const PAYSTUB_WEEKLY_LIMIT = 10;

	function getPaystubUploadsThisWeek(): number {
		const now = new Date();
		const startOfWeek = new Date(now);
		startOfWeek.setDate(now.getDate() - now.getDay());
		startOfWeek.setHours(0, 0, 0, 0);
		const key = 'paystub_uploads';
		try {
			const stored = JSON.parse(localStorage.getItem(key) || '[]') as number[];
			const thisWeek = stored.filter(ts => ts >= startOfWeek.getTime());
			localStorage.setItem(key, JSON.stringify(thisWeek));
			return thisWeek.length;
		} catch {
			return 0;
		}
	}

	function recordPaystubUpload() {
		const key = 'paystub_uploads';
		try {
			const stored = JSON.parse(localStorage.getItem(key) || '[]') as number[];
			stored.push(Date.now());
			localStorage.setItem(key, JSON.stringify(stored));
		} catch { /* ignore */ }
	}

	function triggerPaystubUpload() {
		const uploadsThisWeek = getPaystubUploadsThisWeek();
		if (uploadsThisWeek >= PAYSTUB_WEEKLY_LIMIT) {
			alert(`You've reached the limit of ${PAYSTUB_WEEKLY_LIMIT} paystub uploads per week. Please try again next week.`);
			return;
		}
		paystubInputRef?.click();
	}

	async function handlePaystubUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		input.value = '';

		const apiKey = getAnthropicApiKey($user?.anthropic_api_key);
		if (!apiKey) {
			alert('AI extraction is not available. Please contact the developer.');
			return;
		}

		processingPaystub = true;
		const reader = new FileReader();
		reader.onload = async (e) => {
			try {
				const data = e.target?.result as string;
				paystubFile = { data: data.split(',')[1], mimeType: file.type };

				const result = await parsePaystubWithClaude(apiKey, data);
				console.log('Paystub result:', result);

				if (result.success && result.data && !Array.isArray(result.data)) {
					recordPaystubUpload();
					const extracted = result.data as any;
					const lineItems = Array.isArray(extracted.line_items) ? extracted.line_items : [];
					const totalHours = extracted.total_hours || extracted.hours_worked;

					// Calculate hourly rate from the most common regular rate in line items
					let hourlyRate: number | undefined;
					const regularItems = lineItems.filter((li: any) => li.type === 'regular' && li.rate);
					if (regularItems.length > 0) {
						// Use the most common rate
						const rateCounts: Record<number, number> = {};
						for (const li of regularItems) {
							rateCounts[li.rate] = (rateCounts[li.rate] || 0) + 1;
						}
						hourlyRate = Number(Object.entries(rateCounts).sort((a, b) => b[1] - a[1])[0][0]);
					} else if (extracted.gross_pay && totalHours) {
						hourlyRate = Math.round((extracted.gross_pay / totalHours) * 100) / 100;
					}

					paystubData = {
						line_items: lineItems,
						gross_pay: extracted.gross_pay,
						net_pay: extracted.net_pay,
						total_hours: totalHours,
						hourly_rate: hourlyRate,
						federal_tax: extracted.federal_tax,
						provincial_tax: extracted.provincial_tax,
						cpp: extracted.cpp,
						ei: extracted.ei,
						union_dues: extracted.union_dues,
						pension_contribution: extracted.pension_contribution,
						pay_period_start: extracted.pay_period_start,
						pay_period_end: extracted.pay_period_end
					};
					processingPaystub = false;
					showPaystubModal = true;
				} else {
					processingPaystub = false;
					const errorMsg = result.error || 'Unknown error';
					console.log('Paystub extraction failed:', errorMsg);
					alert(`Could not extract data from paystub: ${errorMsg}`);
				}
			} catch (error) {
				console.error('Paystub error:', error);
				processingPaystub = false;
				alert(`Failed to process paystub: ${error instanceof Error ? error.message : 'Unknown error'}`);
			}
		};
		reader.readAsDataURL(file);
	}

	// Determine shift type by matching rate to user's configured rates
	function getShiftTypeByRate(rate: number): 'day' | 'afternoon' | 'graveyard' {
		if (!$user) return 'day';

		const rates: Array<{ type: 'day' | 'afternoon' | 'graveyard'; rate: number | null }> = [
			{ type: 'day', rate: $user.day_rate },
			{ type: 'afternoon', rate: $user.afternoon_rate },
			{ type: 'graveyard', rate: $user.graveyard_rate }
		];

		// Find closest matching rate
		let bestMatch: 'day' | 'afternoon' | 'graveyard' = 'day';
		let smallestDiff = Infinity;

		for (const r of rates) {
			if (r.rate) {
				const diff = Math.abs(r.rate - rate);
				if (diff < smallestDiff) {
					smallestDiff = diff;
					bestMatch = r.type;
				}
			}
		}

		return bestMatch;
	}

	async function savePaystubAndUpdateRates() {
		if (!paystubFile || !paystubData) return;

		try {
			// 1. Save document
			const { Filesystem, Directory } = await import('@capacitor/filesystem');
			const ext = paystubFile.mimeType.includes('pdf') ? 'pdf' : 'jpg';
			const fileName = `paystub_${Date.now()}.${ext}`;
			const savedFile = await Filesystem.writeFile({
				path: `documents/${fileName}`,
				data: paystubFile.data,
				directory: Directory.Data,
				recursive: true
			});

			const periodLabel = paystubData.pay_period_end
				? new Date(paystubData.pay_period_end).toLocaleDateString('en-CA')
				: new Date().toLocaleDateString('en-CA');

			await documents.add({
				name: `Pay Stub - ${periodLabel}`,
				type: ext === 'pdf' ? 'pdf' : 'image',
				file_path: savedFile.uri || `documents/${fileName}`,
				file_size: null,
				mime_type: paystubFile.mimeType,
				category: 'pay_stub',
				extracted_data: JSON.stringify(paystubData),
				notes: null
			});

			// 2. Update hourly rate
			if (paystubData.hourly_rate && $user) {
				await user.update({ day_rate: paystubData.hourly_rate });
			}

			// 3. Create work entries from line items
			let entriesCreated = 0;
			if (paystubData.line_items && paystubData.line_items.length > 0) {
				// Group line items by date
				const byDate: Record<string, { regular: typeof paystubData.line_items; overtime: typeof paystubData.line_items }> = {};

				for (const item of paystubData.line_items) {
					if (!item.date) continue;
					if (!byDate[item.date]) {
						byDate[item.date] = { regular: [], overtime: [] };
					}
					if (item.type === 'overtime') {
						byDate[item.date].overtime.push(item);
					} else {
						byDate[item.date].regular.push(item);
					}
				}

				// Check which dates already have entries
				const allDates = Object.keys(byDate);
				if (allDates.length > 0) {
					const minDate = allDates.sort()[0];
					const maxDate = allDates.sort().reverse()[0];
					const existingEntries = await entries.loadDateRange(minDate, maxDate);
					const existingDates = new Set(existingEntries.map(e => e.date));

					for (const [date, items] of Object.entries(byDate)) {
						if (existingDates.has(date)) continue;

						// Sum regular hours and earnings for this date
						const regularHours = items.regular.reduce((sum, li) => sum + (li.hours || 0), 0);
						const overtimeHours = items.overtime.reduce((sum, li) => sum + (li.hours || 0), 0);
						const totalEarnings = [...items.regular, ...items.overtime].reduce((sum, li) => sum + (li.amount || 0), 0);

						// Determine shift from the regular rate
						const regularRate = items.regular[0]?.rate;
						const shiftType = regularRate ? getShiftTypeByRate(regularRate) : 'day';

						await entries.add({
							date,
							shift_type: shiftType,
							job_type: 'hall',
							rated_job_id: null,
							hall_job_name: 'Paystub Import',
							hours: regularHours + overtimeHours,
							location: null,
							ship: null,
							notes: overtimeHours > 0
								? `Imported from paystub (${regularHours}h regular + ${overtimeHours}h overtime)`
								: 'Imported from paystub',
							earnings: totalEarnings ? Math.round(totalEarnings * 100) / 100 : null
						});
						entriesCreated++;
					}
				}
			}

			// 4. Update career hours
			const totalHours = paystubData.total_hours || paystubData.line_items?.reduce((sum, li) => sum + (li.hours || 0), 0) || 0;
			if (totalHours > 0 && $user) {
				await user.update({ career_hours: ($user.career_hours || 0) + totalHours });
			}

			showPaystubModal = false;
			paystubData = null;
			paystubFile = null;

			if (entriesCreated > 0) {
				alert(`Pay stub saved! Created ${entriesCreated} work entries and updated your hourly rate.`);
			} else {
				alert('Pay stub saved and hourly rate updated. No new entries created (dates already had entries or no line items found).');
			}
		} catch (error) {
			console.error('Save error:', error);
			alert('Failed to save paystub.');
		}
	}

	async function handleCsvImport(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		input.value = '';

		try {
			const text = await file.text();
			// Parse CSV and add entries
			const lines = text.split('\n').filter(line => line.trim());
			if (lines.length < 2) {
				alert('CSV file is empty or has no data rows.');
				return;
			}

			// Skip header row, parse data rows
			const dataRows = lines.slice(1);
			let imported = 0;

			for (const row of dataRows) {
				// Simple CSV parsing (handles quoted fields)
				const cells = row.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g)?.map(c => c.replace(/^"|"$/g, '').trim()) || [];

				if (cells.length >= 3) {
					const [date, shiftType, hours, jobName, earnings, location, ship] = cells;

					// Normalize shift type
					let normalizedShift: 'day' | 'afternoon' | 'graveyard' = 'day';
					const shiftLower = (shiftType || '').toLowerCase();
					if (shiftLower.includes('grave') || shiftLower.includes('night')) {
						normalizedShift = 'graveyard';
					} else if (shiftLower.includes('after') || shiftLower.includes('pm')) {
						normalizedShift = 'afternoon';
					}

					await entries.add({
						date: date || new Date().toISOString().split('T')[0],
						shift_type: normalizedShift,
						job_type: 'hall',
						rated_job_id: null,
						hall_job_name: jobName || 'Imported',
						hours: parseFloat(hours) || 8,
						location: location || null,
						ship: ship || null,
						notes: 'Imported from CSV',
						earnings: earnings ? parseFloat(earnings) : null
					});
					imported++;
				}
			}

			alert(`Successfully imported ${imported} entries!`);
		} catch (error) {
			console.error('Import error:', error);
			alert('Failed to import CSV. Please check the file format.');
		}
	}

	async function addJob() {
		if (!newJobName.trim()) return;

		try {
			await ratedJobs.add({
				name: newJobName.trim(),
				has_extra_hour: newJobHourType === 'extra',
				is_big_hour: newJobHourType === 'big',
				has_meal_hour: newJobMealHour
			});

			// Reset form
			newJobName = '';
			newJobHourType = 'none';
			newJobMealHour = false;
			showJobForm = false;
		} catch (error) {
			console.error('Failed to add job:', error);
			alert('Failed to add job. Please try again.');
		}
	}

	async function deleteJob(id: number) {
		if (!confirm('Are you sure you want to delete this job?')) return;

		try {
			await ratedJobs.remove(id);
		} catch (error) {
			console.error('Failed to delete job:', error);
			alert('Failed to delete job. Please try again.');
		}
	}
</script>

<div class="p-4 pb-32 space-y-6">
	<header class="mb-2">
		<h1 class="text-2xl font-bold text-gray-900">Profile</h1>
	</header>

	<!-- Profile Section -->
	<section>
		<h2 class="text-lg font-semibold text-gray-900 mb-3">Personal Info</h2>
		<div class="card space-y-4">
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="lastName" class="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
					<input
						id="lastName"
						type="text"
						bind:value={lastName}
						class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
					/>
				</div>
				<div>
					<label for="firstName" class="block text-sm font-medium text-gray-700 mb-1">First Name</label>
					<input
						id="firstName"
						type="text"
						bind:value={firstName}
						class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
					/>
				</div>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="manNumber" class="block text-sm font-medium text-gray-700 mb-1">Man Number</label>
					<input
						id="manNumber"
						type="text"
						bind:value={manNumber}
						class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
					/>
				</div>
				<div>
					<label for="currentBoard" class="block text-sm font-medium text-gray-700 mb-1">Board</label>
					<input
						id="currentBoard"
						type="text"
						bind:value={currentBoard}
						class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
					/>
				</div>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="fileNumber" class="block text-sm font-medium text-gray-700 mb-1">File Number</label>
					<input
						id="fileNumber"
						type="text"
						bind:value={fileNumber}
						class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
					/>
				</div>
				<div>
					<label for="workPin" class="block text-sm font-medium text-gray-700 mb-1">Work Pin</label>
					<input
						id="workPin"
						type="text"
						bind:value={workPin}
						class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
					/>
				</div>
			</div>
		</div>
	</section>

	<!-- Rated Jobs Section -->
	<section>
		<div class="flex justify-between items-center mb-3">
			<h2 class="text-lg font-semibold text-gray-900">Rated Jobs</h2>
			<button
				onclick={() => showJobForm = !showJobForm}
				class="text-blue-600 text-sm font-medium"
			>
				{showJobForm ? 'Cancel' : '+ Add Job'}
			</button>
		</div>

		{#if showJobForm}
			<div class="card mb-3 space-y-3">
				<input
					type="text"
					bind:value={newJobName}
					placeholder="Job name"
					class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
				/>
				<div class="space-y-2">
					<p class="text-sm font-medium text-gray-700">Hour Bonus:</p>
					<div class="flex flex-col gap-1">
						<label class="flex items-center gap-2">
							<input type="radio" name="settingsHourType" value="none" bind:group={newJobHourType} class="w-4 h-4 text-blue-600" />
							<span class="text-sm text-gray-700">None</span>
						</label>
						<label class="flex items-center gap-2">
							<input type="radio" name="settingsHourType" value="extra" bind:group={newJobHourType} class="w-4 h-4 text-blue-600" />
							<span class="text-sm text-gray-700">+1 Extra Hour</span>
						</label>
						<label class="flex items-center gap-2">
							<input type="radio" name="settingsHourType" value="big" bind:group={newJobHourType} class="w-4 h-4 text-blue-600" />
							<span class="text-sm text-gray-700">Big Hour (1.5x)</span>
						</label>
					</div>
				</div>
				<div class="border-t pt-2">
					<label class="flex items-center gap-2">
						<input type="checkbox" bind:checked={newJobMealHour} class="w-4 h-4 rounded text-blue-600" />
						<span class="text-sm text-gray-700">+0.5 Meal Hour</span>
					</label>
				</div>
				<button
					onclick={addJob}
					disabled={!newJobName.trim()}
					class="w-full py-2 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-50"
				>
					Add Job
				</button>
			</div>
		{/if}

		{#if $ratedJobs.length > 0}
			<div class="space-y-2">
				{#each $ratedJobs as job}
					<div class="card flex justify-between items-center">
						<div>
							<span class="font-medium text-gray-900">{job.name}</span>
							{#if job.has_extra_hour || job.is_big_hour || job.has_meal_hour}
								<div class="flex gap-2 mt-1 flex-wrap">
									{#if job.has_extra_hour}
										<span class="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">+1 hr</span>
									{/if}
									{#if job.is_big_hour}
										<span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">1.5x</span>
									{/if}
									{#if job.has_meal_hour}
										<span class="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">+0.5 meal</span>
									{/if}
								</div>
							{/if}
						</div>
						<button
							onclick={() => deleteJob(job.id)}
							class="text-red-500 hover:text-red-700 p-2"
							aria-label="Delete job"
						>
							<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
							</svg>
						</button>
					</div>
				{/each}
			</div>
		{:else}
			<p class="card text-center text-gray-500 py-4">No rated jobs configured</p>
		{/if}
	</section>

	<!-- Hourly Rates Section -->
	<section>
		<h2 class="text-lg font-semibold text-gray-900 mb-3">Hourly Rates</h2>
		<div class="space-y-3">
			<div class="card">
				<div class="flex justify-between items-center mb-2">
					<span class="font-medium text-gray-900">{SHIFTS.day.name}</span>
					<span class="text-sm text-gray-500">{SHIFTS.day.start} - {SHIFTS.day.end}</span>
				</div>
				<div class="relative">
					<span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
					<input
						type="number"
						step="0.01"
						bind:value={dayRate}
						placeholder="0.00"
						class="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
					/>
				</div>
			</div>
			<div class="card">
				<div class="flex justify-between items-center mb-2">
					<span class="font-medium text-gray-900">{SHIFTS.afternoon.name}</span>
					<span class="text-sm text-gray-500">{SHIFTS.afternoon.start} - {SHIFTS.afternoon.end}</span>
				</div>
				<div class="relative">
					<span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
					<input
						type="number"
						step="0.01"
						bind:value={afternoonRate}
						placeholder="0.00"
						class="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
					/>
				</div>
			</div>
			<div class="card">
				<div class="flex justify-between items-center mb-2">
					<span class="font-medium text-gray-900">{SHIFTS.graveyard.name}</span>
					<span class="text-sm text-gray-500">{SHIFTS.graveyard.start} - {SHIFTS.graveyard.end}</span>
				</div>
				<div class="relative">
					<span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
					<input
						type="number"
						step="0.01"
						bind:value={graveyardRate}
						placeholder="0.00"
						class="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
					/>
				</div>
			</div>
		</div>
	</section>

	<!-- Goals Section -->
	<section>
		<h2 class="text-lg font-semibold text-gray-900 mb-3">Goals</h2>
		<div class="space-y-3">
			<div class="card">
				<label for="avgHours" class="block font-medium text-gray-900 mb-1">Average Hours Target</label>
				<input
					id="avgHours"
					type="number"
					bind:value={averageHoursTarget}
					class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
				/>
			</div>
			<div class="card">
				<label for="pension" class="block font-medium text-gray-900 mb-1">Pensionable Year Target</label>
				<div class="relative">
					<span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
					<input
						id="pension"
						type="number"
						step="0.01"
						bind:value={pensionTarget}
						placeholder="0.00"
						class="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
					/>
				</div>
			</div>
		</div>
	</section>

	<!-- Data Section -->
	<section>
		<h2 class="text-lg font-semibold text-gray-900 mb-3">Data</h2>
		<div class="space-y-3">
			<button
				onclick={triggerCsvImport}
				class="card w-full text-left flex items-center gap-3 hover:bg-gray-50 transition-colors"
			>
				<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 text-blue-500">
					<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
				</svg>
				<div>
					<p class="font-medium text-gray-900">Import CSV</p>
					<p class="text-sm text-gray-500">Import entries from file</p>
				</div>
			</button>

			<button
				onclick={triggerPaystubUpload}
				class="card w-full text-left flex items-center gap-3 hover:bg-gray-50 transition-colors"
			>
				<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 text-purple-500">
					<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
				</svg>
				<div>
					<p class="font-medium text-gray-900">Upload Paystub</p>
					<p class="text-sm text-gray-500">AI extracts pay data automatically</p>
				</div>
			</button>
		</div>
		<input
			type="file"
			accept=".csv,text/csv"
			bind:this={csvInputRef}
			onchange={handleCsvImport}
			class="hidden"
		/>
		<input
			type="file"
			accept="image/*,.pdf"
			bind:this={paystubInputRef}
			onchange={handlePaystubUpload}
			class="hidden"
		/>
	</section>

	<!-- Appearance Section -->
	<section>
		<h2 class="text-lg font-semibold text-gray-900 mb-3">Appearance</h2>
		<div class="space-y-3">
			<!-- Theme Mode -->
			<div class="card">
				<label class="block font-medium text-gray-900 mb-2">Theme Mode</label>
				<div class="grid grid-cols-2 gap-2">
					{#each [['light', 'Light'], ['dark', 'Dark']] as [mode, label]}
						<button
							onclick={() => theme.setMode(mode as ThemeMode)}
							class="py-2 rounded-lg text-sm font-medium transition-colors
								{$theme.mode === mode
									? 'bg-blue-600 text-white'
									: 'bg-gray-100 text-gray-700 hover:bg-gray-200'}"
						>
							{label}
						</button>
					{/each}
				</div>
			</div>

		</div>
	</section>

	<!-- Save Profile Button -->
	<button
		onclick={saveProfile}
		disabled={saving}
		class="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold disabled:opacity-50"
	>
		{saving ? 'Saving...' : 'Save Profile'}
	</button>

	<!-- Donate -->
	<section class="text-center pt-4">
		<div class="bg-gray-50 rounded-xl p-4">
			<p class="text-sm text-gray-500 mb-3">Enjoy the app? We appreciate any donations!</p>
			<a
				href="https://www.paypal.me/ryanmidris"
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0070ba] text-white rounded-lg font-semibold text-sm"
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944 2.04A.859.859 0 0 1 5.79 1.28h7.557c2.578 0 4.378 1.357 4.073 4.252-.403 3.834-2.998 5.164-5.973 5.164H9.403l-1.109 6.773a.641.641 0 0 1-.633.534H7.076zM19.442 6.79c-.401 3.83-2.998 5.86-5.973 5.86h-1.41l-1.11 6.773a.428.428 0 0 1-.422.356h-2.06l-.108.66a.428.428 0 0 0 .422.5h2.96a.642.642 0 0 0 .633-.534l.72-4.392c.177-1.084 1.1-1.9 2.2-1.9h.66c3.053 0 5.19-2.065 5.69-5.168.273-1.7-.132-3.013-1.202-3.155z"/></svg>
				PayPal
			</a>
		</div>
		<p class="text-sm text-gray-400 mt-3">DockLogBC v1.1.0</p>
	</section>
</div>

<!-- Paystub Data Modal -->
{#if showPaystubModal && paystubData}
	<div class="fixed inset-0 bg-black/50 flex items-start justify-center pt-8 pb-24 px-4 z-[60] overflow-y-auto">
		<div class="card w-full max-w-sm flex flex-col overflow-hidden">
			<h2 class="text-lg font-semibold text-gray-900 mb-4 flex-shrink-0">Paystub Data Extracted</h2>

			<div class="flex-1 overflow-y-auto min-h-0 space-y-2 mb-4">
				{#if paystubData.pay_period_start && paystubData.pay_period_end}
					<div class="flex justify-between text-sm">
						<span class="text-gray-500">Pay Period:</span>
						<span class="text-gray-600">{paystubData.pay_period_start} to {paystubData.pay_period_end}</span>
					</div>
				{/if}

				<!-- Earnings Summary -->
				{#if paystubData.gross_pay}
					<div class="flex justify-between">
						<span class="text-gray-600">Gross Pay:</span>
						<span class="font-semibold text-gray-900">${paystubData.gross_pay.toFixed(2)}</span>
					</div>
				{/if}
				{#if paystubData.net_pay}
					<div class="flex justify-between">
						<span class="text-gray-600">Net Pay:</span>
						<span class="font-semibold text-green-600">${paystubData.net_pay.toFixed(2)}</span>
					</div>
				{/if}
				{#if paystubData.total_hours}
					<div class="flex justify-between">
						<span class="text-gray-600">Total Hours:</span>
						<span class="font-semibold text-gray-900">{paystubData.total_hours} hrs</span>
					</div>
				{/if}
				{#if paystubData.hourly_rate}
					<div class="flex justify-between p-2 bg-blue-50 rounded-lg">
						<span class="text-blue-700">Hourly Rate:</span>
						<span class="font-bold text-blue-700">${paystubData.hourly_rate.toFixed(2)}/hr</span>
					</div>
				{/if}

				<!-- Line Items -->
				{#if paystubData.line_items && paystubData.line_items.length > 0}
					<div class="pt-2 mt-2 border-t border-gray-100">
						<p class="text-xs text-gray-500 uppercase tracking-wide mb-2">Work Days ({paystubData.line_items.filter(li => li.type === 'regular').length} shifts)</p>
						<div class="space-y-1">
							{#each paystubData.line_items as item}
								<div class="flex justify-between text-sm {item.type === 'overtime' ? 'text-amber-700 bg-amber-50 px-1 rounded' : ''}">
									<span class="text-gray-600">
										{item.date}
										{#if item.type === 'overtime'}<span class="text-xs">(OT)</span>{/if}
									</span>
									<span class="text-gray-700">{item.hours}h @ ${item.rate} = ${item.amount.toFixed(2)}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Deductions -->
				{#if paystubData.federal_tax || paystubData.provincial_tax || paystubData.cpp || paystubData.ei || paystubData.union_dues || paystubData.pension_contribution}
					<div class="pt-2 mt-2 border-t border-gray-100">
						<p class="text-xs text-gray-500 uppercase tracking-wide mb-1">Deductions</p>
						{#if paystubData.federal_tax}
							<div class="flex justify-between text-sm">
								<span class="text-gray-500">Federal Tax:</span>
								<span class="text-gray-700">${paystubData.federal_tax.toFixed(2)}</span>
							</div>
						{/if}
						{#if paystubData.provincial_tax}
							<div class="flex justify-between text-sm">
								<span class="text-gray-500">Provincial Tax:</span>
								<span class="text-gray-700">${paystubData.provincial_tax.toFixed(2)}</span>
							</div>
						{/if}
						{#if paystubData.cpp}
							<div class="flex justify-between text-sm">
								<span class="text-gray-500">CPP:</span>
								<span class="text-gray-700">${paystubData.cpp.toFixed(2)}</span>
							</div>
						{/if}
						{#if paystubData.ei}
							<div class="flex justify-between text-sm">
								<span class="text-gray-500">EI:</span>
								<span class="text-gray-700">${paystubData.ei.toFixed(2)}</span>
							</div>
						{/if}
						{#if paystubData.union_dues}
							<div class="flex justify-between text-sm">
								<span class="text-gray-500">Union Dues:</span>
								<span class="text-gray-700">${paystubData.union_dues.toFixed(2)}</span>
							</div>
						{/if}
						{#if paystubData.pension_contribution}
							<div class="flex justify-between text-sm">
								<span class="text-gray-500">Pension:</span>
								<span class="text-gray-700">${paystubData.pension_contribution.toFixed(2)}</span>
							</div>
						{/if}
					</div>
				{/if}

				<!-- What will happen -->
				<div class="bg-gray-50 rounded-lg p-3 text-sm">
					<p class="font-medium text-gray-700 mb-1">This will:</p>
					<ul class="text-gray-600 space-y-0.5">
						{#if paystubData.line_items && paystubData.line_items.length > 0}
							{@const uniqueDates = new Set(paystubData.line_items.map(li => li.date))}
							<li>- Create {uniqueDates.size} work entries from paystub dates</li>
						{/if}
						{#if paystubData.hourly_rate}
							<li>- Update day rate to ${paystubData.hourly_rate.toFixed(2)}/hr</li>
						{/if}
						{#if paystubData.total_hours}
							<li>- Add {paystubData.total_hours} hrs to career total</li>
						{/if}
						<li>- Save paystub to Documents</li>
					</ul>
				</div>
			</div>

			<div class="grid grid-cols-2 gap-3 flex-shrink-0 pt-3 border-t border-gray-200">
				<button
					onclick={() => { showPaystubModal = false; paystubData = null; paystubFile = null; }}
					class="py-2 border border-gray-300 rounded-lg text-gray-700"
				>
					Cancel
				</button>
				<button
					onclick={savePaystubAndUpdateRates}
					class="py-2 bg-blue-600 text-white rounded-lg font-medium"
				>
					Save & Update
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Processing Paystub Indicator -->
{#if processingPaystub}
	<div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[60]">
		<div class="card w-full max-w-xs text-center py-8">
			<div class="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
			<p class="text-gray-700 font-medium">Reading paystub...</p>
			<p class="text-sm text-gray-500">Extracting pay info with AI</p>
		</div>
	</div>
{/if}
