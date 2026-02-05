<script lang="ts">
	import { user, ratedJobs, theme, entries, type ThemeMode } from '$lib/stores';
	import { SHIFTS } from '$lib/db';

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

	function triggerCsvImport() {
		csvInputRef?.click();
	}

	function triggerPaystubUpload() {
		paystubInputRef?.click();
	}

	async function handlePaystubUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		input.value = '';

		// For now, just save the paystub as a document
		try {
			const { Filesystem, Directory } = await import('@capacitor/filesystem');
			const { documents } = await import('$lib/stores');

			const reader = new FileReader();
			reader.onload = async (e) => {
				const data = e.target?.result as string;
				const base64Data = data.split(',')[1];

				const ext = file.type.includes('pdf') ? 'pdf' : 'jpg';
				const fileName = `paystub_${Date.now()}.${ext}`;

				const savedFile = await Filesystem.writeFile({
					path: `documents/${fileName}`,
					data: base64Data,
					directory: Directory.Data,
					recursive: true
				});

				await documents.add({
					name: `Pay Stub - ${new Date().toLocaleDateString('en-CA')}`,
					type: ext === 'pdf' ? 'pdf' : 'image',
					file_path: savedFile.uri || `documents/${fileName}`,
					file_size: null,
					mime_type: file.type,
					category: 'pay_stub',
					extracted_data: null,
					notes: null
				});

				alert('Paystub saved to Documents!');
			};
			reader.readAsDataURL(file);
		} catch (error) {
			console.error('Paystub upload error:', error);
			alert('Failed to upload paystub. Please try again.');
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

<div class="p-4 pb-24 space-y-6">
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
					<p class="text-sm text-gray-500">Save paystub to documents</p>
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

	<!-- App Info -->
	<section class="text-center text-sm text-gray-400 pt-4">
		<p>DockLogger v1.0.0</p>
		<p>Made for ILWU Local 502</p>
	</section>
</div>
