<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import NavBar from '$lib/components/NavBar.svelte';
	import { onMount } from 'svelte';
	import { database, initializeSchema } from '$lib/db';
	import { user, ratedJobs, theme } from '$lib/stores';
	import { loadStatHolidaysFromDb } from '$lib/constants/statHolidays';
	import { page } from '$app/stores';
	import { Capacitor } from '@capacitor/core';

	let { children } = $props();

	let initialized = $state(false);
	let error = $state<string | null>(null);

	// Routes that don't need the NavBar (like onboarding)
	const hideNavRoutes = ['/onboarding'];
	let showNav = $derived(!hideNavRoutes.includes($page.url.pathname));

	onMount(async () => {
		try {
			// For web platform, need to set up jeep-sqlite custom element
			if (Capacitor.getPlatform() === 'web') {
				console.log('Setting up jeep-sqlite for web...');
				const jeepModule = await import('jeep-sqlite/loader');
				await jeepModule.defineCustomElements(window);

				// Create and add jeep-sqlite element to DOM
				const jeepEl = document.createElement('jeep-sqlite');
				document.body.appendChild(jeepEl);
				await customElements.whenDefined('jeep-sqlite');

				// Wait for jeep-sqlite to be ready
				const jeepSqliteEl = document.querySelector('jeep-sqlite');
				if (jeepSqliteEl) {
					await (jeepSqliteEl as any).isStoreOpen();
				}
				console.log('jeep-sqlite ready');
			}

			// Initialize database
			console.log('Initializing database...');
			await database.initialize();
			console.log('Database initialized, setting up schema...');
			await initializeSchema();

			// Load user data
			console.log('Loading user data...');
			await user.load();
			await ratedJobs.load();
			await loadStatHolidaysFromDb();

			// Initialize theme
			theme.init();

			console.log('App initialization complete');
			initialized = true;
		} catch (err) {
			console.error('App initialization error:', err);
			error = err instanceof Error ? err.message : 'Failed to initialize app';
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="default" />
	<title>DockLogBC</title>
</svelte:head>

{#if error}
	<div class="min-h-screen flex items-center justify-center p-4">
		<div class="card-elevated text-center max-w-md">
			<h1 class="text-xl font-bold text-red-600 mb-2">Initialization Error</h1>
			<p class="text-gray-600 mb-4">{error}</p>
			<button
				onclick={() => window.location.reload()}
				class="px-4 py-2 bg-blue-600 text-white rounded-lg"
			>
				Retry
			</button>
		</div>
	</div>
{:else if !initialized}
	<div class="min-h-screen flex items-center justify-center">
		<div class="text-center">
			<div class="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
			<p class="text-gray-600">Loading DockLogBC...</p>
		</div>
	</div>
{:else}
	<main class="min-h-screen main-padding">
		{@render children()}
	</main>

	{#if showNav}
		<NavBar />
	{/if}
{/if}

<style>
	.main-padding {
		padding-bottom: calc(5rem + env(safe-area-inset-bottom, 0px));
	}
</style>
