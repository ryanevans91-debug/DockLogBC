<script lang="ts">
	import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
	import { Filesystem, Directory } from '@capacitor/filesystem';
	import { goto } from '$app/navigation';
	import { documents } from '$lib/stores';

	let saving = $state(false);
	let error = $state<string | null>(null);

	async function takeAndSave() {
		error = null;
		try {
			const photo = await Camera.getPhoto({
				quality: 90,
				allowEditing: false,
				resultType: CameraResultType.DataUrl,
				source: CameraSource.Camera
			});

			if (photo.dataUrl) {
				await saveDocument(photo.dataUrl);
			}
		} catch (err) {
			// User cancelled or error occurred
			console.error('Camera error:', err);
			if (err instanceof Error && !err.message.includes('cancelled')) {
				error = 'Camera access failed. Please try again.';
			}
		}
	}

	async function pickAndSave() {
		error = null;
		try {
			const photo = await Camera.getPhoto({
				quality: 90,
				allowEditing: false,
				resultType: CameraResultType.DataUrl,
				source: CameraSource.Photos
			});

			if (photo.dataUrl) {
				await saveDocument(photo.dataUrl);
			}
		} catch (err) {
			console.error('Gallery error:', err);
			if (err instanceof Error && !err.message.includes('cancelled')) {
				error = 'Could not access photos. Please try again.';
			}
		}
	}

	async function saveDocument(dataUrl: string) {
		if (saving) return;
		saving = true;
		error = null;

		try {
			// Generate document name based on date and time
			const now = new Date();
			const date = now.toLocaleDateString('en-CA');
			const time = now.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false }).replace(':', '');
			const docName = `Document - ${date} ${time}`;

			// Extract base64 data (remove data URL prefix)
			const base64Data = dataUrl.split(',')[1];

			// Save image to filesystem
			const fileName = `doc_${Date.now()}.jpg`;
			const savedFile = await Filesystem.writeFile({
				path: `documents/${fileName}`,
				data: base64Data,
				directory: Directory.Data,
				recursive: true
			});

			// Save to database
			await documents.add({
				name: docName,
				type: 'image',
				file_path: savedFile.uri || `documents/${fileName}`,
				file_size: null,
				mime_type: 'image/jpeg',
				category: 'other',
				extracted_data: null,
				notes: null
			});

			// Navigate to documents page
			goto('/documents');
		} catch (err) {
			console.error('Save error:', err);
			error = 'Failed to save document. Please try again.';
			saving = false;
		}
	}
</script>

<div class="p-4 pb-24 space-y-4">
	<header class="flex items-center gap-3 mb-4">
		<a href="/" class="p-2 -ml-2 text-gray-500 hover:text-gray-700">
			<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
				<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
			</svg>
		</a>
		<h1 class="text-2xl font-bold text-gray-900">Camera</h1>
	</header>

	{#if saving}
		<div class="flex flex-col items-center justify-center py-16">
			<div class="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
			<p class="text-gray-600">Saving document...</p>
		</div>
	{:else}
		<div class="space-y-4">
			<p class="text-gray-600 text-center">Capture manning sheets, toolbox talks, and other work documents</p>

			{#if error}
				<div class="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm text-center">
					{error}
				</div>
			{/if}

			<div class="grid grid-cols-2 gap-3">
				<button
					onclick={takeAndSave}
					class="card-elevated py-8 flex flex-col items-center gap-3 hover:bg-gray-50 transition-colors"
				>
					<div class="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
						<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8 text-blue-600">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
						</svg>
					</div>
					<span class="font-medium text-gray-900">Take Photo</span>
				</button>

				<button
					onclick={pickAndSave}
					class="card-elevated py-8 flex flex-col items-center gap-3 hover:bg-gray-50 transition-colors"
				>
					<div class="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center">
						<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8 text-purple-600">
							<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
						</svg>
					</div>
					<span class="font-medium text-gray-900">From Gallery</span>
				</button>
			</div>
		</div>
	{/if}
</div>
