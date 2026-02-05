<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { entries, ratedJobs, formatCurrency, timeOff } from '$lib/stores';
	import type { Entry, TimeOff } from '$lib/db';
	import { getStatHolidaysForYear, type StatHoliday } from '$lib/constants/statHolidays';

	// Calendar state
	let currentDate = $state(new Date());
	let monthEntries = $state<Entry[]>([]);
	let monthTimeOff = $state<TimeOff[]>([]);
	let monthStatHolidays = $state<StatHoliday[]>([]);
	let selectedDate = $state<string | null>(null);
	let lastClickTime = $state(0);
	let lastClickDate = $state<string | null>(null);

	// Computed values
	let currentMonth = $derived(currentDate.getMonth());
	let currentYear = $derived(currentDate.getFullYear());
	let monthName = $derived(currentDate.toLocaleString('default', { month: 'long', year: 'numeric' }));

	// Get days in month
	let daysInMonth = $derived(new Date(currentYear, currentMonth + 1, 0).getDate());
	let firstDayOfMonth = $derived(new Date(currentYear, currentMonth, 1).getDay());

	// Create calendar grid
	let calendarDays = $derived(() => {
		const days: (number | null)[] = [];
		// Add empty cells for days before the 1st
		for (let i = 0; i < firstDayOfMonth; i++) {
			days.push(null);
		}
		// Add days of the month
		for (let i = 1; i <= daysInMonth; i++) {
			days.push(i);
		}
		return days;
	});

	// Helper to create consistent date string
	function makeDateString(year: number, month: number, day: number): string {
		return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
	}

	// Get entries for a specific date - compare just the date part
	function getEntriesForDate(day: number): Entry[] {
		const dateStr = makeDateString(currentYear, currentMonth, day);
		return monthEntries.filter(e => {
			// Ensure we're comparing just the date string (YYYY-MM-DD)
			const entryDate = e.date.split('T')[0]; // In case it has time component
			return entryDate === dateStr;
		});
	}

	// Handle calendar day click - single click selects, double click opens
	function handleDayClick(day: number, dayEntries: Entry[]) {
		const dateStr = makeDateString(currentYear, currentMonth, day);
		const now = Date.now();
		const isDoubleClick = (now - lastClickTime < 300) && (lastClickDate === dateStr);

		lastClickTime = now;
		lastClickDate = dateStr;

		if (isDoubleClick) {
			// Double click - open entry (existing or new)
			if (dayEntries.length > 0) {
				goto(`/entry/${dayEntries[0].id}`);
			} else {
				goto(`/entry?date=${dateStr}`);
			}
		} else {
			// Single click - just select it
			selectedDate = dateStr;
		}
	}

	// Get time off for a specific date
	function getTimeOffForDate(day: number): TimeOff | null {
		const dateStr = makeDateString(currentYear, currentMonth, day);
		return monthTimeOff.find(t => t.date === dateStr) || null;
	}

	// Get stat holiday for a specific date
	function getStatHolidayForDate(day: number): StatHoliday | null {
		const dateStr = makeDateString(currentYear, currentMonth, day);
		return monthStatHolidays.find(h => h.date === dateStr) || null;
	}

	// Check if date has entries
	function hasEntries(day: number): boolean {
		return getEntriesForDate(day).length > 0;
	}

	// Get total earnings for a day
	function getDayEarnings(day: number): number {
		return getEntriesForDate(day).reduce((sum, e) => sum + (e.earnings || 0), 0);
	}

	// This week's entries
	let thisWeekEntries = $derived(() => {
		const today = new Date();
		const dayOfWeek = today.getDay();
		const startOfWeek = new Date(today);
		startOfWeek.setDate(today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1)); // Monday

		const weekDays: { date: Date; entries: Entry[] }[] = [];
		for (let i = 0; i < 7; i++) {
			const date = new Date(startOfWeek);
			date.setDate(startOfWeek.getDate() + i);
			const dateStr = date.toISOString().split('T')[0];
			weekDays.push({
				date,
				entries: $entries.filter(e => e.date === dateStr)
			});
		}
		return weekDays;
	});

	// Navigation
	function prevMonth() {
		currentDate = new Date(currentYear, currentMonth - 1, 1);
	}

	function nextMonth() {
		currentDate = new Date(currentYear, currentMonth + 1, 1);
	}

	function goToToday() {
		currentDate = new Date();
	}

	// Load entries when month changes
	$effect(() => {
		loadMonthEntries();
	});

	async function loadMonthEntries() {
		const startDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
		const endDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
		monthEntries = await entries.loadDateRange(startDate, endDate);
		// Load time off for this month
		await timeOff.load();
		monthTimeOff = $timeOff.filter(t => {
			return t.date >= startDate && t.date <= endDate;
		});
		// Load stat holidays for this month
		const yearHolidays = getStatHolidaysForYear(currentYear);
		monthStatHolidays = yearHolidays.filter(h => {
			return h.date >= startDate && h.date <= endDate;
		});
	}

	// Get job name for entry
	function getJobName(entry: Entry): string {
		if (entry.job_type === 'hall') {
			return entry.hall_job_name || 'Hall Job';
		}
		const job = $ratedJobs.find(j => j.id === entry.rated_job_id);
		return job?.name || 'Rated Job';
	}

	// Format short date
	function formatShortDate(date: Date): string {
		return date.toLocaleDateString('default', { weekday: 'short', day: 'numeric' });
	}

	// Check if date is today
	function isToday(day: number): boolean {
		const today = new Date();
		return day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();
	}

	onMount(() => {
		loadMonthEntries();
	});
</script>

<div class="p-4 pb-24 space-y-4">
	<header class="mb-2">
		<h1 class="text-2xl font-bold text-gray-900">Calendar</h1>
	</header>

	<!-- Month navigation -->
	<div class="flex items-center justify-between mb-4">
		<button onclick={prevMonth} aria-label="Previous month" class="p-2 hover:bg-gray-100 rounded-lg">
			<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
			</svg>
		</button>
		<div class="text-center">
			<h2 class="text-lg font-semibold text-gray-900">{monthName}</h2>
			<button onclick={goToToday} class="text-xs text-blue-600">Today</button>
		</div>
		<button onclick={nextMonth} aria-label="Next month" class="p-2 hover:bg-gray-100 rounded-lg">
			<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
			</svg>
		</button>
	</div>

	<!-- Calendar grid -->
	<div class="card">
		<!-- Day headers -->
		<div class="grid grid-cols-7 gap-1 mb-2">
			{#each ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as day}
				<div class="text-center text-xs font-medium text-gray-500 py-1">{day}</div>
			{/each}
		</div>

		<!-- Calendar days -->
		<div class="grid grid-cols-7 gap-1">
			{#each calendarDays() as day}
				{#if day === null}
					<div class="aspect-square"></div>
				{:else}
					{@const dayEntries = getEntriesForDate(day)}
					{@const hasWork = dayEntries.length > 0}
					{@const dayEarnings = getDayEarnings(day)}
					{@const dateStr = makeDateString(currentYear, currentMonth, day)}
					{@const isSelected = selectedDate === dateStr}
					{@const dayTimeOff = getTimeOffForDate(day)}
					{@const isVacation = dayTimeOff?.type === 'vacation'}
					{@const isSick = dayTimeOff?.type === 'sick'}
					{@const statHoliday = getStatHolidayForDate(day)}
					<button
						onclick={() => handleDayClick(day, dayEntries)}
						class="aspect-square flex flex-col items-center justify-center rounded-lg text-sm transition-colors relative
							{isToday(day) ? 'ring-2 ring-blue-600' : ''}
							{isSelected && !hasWork ? 'border-2 border-green-500' : ''}
							{isSelected && hasWork ? 'bg-blue-600 text-white ring-2 ring-green-500' : ''}
							{hasWork && !isSelected ? 'bg-blue-600 text-white' : ''}
							{statHoliday && !hasWork && !isSelected ? 'border-2 border-purple-400' : ''}
							{isVacation && !hasWork && !statHoliday && !isSelected ? 'border-2 border-amber-400' : ''}
							{isSick && !hasWork && !statHoliday && !isSelected ? 'border-2 border-red-400' : ''}
							{!hasWork && !isVacation && !isSick && !statHoliday && !isSelected ? 'hover:bg-gray-100' : ''}"
						title={statHoliday ? statHoliday.name : ''}
					>
						<span class="font-medium">{day}</span>
						{#if hasWork}
							<span class="text-[10px] opacity-90">{formatCurrency(dayEarnings).replace('CA$', '$')}</span>
						{:else if statHoliday}
							<span class="text-[8px] text-purple-700 leading-tight text-center truncate w-full px-0.5">{statHoliday.name.split(' ')[0]}</span>
						{:else if isVacation}
							<span class="text-[12px]">🏖️</span>
						{:else if isSick}
							<span class="text-[12px]">🤒</span>
						{/if}
					</button>
				{/if}
			{/each}
		</div>
	</div>

	<!-- This Week section -->
	<div>
		<h3 class="text-lg font-semibold text-gray-900 mb-3">This Week</h3>
		<div class="grid grid-cols-7 gap-2">
			{#each thisWeekEntries() as { date, entries: dayEntries }}
				{@const hasWork = dayEntries.length > 0}
				{@const isCurrentDay = date.toDateString() === new Date().toDateString()}
				<div
					class="aspect-square rounded-lg p-1 flex flex-col
						{isCurrentDay ? 'ring-2 ring-blue-600' : ''}
						{hasWork ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50 border border-gray-200'}"
				>
					<span class="text-[10px] text-gray-500 text-center">
						{date.toLocaleDateString('default', { weekday: 'short' })}
					</span>
					<span class="text-xs font-medium text-center {hasWork ? 'text-blue-600' : 'text-gray-400'}">
						{date.getDate()}
					</span>
					{#if hasWork}
						<div class="flex-1 flex flex-col justify-end overflow-hidden">
							<span class="text-[8px] text-gray-600 truncate text-center">
								{getJobName(dayEntries[0])}
							</span>
							<span class="text-[10px] font-semibold text-green-600 text-center">
								{formatCurrency(dayEntries.reduce((s, e) => s + (e.earnings || 0), 0)).replace('CA$', '$')}
							</span>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<!-- Recent entries list -->
	{#if monthEntries.length > 0}
		<div>
			<h3 class="text-lg font-semibold text-gray-900 mb-3">This Month's Entries</h3>
			<div class="space-y-2">
				{#each monthEntries.slice(0, 10) as entry}
					<button
						onclick={() => goto(`/entry/${entry.id}`)}
						class="card w-full text-left flex justify-between items-center"
					>
						<div>
							<p class="font-medium text-gray-900">{getJobName(entry)}</p>
							<p class="text-sm text-gray-500">
								{new Date(entry.date).toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' })}
								&middot; {entry.hours} hrs &middot; {entry.shift_type}
							</p>
						</div>
						<span class="text-green-600 font-semibold">{formatCurrency(entry.earnings || 0)}</span>
					</button>
				{/each}
			</div>
		</div>
	{:else}
		<div class="card text-center py-8">
			<p class="text-gray-500">No entries for this month</p>
			<a href="/entry" class="text-blue-600 text-sm mt-2 inline-block">Add your first entry</a>
		</div>
	{/if}
</div>
