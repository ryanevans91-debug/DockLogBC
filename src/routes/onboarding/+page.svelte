<script lang="ts">
	import { goto } from '$app/navigation';
	import { user, ratedJobs } from '$lib/stores';
	import { SHIFTS } from '$lib/db';

	let step = $state(1);
	const totalSteps = 4;

	// Step 1: Basic info
	let lastName = $state('');
	let firstName = $state('');
	let manNumber = $state('');
	let currentBoard = $state('');

	// Step 2: Hourly rates
	let dayRate = $state<number | null>(null);
	let afternoonRate = $state<number | null>(null);
	let graveyardRate = $state<number | null>(null);

	// Step 3: Targets
	let averageHoursTarget = $state(600);
	let pensionTarget = $state<number | null>(null);

	// Step 4: Rated jobs
	let newJobName = $state('');
	let newJobHourType = $state<'none' | 'extra' | 'big'>('none'); // mutually exclusive
	let newJobMealHour = $state(false);
	let addedJobs = $state<Array<{ name: string; has_extra_hour: boolean; is_big_hour: boolean; has_meal_hour: boolean }>>([]);

	// Validation
	let step1Valid = $derived(lastName.trim() !== '' && firstName.trim() !== '' && manNumber.trim() !== '');
	let step2Valid = $derived(dayRate !== null && dayRate > 0);

	function nextStep() {
		if (step < totalSteps) {
			step++;
		}
	}

	function prevStep() {
		if (step > 1) {
			step--;
		}
	}

	function addJob() {
		if (newJobName.trim()) {
			addedJobs = [...addedJobs, {
				name: newJobName.trim(),
				has_extra_hour: newJobHourType === 'extra',
				is_big_hour: newJobHourType === 'big',
				has_meal_hour: newJobMealHour
			}];
			newJobName = '';
			newJobHourType = 'none';
			newJobMealHour = false;
		}
	}

	function removeJob(index: number) {
		addedJobs = addedJobs.filter((_, i) => i !== index);
	}

	async function completeOnboarding() {
		try {
			// Create user
			await user.create({
				last_name: lastName.trim(),
				first_name: firstName.trim(),
				man_number: manNumber.trim(),
				current_board: currentBoard.trim() || null,
				day_rate: dayRate,
				afternoon_rate: afternoonRate,
				graveyard_rate: graveyardRate,
				average_hours_target: averageHoursTarget,
				pension_target: pensionTarget,
				career_hours: 0
			});

			// Add rated jobs
			for (const job of addedJobs) {
				await ratedJobs.add(job);
			}

			// Navigate to dashboard
			goto('/');
		} catch (error) {
			console.error('Onboarding error:', error);
			alert('Failed to save profile. Please try again.');
		}
	}
</script>

<div class="min-h-screen bg-gray-50 p-4">
	<!-- Header -->
	<div class="mb-8">
		<h1 class="text-2xl font-bold text-gray-900">Welcome to DockLogBC</h1>
		<p class="text-gray-600 mt-1">Let's set up your profile</p>

		<!-- Progress indicator -->
		<div class="flex gap-2 mt-4">
			{#each Array(totalSteps) as _, i}
				<div
					class="h-1 flex-1 rounded-full transition-colors {i < step ? 'bg-blue-600' : 'bg-gray-200'}"
				></div>
			{/each}
		</div>
		<p class="text-sm text-gray-500 mt-2">Step {step} of {totalSteps}</p>
	</div>

	<!-- Step 1: Basic Info -->
	{#if step === 1}
		<div class="space-y-4">
			<h2 class="text-lg font-semibold text-gray-900">Basic Information</h2>

			<div>
				<label for="lastName" class="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
				<input
					id="lastName"
					type="text"
					bind:value={lastName}
					placeholder="Morrison"
					class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
				/>
			</div>

			<div>
				<label for="firstName" class="block text-sm font-medium text-gray-700 mb-1">First Name</label>
				<input
					id="firstName"
					type="text"
					bind:value={firstName}
					placeholder="Ryan"
					class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
				/>
				<p class="text-xs text-gray-500 mt-1">You'll be shown as "{firstName || 'Ryan'} {lastName || 'Morrison'}"</p>
			</div>

			<div>
				<label for="manNumber" class="block text-sm font-medium text-gray-700 mb-1">Man Number</label>
				<input
					id="manNumber"
					type="text"
					bind:value={manNumber}
					placeholder="12345"
					class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
				/>
			</div>

			<div>
				<label for="currentBoard" class="block text-sm font-medium text-gray-700 mb-1">Current Board <span class="text-gray-400">(optional)</span></label>
				<input
					id="currentBoard"
					type="text"
					bind:value={currentBoard}
					placeholder="A"
					class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
				/>
			</div>
		</div>
	{/if}

	<!-- Step 2: Hourly Rates -->
	{#if step === 2}
		<div class="space-y-4">
			<h2 class="text-lg font-semibold text-gray-900">Hourly Rates</h2>
			<p class="text-sm text-gray-600">Enter your hourly rates for each shift type</p>

			<div class="card">
				<div class="flex justify-between items-center mb-2">
					<span class="font-medium text-gray-900">{SHIFTS.day.name} Shift</span>
					<span class="text-sm text-gray-500">{SHIFTS.day.start} - {SHIFTS.day.end}</span>
				</div>
				<div class="relative">
					<span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
					<input
						type="number"
						step="0.01"
						bind:value={dayRate}
						placeholder="0.00"
						class="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
					/>
				</div>
			</div>

			<div class="card">
				<div class="flex justify-between items-center mb-2">
					<span class="font-medium text-gray-900">{SHIFTS.afternoon.name} Shift</span>
					<span class="text-sm text-gray-500">{SHIFTS.afternoon.start} - {SHIFTS.afternoon.end}</span>
				</div>
				<div class="relative">
					<span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
					<input
						type="number"
						step="0.01"
						bind:value={afternoonRate}
						placeholder="0.00"
						class="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
					/>
				</div>
			</div>

			<div class="card">
				<div class="flex justify-between items-center mb-2">
					<span class="font-medium text-gray-900">{SHIFTS.graveyard.name} Shift</span>
					<span class="text-sm text-gray-500">{SHIFTS.graveyard.start} - {SHIFTS.graveyard.end}</span>
				</div>
				<div class="relative">
					<span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
					<input
						type="number"
						step="0.01"
						bind:value={graveyardRate}
						placeholder="0.00"
						class="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
					/>
				</div>
			</div>
		</div>
	{/if}

	<!-- Step 3: Targets -->
	{#if step === 3}
		<div class="space-y-4">
			<h2 class="text-lg font-semibold text-gray-900">Goals & Targets</h2>

			<div class="card">
				<label for="avgHours" class="block font-medium text-gray-900 mb-1">Average Hours Target</label>
				<p class="text-sm text-gray-500 mb-2">Hours needed for board move eligibility</p>
				<input
					id="avgHours"
					type="number"
					bind:value={averageHoursTarget}
					placeholder="600"
					class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
				/>
			</div>

			<div class="card">
				<label for="pension" class="block font-medium text-gray-900 mb-1">Pensionable Year Target <span class="text-gray-400">(optional)</span></label>
				<p class="text-sm text-gray-500 mb-2">Annual earnings target for pension credit</p>
				<div class="relative">
					<span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
					<input
						id="pension"
						type="number"
						step="0.01"
						bind:value={pensionTarget}
						placeholder="0.00"
						class="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
					/>
				</div>
			</div>
		</div>
	{/if}

	<!-- Step 4: Rated Jobs -->
	{#if step === 4}
		<div class="space-y-4">
			<h2 class="text-lg font-semibold text-gray-900">Rated Jobs</h2>
			<p class="text-sm text-gray-600">Add your certified jobs (you can add more later)</p>

			<!-- Add job form -->
			<div class="card space-y-3">
				<input
					type="text"
					bind:value={newJobName}
					placeholder="Job name (e.g., Multi-Trailer, Gearman)"
					class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
				/>

				<div class="space-y-2">
					<p class="text-sm font-medium text-gray-700">Hour Bonus (select one):</p>
					<div class="flex flex-col gap-2">
						<label class="flex items-center gap-2">
							<input type="radio" name="hourType" value="none" bind:group={newJobHourType} class="w-4 h-4 text-blue-600" />
							<span class="text-sm text-gray-700">None</span>
						</label>
						<label class="flex items-center gap-2">
							<input type="radio" name="hourType" value="extra" bind:group={newJobHourType} class="w-4 h-4 text-blue-600" />
							<span class="text-sm text-gray-700">+1 Extra Hour</span>
						</label>
						<label class="flex items-center gap-2">
							<input type="radio" name="hourType" value="big" bind:group={newJobHourType} class="w-4 h-4 text-blue-600" />
							<span class="text-sm text-gray-700">Big Hour (1.5x rate)</span>
						</label>
					</div>
				</div>

				<div class="border-t pt-2">
					<label class="flex items-center gap-2">
						<input type="checkbox" bind:checked={newJobMealHour} class="w-5 h-5 rounded text-blue-600" />
						<span class="text-sm text-gray-700">+0.5 Meal Hour</span>
					</label>
				</div>

				<button
					onclick={addJob}
					disabled={!newJobName.trim()}
					class="w-full py-2 rounded-lg font-medium transition-colors
						{newJobName.trim()
							? 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800'
							: 'bg-gray-100 text-gray-400 cursor-not-allowed'}"
				>
					Add Job
				</button>
			</div>

			<!-- Added jobs list -->
			{#if addedJobs.length > 0}
				<div class="space-y-2">
					<p class="text-sm font-medium text-gray-700">Added Jobs:</p>
					{#each addedJobs as job, index}
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
								onclick={() => removeJob(index)}
								class="text-red-500 hover:text-red-700 p-2"
								aria-label="Remove job"
							>
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						</div>
					{/each}
				</div>
			{:else}
				<p class="text-sm text-gray-500 text-center py-4">No jobs added yet. You can skip this step and add jobs later.</p>
			{/if}
		</div>
	{/if}

	<!-- Navigation buttons -->
	<div class="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200 pb-safe">
		<div class="flex gap-3">
			{#if step > 1}
				<button
					onclick={prevStep}
					class="flex-1 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium"
				>
					Back
				</button>
			{/if}

			{#if step < totalSteps}
				<button
					onclick={nextStep}
					disabled={(step === 1 && !step1Valid) || (step === 2 && !step2Valid)}
					class="flex-1 py-3 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
				>
					Continue
				</button>
			{:else}
				<button
					onclick={completeOnboarding}
					class="flex-1 py-3 bg-blue-600 text-white rounded-lg font-medium"
				>
					Complete Setup
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.pb-safe {
		padding-bottom: max(1rem, env(safe-area-inset-bottom));
	}
</style>
