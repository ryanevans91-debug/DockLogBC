<script lang="ts">
	import { onMount } from 'svelte';
	import { shareGroups, whatsappGroups, telegramGroups, documents } from '$lib/stores';
	import { Share } from '@capacitor/share';
	import { Filesystem, Directory } from '@capacitor/filesystem';
	import type { Document, ShareGroup } from '$lib/db';

	let loading = $state(true);
	let showAddGroup = $state(false);
	let showShareModal = $state(false);
	let showConfirmShare = $state(false);

	// Add group form
	let newGroupName = $state('');
	let newGroupPlatform = $state<'whatsapp' | 'telegram'>('whatsapp');
	let newGroupIdentifier = $state('');
	let saving = $state(false);

	// Share selection
	let selectedDocs = $state<number[]>([]);
	let selectedGroups = $state<number[]>([]);

	onMount(async () => {
		await Promise.all([
			shareGroups.load(),
			documents.load()
		]);
		loading = false;
	});

	async function addGroup() {
		if (!newGroupName.trim() || !newGroupIdentifier.trim() || saving) return;

		saving = true;
		try {
			await shareGroups.add({
				name: newGroupName.trim(),
				platform: newGroupPlatform,
				identifier: newGroupIdentifier.trim()
			});

			// Reset form
			newGroupName = '';
			newGroupIdentifier = '';
			newGroupPlatform = 'whatsapp';
			showAddGroup = false;
		} catch (error) {
			console.error('Failed to add group:', error);
			alert('Failed to add group. Please try again.');
		} finally {
			saving = false;
		}
	}

	async function deleteGroup(group: ShareGroup) {
		if (!confirm(`Delete "${group.name}"?`)) return;

		try {
			await shareGroups.remove(group.id);
		} catch (error) {
			console.error('Delete error:', error);
			alert('Failed to delete group.');
		}
	}

	function toggleDocSelection(docId: number) {
		if (selectedDocs.includes(docId)) {
			selectedDocs = selectedDocs.filter(id => id !== docId);
		} else {
			selectedDocs = [...selectedDocs, docId];
		}
	}

	function toggleGroupSelection(groupId: number) {
		if (selectedGroups.includes(groupId)) {
			selectedGroups = selectedGroups.filter(id => id !== groupId);
		} else {
			selectedGroups = [...selectedGroups, groupId];
		}
	}

	function openShareModal() {
		selectedDocs = [];
		selectedGroups = [];
		showShareModal = true;
	}

	function proceedToConfirm() {
		if (selectedDocs.length === 0 || selectedGroups.length === 0) {
			alert('Please select at least one document and one group');
			return;
		}
		showShareModal = false;
		showConfirmShare = true;
	}

	async function shareDocuments() {
		const docsToShare = $documents.filter(d => selectedDocs.includes(d.id));
		const groupsToShare = $shareGroups.filter(g => selectedGroups.includes(g.id));

		// Share to each selected group
		for (const group of groupsToShare) {
			try {
				// For each document, share to the platform
				for (const doc of docsToShare) {
					// Read the file
					let fileUri = doc.file_path;

					// Use Capacitor Share API
					if (group.platform === 'whatsapp') {
						// WhatsApp deep link with share
						await Share.share({
							title: doc.name,
							text: `Sharing: ${doc.name}`,
							url: fileUri,
							dialogTitle: `Share to ${group.name}`
						});
					} else if (group.platform === 'telegram') {
						// Telegram share
						await Share.share({
							title: doc.name,
							text: `Sharing: ${doc.name}`,
							url: fileUri,
							dialogTitle: `Share to ${group.name}`
						});
					}
				}
			} catch (error) {
				console.error('Share error:', error);
			}
		}

		// Reset and close
		selectedDocs = [];
		selectedGroups = [];
		showConfirmShare = false;
	}

	function getSelectedDocNames(): string[] {
		return $documents
			.filter(d => selectedDocs.includes(d.id))
			.map(d => d.name);
	}

	function getSelectedGroupNames(): string[] {
		return $shareGroups
			.filter(g => selectedGroups.includes(g.id))
			.map(g => g.name);
	}
</script>

<div class="p-4 pb-40 space-y-4">
	<header class="flex items-center justify-between mb-4">
		<div class="flex items-center gap-3">
			<a href="/" class="p-2 -ml-2 text-gray-500 hover:text-gray-700">
				<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
				</svg>
			</a>
			<h1 class="text-2xl font-bold text-gray-900">Share</h1>
		</div>
	</header>

	{#if loading}
		<div class="flex justify-center py-8">
			<div class="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
		</div>
	{:else}
		<!-- Share Documents Button -->
		{#if $documents.length > 0 && $shareGroups.length > 0}
			<button
				onclick={openShareModal}
				class="w-full card-elevated bg-green-600 text-white py-4 flex items-center justify-center gap-2"
			>
				<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
				</svg>
				<span class="font-semibold">Share Documents</span>
			</button>
		{/if}

		<!-- WhatsApp Groups -->
		<section>
			<div class="flex justify-between items-center mb-3">
				<h2 class="text-lg font-semibold text-gray-900 flex items-center gap-2">
					<span class="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" class="w-4 h-4">
							<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
						</svg>
					</span>
					WhatsApp Groups
				</h2>
			</div>

			{#if $whatsappGroups.length === 0}
				<div class="card text-center py-6 text-gray-500">
					<p>No WhatsApp groups added</p>
				</div>
			{:else}
				<div class="space-y-2">
					{#each $whatsappGroups as group}
						<div class="card flex items-center justify-between">
							<div>
								<p class="font-medium text-gray-900">{group.name}</p>
								<p class="text-sm text-gray-500">{group.identifier}</p>
							</div>
							<button
								onclick={() => deleteGroup(group)}
								class="p-2 text-red-500 hover:text-red-700"
							>
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
								</svg>
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Telegram Groups -->
		<section>
			<div class="flex justify-between items-center mb-3">
				<h2 class="text-lg font-semibold text-gray-900 flex items-center gap-2">
					<span class="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" class="w-4 h-4">
							<path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
						</svg>
					</span>
					Telegram Groups
				</h2>
			</div>

			{#if $telegramGroups.length === 0}
				<div class="card text-center py-6 text-gray-500">
					<p>No Telegram groups added</p>
				</div>
			{:else}
				<div class="space-y-2">
					{#each $telegramGroups as group}
						<div class="card flex items-center justify-between">
							<div>
								<p class="font-medium text-gray-900">{group.name}</p>
								<p class="text-sm text-gray-500 truncate max-w-[200px]">{group.identifier}</p>
							</div>
							<button
								onclick={() => deleteGroup(group)}
								class="p-2 text-red-500 hover:text-red-700"
							>
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
								</svg>
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</section>

	{/if}
</div>

<!-- Add Group Button (fixed above nav) -->
<div class="fixed left-4 right-4 z-30 bottom-navbar">
	<button
		onclick={() => showAddGroup = true}
		class="w-full card-elevated bg-blue-600 text-white py-4 text-center font-semibold shadow-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
	>
		<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5">
			<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
		</svg>
		Add Group
	</button>
</div>

<style>
	.bottom-navbar {
		bottom: calc(4rem + env(safe-area-inset-bottom));
	}
</style>

<!-- Add Group Modal -->
{#if showAddGroup}
	<div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
		<div class="card w-full max-w-sm">
			<h2 class="text-lg font-semibold text-gray-900 mb-4">Add Group</h2>

			<div class="space-y-4">
				<div>
					<label class="block text-sm font-medium text-gray-700 mb-1">Platform</label>
					<div class="grid grid-cols-2 gap-2">
						<button
							onclick={() => newGroupPlatform = 'whatsapp'}
							class="py-2 rounded-lg text-sm font-medium transition-colors
								{newGroupPlatform === 'whatsapp' ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-700'}"
						>
							WhatsApp
						</button>
						<button
							onclick={() => newGroupPlatform = 'telegram'}
							class="py-2 rounded-lg text-sm font-medium transition-colors
								{newGroupPlatform === 'telegram' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700'}"
						>
							Telegram
						</button>
					</div>
				</div>

				<div>
					<label class="block text-sm font-medium text-gray-700 mb-1">Group Name</label>
					<input
						type="text"
						bind:value={newGroupName}
						placeholder="e.g., Dock Workers Group"
						class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
					/>
				</div>

				<div>
					<label class="block text-sm font-medium text-gray-700 mb-1">
						{newGroupPlatform === 'whatsapp' ? 'Phone Number' : 'Group Link'}
					</label>
					<input
						type="text"
						bind:value={newGroupIdentifier}
						placeholder={newGroupPlatform === 'whatsapp' ? '+1234567890' : 'https://t.me/groupname'}
						class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
					/>
					<p class="text-xs text-gray-500 mt-1">
						{newGroupPlatform === 'whatsapp'
							? 'Enter the group admin phone number with country code'
							: 'Enter the Telegram group invite link'}
					</p>
				</div>
			</div>

			<div class="grid grid-cols-2 gap-3 mt-6">
				<button
					onclick={() => { showAddGroup = false; newGroupName = ''; newGroupIdentifier = ''; }}
					class="py-2 border border-gray-300 rounded-lg text-gray-700"
				>
					Cancel
				</button>
				<button
					onclick={addGroup}
					disabled={!newGroupName.trim() || !newGroupIdentifier.trim() || saving}
					class="py-2 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-50"
				>
					{saving ? 'Adding...' : 'Add'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Share Selection Modal -->
{#if showShareModal}
	<div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
		<div class="card w-full max-w-sm max-h-[80vh] overflow-y-auto">
			<h2 class="text-lg font-semibold text-gray-900 mb-4">Select Documents & Groups</h2>

			<!-- Document Selection -->
			<div class="mb-4">
				<p class="text-sm font-medium text-gray-700 mb-2">Documents ({selectedDocs.length} selected)</p>
				<div class="space-y-2 max-h-40 overflow-y-auto">
					{#each $documents as doc}
						<label class="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
							<input
								type="checkbox"
								checked={selectedDocs.includes(doc.id)}
								onchange={() => toggleDocSelection(doc.id)}
								class="w-4 h-4 rounded text-blue-600"
							/>
							<span class="text-sm text-gray-900 truncate">{doc.name}</span>
						</label>
					{/each}
				</div>
			</div>

			<!-- Group Selection -->
			<div class="mb-4">
				<p class="text-sm font-medium text-gray-700 mb-2">Groups ({selectedGroups.length} selected)</p>
				<div class="space-y-2 max-h-40 overflow-y-auto">
					{#each $shareGroups as group}
						<label class="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
							<input
								type="checkbox"
								checked={selectedGroups.includes(group.id)}
								onchange={() => toggleGroupSelection(group.id)}
								class="w-4 h-4 rounded text-blue-600"
							/>
							<span class="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0
								{group.platform === 'whatsapp' ? 'bg-green-500' : 'bg-blue-500'}">
								<span class="text-white text-xs">{group.platform === 'whatsapp' ? 'W' : 'T'}</span>
							</span>
							<span class="text-sm text-gray-900 truncate">{group.name}</span>
						</label>
					{/each}
				</div>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<button
					onclick={() => showShareModal = false}
					class="py-2 border border-gray-300 rounded-lg text-gray-700"
				>
					Cancel
				</button>
				<button
					onclick={proceedToConfirm}
					disabled={selectedDocs.length === 0 || selectedGroups.length === 0}
					class="py-2 bg-green-600 text-white rounded-lg font-medium disabled:opacity-50"
				>
					Continue
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Confirm Share Modal -->
{#if showConfirmShare}
	<div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
		<div class="card w-full max-w-sm">
			<h2 class="text-lg font-semibold text-gray-900 mb-4">Confirm Share</h2>

			<div class="space-y-4">
				<div class="p-3 bg-gray-50 rounded-lg">
					<p class="text-sm font-medium text-gray-700 mb-1">
						Sharing {selectedDocs.length} document{selectedDocs.length !== 1 ? 's' : ''}:
					</p>
					<ul class="text-sm text-gray-600">
						{#each getSelectedDocNames() as name}
							<li class="truncate">• {name}</li>
						{/each}
					</ul>
				</div>

				<div class="p-3 bg-gray-50 rounded-lg">
					<p class="text-sm font-medium text-gray-700 mb-1">
						To {selectedGroups.length} group{selectedGroups.length !== 1 ? 's' : ''}:
					</p>
					<ul class="text-sm text-gray-600">
						{#each getSelectedGroupNames() as name}
							<li class="truncate">• {name}</li>
						{/each}
					</ul>
				</div>
			</div>

			<div class="grid grid-cols-2 gap-3 mt-6">
				<button
					onclick={() => { showConfirmShare = false; showShareModal = true; }}
					class="py-2 border border-gray-300 rounded-lg text-gray-700"
				>
					Back
				</button>
				<button
					onclick={shareDocuments}
					class="py-2 bg-green-600 text-white rounded-lg font-medium"
				>
					Share
				</button>
			</div>
		</div>
	</div>
{/if}
