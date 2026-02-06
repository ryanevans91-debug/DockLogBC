<script lang="ts">
	import { onMount } from 'svelte';
	import { documents, documentCounts, user, shareGroups, whatsappGroups, telegramGroups } from '$lib/stores';
	import { Filesystem, Directory } from '@capacitor/filesystem';
	import { Share } from '@capacitor/share';
	import type { Document, ShareGroup } from '$lib/db';
	import { parsePaystubWithClaude, getAnthropicApiKey, type ParsedPaystubData } from '$lib/utils/ai';
	import { Browser } from '@capacitor/browser';

	let loading = $state(true);
	let selectedCategory = $state<string | null>(null);

	// Multi-select state
	let selectMode = $state(false);
	let selectedDocs = $state<number[]>([]);
	let sharing = $state(false);
	let longPressTriggered = $state(false);
	let showUploadModal = $state(false);
	let fileInputRef = $state<HTMLInputElement | null>(null);

	// Thumbnail previews cache
	let thumbnails = $state<Record<number, string>>({});

	// Share to groups modal
	let showShareGroupsModal = $state(false);
	let selectedGroups = $state<number[]>([]);

	// Preview modal
	let showPreviewModal = $state(false);
	let previewDoc = $state<Document | null>(null);
	let previewImageSrc = $state<string | null>(null);

	function triggerFileInput() {
		fileInputRef?.click();
	}
	let showVerifyModal = $state(false);
	let uploadedFile = $state<{ name: string; data: string; mimeType: string } | null>(null);
	let extractedData = $state<Record<string, string | number | null>>({});
	let parsingWithAI = $state(false);
	let docName = $state('');
	let docCategory = $state('timesheet');
	let docNotes = $state('');
	let saving = $state(false);

	const categories = [
		{ value: 'manning_sheet', label: 'Manning Sheets', icon: 'clipboard' },
		{ value: 'toolbox_talk', label: 'Toolbox Talks', icon: 'chat' },
		{ value: 'vacation_pay', label: 'Vacation Pay', icon: 'calendar' },
		{ value: 'pay_stub', label: 'Pay Stubs', icon: 'currency' },
		{ value: 'timesheet', label: 'Timesheets', icon: 'clock' },
		{ value: 'other', label: 'Other', icon: 'document' }
	];

	onMount(async () => {
		await Promise.all([
			documents.load(),
			shareGroups.load()
		]);
		loading = false;
		// Load thumbnails for image documents
		loadThumbnails();
	});

	async function loadThumbnails() {
		const docs = $documents.filter(d => d.type === 'image');
		for (const doc of docs) {
			try {
				let file;
				const fileName = doc.file_path.split('/').pop();

				// Try multiple path formats
				if (doc.file_path.startsWith('file://') || doc.file_path.includes('://')) {
					try {
						file = await Filesystem.readFile({
							path: doc.file_path
						});
					} catch {
						// Try documents folder
						file = await Filesystem.readFile({
							path: `documents/${fileName}`,
							directory: Directory.Data
						});
					}
				} else {
					// Try documents folder
					file = await Filesystem.readFile({
						path: `documents/${fileName}`,
						directory: Directory.Data
					});
				}

				const mimeType = doc.mime_type || 'image/jpeg';
				thumbnails[doc.id] = `data:${mimeType};base64,${file.data}`;
			} catch (error) {
				// File might not exist or be inaccessible
				console.error('Thumbnail load error for', doc.id, error);
			}
		}
	}

	async function readFileData(doc: Document): Promise<string | null> {
		try {
			let file;
			const fileName = doc.file_path.split('/').pop();

			if (doc.file_path.startsWith('file://') || doc.file_path.includes('://')) {
				try {
					file = await Filesystem.readFile({ path: doc.file_path });
				} catch {
					file = await Filesystem.readFile({ path: `documents/${fileName}`, directory: Directory.Data });
				}
			} else {
				file = await Filesystem.readFile({ path: `documents/${fileName}`, directory: Directory.Data });
			}

			return file.data as string;
		} catch (error) {
			console.error('File read error:', error);
			return null;
		}
	}

	async function openDocument(doc: Document) {
		try {
			if (doc.type === 'pdf') {
				// Open PDF with system viewer via share
				await Share.share({
					files: [doc.file_path],
					dialogTitle: doc.name
				});
				return;
			}

			previewDoc = doc;
			previewImageSrc = null;
			showPreviewModal = true;

			if (doc.type === 'image') {
				// Check if we have a cached thumbnail
				if (thumbnails[doc.id]) {
					previewImageSrc = thumbnails[doc.id];
				} else {
					const base64Data = await readFileData(doc);
					if (base64Data) {
						const mimeType = doc.mime_type || 'image/jpeg';
						previewImageSrc = `data:${mimeType};base64,${base64Data}`;
						thumbnails[doc.id] = previewImageSrc;
					} else {
						previewImageSrc = 'error';
					}
				}
			} else {
				// Fallback - use share
				showPreviewModal = false;
				previewDoc = null;
				await Share.share({
					files: [doc.file_path],
					dialogTitle: doc.name
				});
			}
		} catch (error) {
			console.error('Open document error:', error);
		}
	}

	function filteredDocuments(docs: Document[]) {
		if (!selectedCategory) return docs;
		return docs.filter(d => d.category === selectedCategory);
	}

	async function handleFileUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		// Reset input so same file can be selected again
		input.value = '';

		saving = true;
		const reader = new FileReader();
		reader.onload = async (e) => {
			try {
				const data = e.target?.result as string;

				// Auto-generate document name from filename and date
				const now = new Date();
				const date = now.toLocaleDateString('en-CA');
				const baseName = file.name.replace(/\.[^/.]+$/, '');
				const finalName = `${baseName} - ${date}`;

				// Extract base64 data (remove data URL prefix)
				const base64Data = data.split(',')[1];

				// Save file to filesystem
				const ext = file.type.includes('pdf') ? 'pdf' : 'jpg';
				const fileName = `doc_${Date.now()}.${ext}`;
				const savedFile = await Filesystem.writeFile({
					path: `documents/${fileName}`,
					data: base64Data,
					directory: Directory.Data,
					recursive: true
				});

				// Save to database
				await documents.add({
					name: finalName,
					type: file.type.includes('pdf') ? 'pdf' : 'image',
					file_path: savedFile.uri || `documents/${fileName}`,
					file_size: null,
					mime_type: file.type,
					category: 'other',
					extracted_data: null,
					notes: null
				});
			} catch (error) {
				console.error('Upload error:', error);
				alert('Failed to save document. Please try again.');
			} finally {
				saving = false;
			}
		};
		reader.readAsDataURL(file);
	}

	async function extractDocumentData(data: string, mimeType: string): Promise<Record<string, string | number | null>> {
		// Only process paystubs with AI
		if (docCategory !== 'pay_stub') {
			return {};
		}

		// Check if we have Anthropic API key (user's or from env)
		const apiKey = getAnthropicApiKey($user?.anthropic_api_key);
		if (!apiKey) {
			return {};
		}

		parsingWithAI = true;
		try {
			const result = await parsePaystubWithClaude(apiKey, data);
			if (result.success && result.data && !Array.isArray(result.data)) {
				const paystubData = result.data as ParsedPaystubData;
				// Convert to display-friendly format
				const extracted: Record<string, string | number | null> = {};
				if (paystubData.gross_pay) extracted['Gross Pay'] = `$${paystubData.gross_pay.toFixed(2)}`;
				if (paystubData.net_pay) extracted['Net Pay'] = `$${paystubData.net_pay.toFixed(2)}`;
				if (paystubData.federal_tax) extracted['Federal Tax'] = `$${paystubData.federal_tax.toFixed(2)}`;
				if (paystubData.provincial_tax) extracted['Provincial Tax'] = `$${paystubData.provincial_tax.toFixed(2)}`;
				if (paystubData.cpp) extracted['CPP'] = `$${paystubData.cpp.toFixed(2)}`;
				if (paystubData.ei) extracted['EI'] = `$${paystubData.ei.toFixed(2)}`;
				if (paystubData.union_dues) extracted['Union Dues'] = `$${paystubData.union_dues.toFixed(2)}`;
				if (paystubData.pension_contribution) extracted['Pension'] = `$${paystubData.pension_contribution.toFixed(2)}`;
				if (paystubData.hours_worked) extracted['Hours Worked'] = paystubData.hours_worked;
				if (paystubData.pay_period_start) extracted['Period Start'] = paystubData.pay_period_start;
				if (paystubData.pay_period_end) extracted['Period End'] = paystubData.pay_period_end;
				return extracted;
			}
		} catch (error) {
			console.error('AI extraction error:', error);
		} finally {
			parsingWithAI = false;
		}
		return {};
	}

	async function saveUploadedDocument() {
		if (!uploadedFile || !docName.trim() || saving) return;

		saving = true;

		try {
			// Save file to filesystem
			const ext = uploadedFile.mimeType.includes('pdf') ? 'pdf' : 'jpg';
			const fileName = `doc_${Date.now()}.${ext}`;
			const savedFile = await Filesystem.writeFile({
				path: `documents/${fileName}`,
				data: uploadedFile.data,
				directory: Directory.Data,
				recursive: true
			});

			// Save to database
			await documents.add({
				name: docName.trim(),
				type: uploadedFile.mimeType.includes('pdf') ? 'pdf' : 'image',
				file_path: savedFile.uri || `documents/${fileName}`,
				file_size: null,
				mime_type: uploadedFile.mimeType,
				category: docCategory as any,
				extracted_data: Object.keys(extractedData).length > 0 ? JSON.stringify(extractedData) : null,
				notes: docNotes.trim() || null
			});

			// Reset form
			uploadedFile = null;
			docName = '';
			docCategory = 'timesheet';
			docNotes = '';
			extractedData = {};
			showVerifyModal = false;
		} catch (error) {
			console.error('Save error:', error);
			alert('Failed to save document. Please try again.');
		} finally {
			saving = false;
		}
	}

	async function deleteDocument(doc: Document) {
		if (!confirm(`Delete "${doc.name}"?`)) return;

		try {
			// Delete from filesystem
			try {
				await Filesystem.deleteFile({
					path: doc.file_path,
					directory: Directory.Data
				});
			} catch {
				// File might not exist, continue anyway
			}

			// Delete from database
			await documents.remove(doc.id);
		} catch (error) {
			console.error('Delete error:', error);
			alert('Failed to delete document.');
		}
	}

	function formatDate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString('default', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	// Multi-select functions
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;

	function toggleSelectMode() {
		selectMode = !selectMode;
		if (!selectMode) {
			selectedDocs = [];
		}
	}

	function toggleDocSelection(docId: number) {
		if (selectedDocs.includes(docId)) {
			selectedDocs = selectedDocs.filter(id => id !== docId);
		} else {
			selectedDocs = [...selectedDocs, docId];
		}
	}

	function handlePointerDown(docId: number) {
		longPressTriggered = false;
		longPressTimer = setTimeout(() => {
			longPressTriggered = true;
			// Enter select mode and select this doc
			if (!selectMode) {
				selectMode = true;
			}
			if (!selectedDocs.includes(docId)) {
				selectedDocs = [...selectedDocs, docId];
			}
		}, 500); // 500ms for long press
	}

	function handlePointerUp(doc: Document) {
		if (longPressTimer) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
		// If long press wasn't triggered
		if (!longPressTriggered) {
			if (selectMode) {
				// In select mode, toggle selection
				toggleDocSelection(doc.id);
			} else {
				// Not in select mode, open the document
				openDocument(doc);
			}
		}
	}

	function handlePointerLeave() {
		// Cancel long press if pointer leaves element
		if (longPressTimer) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
	}

	function selectAll() {
		const filtered = filteredDocuments($documents);
		selectedDocs = filtered.map(d => d.id);
	}

	function clearSelection() {
		selectedDocs = [];
	}

	function openShareGroupsModal() {
		if (selectedDocs.length === 0) return;
		selectedGroups = [];
		showShareGroupsModal = true;
	}

	function toggleGroupSelection(groupId: number) {
		if (selectedGroups.includes(groupId)) {
			selectedGroups = selectedGroups.filter(id => id !== groupId);
		} else {
			selectedGroups = [...selectedGroups, groupId];
		}
	}

	async function shareToGroups() {
		if (selectedDocs.length === 0 || selectedGroups.length === 0 || sharing) return;

		sharing = true;
		try {
			const docs = $documents.filter(d => selectedDocs.includes(d.id));
			const groups = $shareGroups.filter(g => selectedGroups.includes(g.id));
			const filePaths = docs.map(d => d.file_path);

			// Share to each selected group via native share
			for (const group of groups) {
				await Share.share({
					files: filePaths,
					dialogTitle: `Share to ${group.name}`
				});
			}

			// Reset selection after share
			selectedDocs = [];
			selectedGroups = [];
			selectMode = false;
			showShareGroupsModal = false;
		} catch (error) {
			console.error('Share error:', error);
			// User may have cancelled, don't show error
		} finally {
			sharing = false;
		}
	}
</script>

<div class="p-4 pb-40 space-y-4">
	<header class="flex items-center gap-3 mb-4">
		{#if selectMode}
			<button onclick={toggleSelectMode} class="p-2 -ml-2 text-gray-500 hover:text-gray-700">
				<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
			<h1 class="text-2xl font-bold text-gray-900">{selectedDocs.length} selected</h1>
		{:else}
			<a href="/" class="p-2 -ml-2 text-gray-500 hover:text-gray-700">
				<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
				</svg>
			</a>
			<h1 class="text-2xl font-bold text-gray-900">Documents</h1>
		{/if}
	</header>

	{#if loading}
		<div class="flex justify-center py-8">
			<div class="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
		</div>
	{:else}
		<!-- Filter + Actions -->
		<div class="flex items-center gap-2">
			<span class="px-3 py-1.5 bg-blue-600 text-white rounded-full text-sm font-medium">
				All ({$documents.length})
			</span>
			<div class="flex-1"></div>
			{#if selectMode}
				<button
					onclick={selectedDocs.length === filteredDocuments($documents).length ? clearSelection : selectAll}
					class="px-3 py-1.5 text-sm font-medium text-blue-600 whitespace-nowrap"
				>
					{selectedDocs.length === filteredDocuments($documents).length ? 'Clear' : 'Select All'}
				</button>
			{:else}
				{#if $documents.length > 0}
					<button
						onclick={toggleSelectMode}
						class="px-3 py-1.5 text-sm font-medium text-gray-600 whitespace-nowrap"
					>
						Select
					</button>
				{/if}
				<button
					onclick={triggerFileInput}
					class="p-2 bg-blue-600 text-white rounded-lg flex-shrink-0"
					aria-label="Add document"
				>
					<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
					</svg>
				</button>
			{/if}
		</div>

		<!-- Documents List -->
		{#if filteredDocuments($documents).length === 0}
			<div class="flex-1 flex items-center justify-center min-h-[50vh]">
				<button
					onclick={triggerFileInput}
					class="card text-center py-8 w-full max-w-xs hover:bg-gray-50 transition-colors cursor-pointer"
				>
					<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-12 h-12 mx-auto text-gray-300 mb-3">
						<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
					</svg>
					<p class="text-gray-500">No documents yet</p>
					<p class="text-sm text-gray-400 mt-1">Tap to add documents</p>
				</button>
			</div>
		{:else}
			<div class="grid grid-cols-4 gap-2">
				{#each filteredDocuments($documents) as doc}
					<button
						onpointerdown={() => handlePointerDown(doc.id)}
						onpointerup={() => handlePointerUp(doc)}
						onpointerleave={handlePointerLeave}
						oncontextmenu={(e: Event) => e.preventDefault()}
						class="aspect-square bg-white rounded-lg border border-gray-200 flex flex-col items-center justify-center transition-colors select-none relative overflow-hidden
							{selectMode && selectedDocs.includes(doc.id) ? 'ring-2 ring-blue-500' : ''}"
					>
						{#if selectMode && selectedDocs.includes(doc.id)}
							<div class="absolute top-1 right-1 w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center z-10">
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="white" class="w-3 h-3">
									<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
								</svg>
							</div>
						{/if}
						<!-- Thumbnail preview or icon -->
						<div class="flex-1 w-full flex items-center justify-center overflow-hidden">
							{#if doc.type === 'image' && thumbnails[doc.id]}
								<img src={thumbnails[doc.id]} alt={doc.name} class="w-full h-full object-cover" />
							{:else if doc.type === 'pdf'}
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-10 h-10 text-red-500">
									<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
								</svg>
							{:else}
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-10 h-10 text-blue-500">
									<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
								</svg>
							{/if}
						</div>
						<p class="text-xs text-gray-700 text-center truncate w-full px-1 py-1 bg-white/90">{doc.name}</p>
						{#if !selectMode}
							<button
								onclick={(e) => { e.stopPropagation(); deleteDocument(doc); }}
								class="absolute top-0 right-0 p-1 text-red-500 hover:text-red-700 bg-white/80 rounded-bl"
							>
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3 h-3">
									<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<!-- Share Card (fixed above nav) - always shows same text -->
<div class="fixed left-4 right-4 z-30 bottom-navbar">
	<button
		onclick={selectMode && selectedDocs.length > 0 ? openShareGroupsModal : () => { selectMode = true; }}
		class="w-full card flex items-center gap-3 py-3 px-4 shadow-lg {selectMode && selectedDocs.length > 0 ? 'bg-green-600' : ''}"
	>
		<div class="w-10 h-10 {selectMode && selectedDocs.length > 0 ? 'bg-green-500' : 'bg-blue-100'} rounded-xl flex items-center justify-center flex-shrink-0">
			<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 {selectMode && selectedDocs.length > 0 ? 'text-white' : 'text-blue-600'}">
				<path stroke-linecap="round" stroke-linejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
			</svg>
		</div>
		<div class="flex-1 min-w-0 text-left">
			<h3 class="font-medium {selectMode && selectedDocs.length > 0 ? 'text-white' : 'text-gray-900'}">WhatsApp / Telegram</h3>
			<p class="text-sm {selectMode && selectedDocs.length > 0 ? 'text-green-100' : 'text-gray-500'}">
				{selectMode && selectedDocs.length > 0 ? `${selectedDocs.length} selected - tap to share` : 'Share docs to work groups'}
			</p>
		</div>
		<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5 {selectMode && selectedDocs.length > 0 ? 'text-white' : 'text-gray-400'} flex-shrink-0">
			<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
		</svg>
	</button>
</div>

<!-- Upload Modal -->
{#if showUploadModal}
	<div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
		<div class="card w-full max-w-sm">
			<h2 class="text-lg font-semibold text-gray-900 mb-4">Upload Document</h2>
			<p class="text-sm text-gray-600 mb-4">Upload timesheets, pay stubs, or other work documents</p>

			<label class="block w-full py-8 border-2 border-dashed border-gray-300 rounded-lg text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
				<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8 mx-auto text-gray-400 mb-2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
				</svg>
				<span class="text-sm text-gray-600">Tap to select file</span>
				<input
					type="file"
					accept="image/*,.pdf"
					onchange={handleFileUpload}
					class="hidden"
				/>
			</label>

			<button
				onclick={() => showUploadModal = false}
				class="w-full mt-4 py-2 border border-gray-300 rounded-lg text-gray-700"
			>
				Cancel
			</button>
		</div>
	</div>
{/if}

<!-- Verify Extracted Data Modal -->
{#if showVerifyModal && uploadedFile}
	<div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
		<div class="card w-full max-w-sm max-h-[80vh] overflow-y-auto">
			<h2 class="text-lg font-semibold text-gray-900 mb-4">Verify Document</h2>

			<div class="space-y-4">
				<div>
					<label class="block text-sm font-medium text-gray-700 mb-1">Document Name</label>
					<input
						type="text"
						bind:value={docName}
						class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
					/>
				</div>

				<div>
					<label class="block text-sm font-medium text-gray-700 mb-1">Category</label>
					<select
						bind:value={docCategory}
						class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
					>
						{#each categories as cat}
							<option value={cat.value}>{cat.label}</option>
						{/each}
					</select>
				</div>

				{#if Object.keys(extractedData).length > 0}
					<div class="p-3 bg-amber-50 border border-amber-200 rounded-lg">
						<p class="text-sm font-medium text-amber-800 mb-2">Extracted Information</p>
						{#each Object.entries(extractedData) as [key, value]}
							<div class="flex justify-between text-sm">
								<span class="text-gray-600">{key}:</span>
								<span class="text-gray-900">{value}</span>
							</div>
						{/each}
					</div>
				{/if}

				<div>
					<label class="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
					<textarea
						bind:value={docNotes}
						rows="2"
						class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
					></textarea>
				</div>
			</div>

			<div class="grid grid-cols-2 gap-3 mt-6">
				<button
					onclick={() => { showVerifyModal = false; uploadedFile = null; }}
					class="py-2 border border-gray-300 rounded-lg text-gray-700"
				>
					Cancel
				</button>
				<button
					onclick={saveUploadedDocument}
					disabled={!docName.trim() || saving}
					class="py-2 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-50"
				>
					{saving ? 'Saving...' : 'Save'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Hidden file input for direct upload -->
<input
	type="file"
	accept="image/*,.pdf"
	bind:this={fileInputRef}
	onchange={handleFileUpload}
	class="hidden"
/>

<!-- Share to Groups Modal -->
{#if showShareGroupsModal}
	<div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
		<div class="card w-full max-w-sm max-h-[80vh] overflow-hidden flex flex-col">
			<h2 class="text-lg font-semibold text-gray-900 mb-2">Share to Groups</h2>
			<p class="text-sm text-gray-600 mb-4">
				Sharing {selectedDocs.length} document{selectedDocs.length !== 1 ? 's' : ''}
			</p>

			{#if $shareGroups.length === 0}
				<div class="text-center py-8">
					<p class="text-gray-500 mb-4">No groups added yet</p>
					<a href="/share" class="text-blue-600 font-medium">Add groups in Share settings</a>
				</div>
			{:else}
				<div class="flex-1 overflow-y-auto space-y-2 mb-4">
					<!-- WhatsApp Groups -->
					{#if $whatsappGroups.length > 0}
						<p class="text-xs font-medium text-gray-500 uppercase tracking-wide">WhatsApp</p>
						{#each $whatsappGroups as group}
							<label class="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors
								{selectedGroups.includes(group.id) ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:bg-gray-50'}">
								<input
									type="checkbox"
									checked={selectedGroups.includes(group.id)}
									onchange={() => toggleGroupSelection(group.id)}
									class="w-5 h-5 rounded text-green-600"
								/>
								<span class="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" class="w-4 h-4">
										<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
									</svg>
								</span>
								<span class="text-gray-900 font-medium">{group.name}</span>
							</label>
						{/each}
					{/if}

					<!-- Telegram Groups -->
					{#if $telegramGroups.length > 0}
						<p class="text-xs font-medium text-gray-500 uppercase tracking-wide mt-4">Telegram</p>
						{#each $telegramGroups as group}
							<label class="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors
								{selectedGroups.includes(group.id) ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}">
								<input
									type="checkbox"
									checked={selectedGroups.includes(group.id)}
									onchange={() => toggleGroupSelection(group.id)}
									class="w-5 h-5 rounded text-blue-600"
								/>
								<span class="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" class="w-4 h-4">
										<path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
									</svg>
								</span>
								<span class="text-gray-900 font-medium">{group.name}</span>
							</label>
						{/each}
					{/if}
				</div>

				<div class="grid grid-cols-2 gap-3 pt-4 border-t">
					<button
						onclick={() => { showShareGroupsModal = false; selectedGroups = []; }}
						class="py-2 border border-gray-300 rounded-lg text-gray-700"
					>
						Cancel
					</button>
					<button
						onclick={shareToGroups}
						disabled={selectedGroups.length === 0 || sharing}
						class="py-2 bg-green-600 text-white rounded-lg font-medium disabled:opacity-50"
					>
						{sharing ? 'Sharing...' : `Share to ${selectedGroups.length || ''} Group${selectedGroups.length !== 1 ? 's' : ''}`}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<!-- Document Preview Modal -->
{#if showPreviewModal && previewDoc}
	<div class="fixed inset-0 bg-black/90 flex items-center justify-center z-50">
		<button
			onclick={() => { showPreviewModal = false; previewDoc = null; previewImageSrc = null; }}
			class="absolute top-4 right-4 p-2 text-white hover:bg-white/20 rounded-full z-10"
			aria-label="Close preview"
		>
			<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-8 h-8">
				<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
			</svg>
		</button>

		<div class="w-full h-full flex flex-col items-center justify-center p-4">
			{#if previewImageSrc === 'error'}
				<div class="text-center">
					<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-16 h-16 text-gray-400 mx-auto mb-4">
						<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
					</svg>
					<p class="text-gray-400">Could not load file</p>
				</div>
			{:else if previewImageSrc && previewImageSrc.startsWith('data:')}
				<img
					src={previewImageSrc}
					alt={previewDoc.name}
					class="max-w-full max-h-[80vh] object-contain rounded-lg"
				/>
			{:else}
				<div class="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
			{/if}
			<p class="text-white text-center mt-4 text-lg font-medium">{previewDoc.name}</p>

			<!-- Action buttons -->
			<div class="flex gap-4 mt-4">
				<button
					onclick={async () => {
						if (previewDoc) {
							await Share.share({
								files: [previewDoc.file_path],
								dialogTitle: previewDoc.name
							});
						}
					}}
					class="px-4 py-2 bg-white/20 text-white rounded-lg flex items-center gap-2"
				>
					<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
					</svg>
					Share
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.bottom-navbar {
		bottom: calc(4rem + env(safe-area-inset-bottom));
	}
</style>
