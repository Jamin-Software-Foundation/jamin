import { createVoices } from "./voices.js";

let neoukeDevice = null;
let audioCtx = null;
let beatCounter = null;
let mixer = null;
const mixerState = Object.fromEntries(['drums', 'bass', 'chords', 'voice1', 'voice2', 'master'].map(name => [name, { volume: 1, muted: false }]));

function getAudio() {
	if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
	return audioCtx;
}

function ensureMixer() {
	if (mixer) return mixer;
	getAudio();
	mixer = {};
	for (const name of Object.keys(mixerState)) {
		mixer[name] = audioCtx.createGain();
		mixer[name].gain.value = mixerState[name].muted ? 0 : mixerState[name].volume;
	}
	mixer.master.connect(audioCtx.destination);
	for (const name of ['drums', 'bass', 'chords', 'voice1', 'voice2']) mixer[name].connect(mixer.master);
	return mixer;
}

const mixerUpdaters = {};

for (const name of Object.keys(mixerState)) {
	const slider = document.getElementById(`volume-${name}`);
	const mute = document.getElementById(`mute-${name}`);
	const update = () => {
		document.getElementById(`level-${name}`).textContent = `${Math.round(mixerState[name].volume * 100)}%`;
		mute.setAttribute('aria-pressed', String(mixerState[name].muted));
		if (mixer) mixer[name].gain.setValueAtTime(mixerState[name].muted ? 0 : mixerState[name].volume, audioCtx.currentTime);
	};
	mixerUpdaters[name] = () => { slider.value = Math.round(mixerState[name].volume * 100); update(); };
	slider.addEventListener('input', () => { mixerState[name].volume = Number(slider.value) / 100; update(); });
	mute.addEventListener('click', () => { mixerState[name].muted = !mixerState[name].muted; update(); });
}

const voices = createVoices(getAudio, ensureMixer, logger);

document.getElementById('btn-scan-sf2').addEventListener('click', () => {
	if (rootDirHandle) voices.scan(rootDirHandle);
});

let recalling = false;
let soloActive = false;
let variationRequested = false;
let rootDirHandle = null;
let selectedStyleInfo = null;
let styleLoading = false;

let currentProject = 0;
let currentChordRoot = 0;
let currentBassRoot = 0;
let currentChordType = "Maj";
	
let barDuration = null;
let barStartTime = null;
let currentVariation = 0;
let altVariation = false;
let introEnding = 2;
let currentDrumKey = null;
let endingScheduled = false;
let endingNode = null;

let isPlaying = false;
let activeSources = [];
let tempo = 120;

let midiAccess = null;
let activeNotes = new Map(); // Tracks currently held keys: noteNum -> timestamp
let chordAnalysisTimeout = null;

const noteNames	 	= ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const variations 	= ['ARRA', 'ARRB', 'ARRC', 'ARRD', 'ARRA_1', 'ARRB_1', 'ARRC_1', 'ARRD_1'];
const fills 		= ['FILA', 'FILB', 'FILC', 'FILD'];
const breaks 		= ['BRKA', 'BRKB', 'BRKC', 'BRKD'];			
const intros 		= ['INT1', 'INT2', 'INT3'];
const endings 		= ['END1', 'END2', 'END3'];		

// Separate collections to preserve architectural clarity
let loopAudioBuffers = {
	drums: {},
	bass: {}, 
	chords: {}
};		

function logger(msg) {
	const win = document.getElementById('log-window');
	const line = document.createElement('div');
	line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
	win.appendChild(line);
	win.scrollTop = win.scrollHeight;
	document.getElementById('engine-status').textContent = msg;
}

document.getElementById('btn-link-dir').addEventListener('click', async () => {
	try {
		if (!window.showDirectoryPicker) throw new Error('Folder access requires a supported Chromium browser in a secure context.');
		const root = await window.showDirectoryPicker({ mode: 'readwrite', id: 'vibe-arranger'  });
		document.getElementById('btn-link-dir').disabled = true;
		if (isPlaying) stopArranger();
		rootDirHandle = root;
		voices.cancelScan();
		selectedStyleInfo = null;
		loopAudioBuffers = { drums: {}, bass: {}, chords: {} };
		document.getElementById('btn-play').disabled = true;
		document.getElementById('btn-parse').disabled = true;
		document.getElementById('style-name').textContent = 'SELECT A STYLE';
		document.getElementById('style-category').textContent = 'No category';
		document.getElementById('style-tempo').textContent = '';
		document.getElementById('btn-scan-sf2').disabled = false;
		document.getElementById('txt-dir').innerText = `Linked: ${rootDirHandle.name}/`;
		getAudio();
		styleGroups = new Map();
		styleView.open = null;
		await scanStyleFolderDeep(root);
		renderStyles();
		voices.scan(root);
	} catch (err) {
		if (err.name !== 'AbortError') {
			document.getElementById('txt-dir').textContent = `Folder error: ${err.message}`;
			logger(`Folder error: ${err.message}`);
		}
	} finally {
		document.getElementById('btn-link-dir').disabled = false;
	}
});

let styleGroups = new Map();
const styleView = { open: null };

async function scanStyleFolderDeep(folderHandle, currentPath = "") {
	let count = 0;
	const entries = [];
	for await (const entry of folderHandle.values()) entries.push(entry);
	entries.sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		if (entry.kind === 'directory') {
			const subPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
			count += await scanStyleFolderDeep(entry, subPath);
		} else if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.kst')) {
			count++;
			const genre = currentPath || "Root";
			if (!styleGroups.has(genre)) styleGroups.set(genre, []);
			styleGroups.get(genre).push(entry);
		}
	}
	return count;
}

function selectStyle(entry, genre) {
	if (styleLoading) return Promise.resolve();
	if (isPlaying) stopArranger();
	selectedStyleInfo = { handle: entry, path: genre, name: entry.name };
	highlightSelection();
	return loadSelectedStyle();
}

function renderStyles() {
	const groups = [...styleGroups].sort((a, b) => a[0].localeCompare(b[0])).map(([name, entries]) => ({
		name,
		items: entries.map(entry => ({
			label: entry.name, title: `${name}/${entry.name}`,
			selected: selectedStyleInfo?.handle === entry,
			onClick: () => selectStyle(entry, name)
		}))
	}));
	window.renderTwoLevel(document.getElementById('kst-items'), styleView, groups, 'No KST styles found.');
}

function highlightSelection() {
	document.getElementById('style-name').textContent = selectedStyleInfo.name.replace(/\.kst$/i, '');
	document.getElementById('style-category').textContent = selectedStyleInfo.path;
	document.getElementById('btn-play').disabled = true;
	document.getElementById('btn-parse').disabled = false;
	logger(`Target file targeted: ${selectedStyleInfo.name}`);
	renderStyles();
}

async function loadSelectedStyle() {
	if (!selectedStyleInfo || styleLoading) return;
	if (isPlaying) stopArranger();
	styleLoading = true;
	document.getElementById('btn-play').disabled = true;
	document.getElementById('btn-link-dir').disabled = true;
	document.getElementById('btn-parse').disabled = true;
	document.querySelectorAll('#kst-items button').forEach(button => button.disabled = true);
	logger(`Reading file buffer bytes from: ${selectedStyleInfo.name}...`);
	
	try {
		const file = await selectedStyleInfo.handle.getFile();
		const buffer = await file.arrayBuffer();
		loopAudioBuffers = {drums: {}, bass: {}, chords: {}};
		await executeFixedBlockKshpParse(buffer);
	} catch (error) {
		document.getElementById('style-tempo').textContent = `Load failed: ${error.message}`;
		logger(`Style load failed: ${error.message}`);
		console.error('Style load failed:', error);
	} finally {
		styleLoading = false;
		document.getElementById('btn-link-dir').disabled = false;
		document.getElementById('btn-parse').disabled = false;
		document.querySelectorAll('#kst-items button').forEach(button => button.disabled = false);
	}
}

document.getElementById('btn-parse').addEventListener('click', loadSelectedStyle);

async function executeFixedBlockKshpParse(buffer) {
	const view = new DataView(buffer);
	logger(`Data Payload Loaded: ${buffer.byteLength} total bytes.`);

	let extractedBpm = 120;
	for (let i = 0; i < buffer.byteLength - 6; i++) {
		if (view.getUint8(i) === 0xFF && view.getUint8(i+1) === 0x51 && view.getUint8(i+2) === 0x03) {
			const microSecs = (view.getUint8(i+3) << 16) | (view.getUint8(i+4) << 8) | view.getUint8(i+5);
			if (microSecs > 0) {
				extractedBpm = Math.round(60000000 / microSecs);
				logger(`🎯 MIDI Tempo chunk verified. Extracted Base Speed: ${extractedBpm} BPM.`);
			}
			break;
		}
	}
	tempo = extractedBpm;

	logger("Extracting memory slot characters...");
	
	let drumFolder = "Not found";
	let bassFolder = ["Not found", "Not found", "Not found", "Not found"];
	let chordFolder = ["Not found", "Not found", "Not found", "Not found"];
	
	let origin = findStringInDecoderlessBuffer(buffer, "/media/USBACK/USER_MODELING/LiveDrum/");
	
	if (origin >= 0) {
		drumFolder = getStringFromBuffer(buffer, origin + 37);
		for (let f in bassFolder) bassFolder[f] = getStringFromBuffer(buffer, origin + 2542 + (f * 80));	
		for (let f in chordFolder) chordFolder[f] = getStringFromBuffer(buffer, origin + 3022 + (f * 80));
	} else throw new Error('LiveDrum path not found in KST; this style format is not supported.');

	document.getElementById('out-tempo').innerText = `${extractedBpm} BPM`;
	document.getElementById('style-tempo').textContent = `${extractedBpm} BPM`;
	document.getElementById('out-drum').innerText = `USER_MODELING/LiveDrum/${drumFolder}`;
	
	document.getElementById('out-bass1').innerText = `USER_MODELING/RealBass/${bassFolder[0]}`;
	document.getElementById('out-bass2').innerText = `USER_MODELING/RealBass/${bassFolder[1]}`;
	document.getElementById('out-bass3').innerText = `USER_MODELING/RealBass/${bassFolder[2]}`;
	document.getElementById('out-bass4').innerText = `USER_MODELING/RealBass/${bassFolder[3]}`;
	
	document.getElementById('out-chord1').innerText = `USER_MODELING/RealChord/${chordFolder[0]}`;
	document.getElementById('out-chord2').innerText = `USER_MODELING/RealChord/${chordFolder[1]}`;
	document.getElementById('out-chord3').innerText = `USER_MODELING/RealChord/${chordFolder[2]}`;
	document.getElementById('out-chord4').innerText = `USER_MODELING/RealChord/${chordFolder[3]}`;
	
	logger(`✅ Verification complete. Loop directory paths linked and ready.`);
	
	await scanAndLoadBuffers(drumFolder, bassFolder, chordFolder);
}

function getStringFromBuffer(buffer, offset, length = null, encoding = 'utf-8') {
  const fullView = new Uint8Array(buffer);
  let stringView;

  if (length !== null) {
	// Approach A: Extract using a known, fixed length
	stringView = fullView.subarray(offset, offset + length);
  } else {
	// Approach B: Read until a null-terminator (0x00) if length is unknown
	let end = offset;
	while (end < fullView.length && fullView[end] !== 0) {
	  end++;
	}
	stringView = fullView.subarray(offset, end);
  }

  // Decode the specific subarray into a JavaScript string
  return new TextDecoder(encoding).decode(stringView);
}
		
function findStringInDecoderlessBuffer(buffer, searchString) {
  const view = new Uint8Array(buffer);
  const encoder = new TextEncoder();
  const searchBytes = encoder.encode(searchString); // Target sequence

  if (searchBytes.length === 0) return -1;
  if (searchBytes.length > view.length) return -1;

  // Scan through the Uint8Array byte-by-byte
  for (let i = 0; i <= view.length - searchBytes.length; i++) {
	let match = true;
	
	for (let j = 0; j < searchBytes.length; j++) {
	  if (view[i + j] !== searchBytes[j]) {
		match = false;
		break;
	  }
	}
	
	// If a full matching sequence is found, return the byte offset index
	if (match) return i; 
  }

  return -1; // Not found
}

async function scanAndLoadBuffers(drumFolder, bassFolders, chordFolders) {
	logger("Engine Populating......");   
	const playButton = document.querySelector("#btn-play");
	playButton.disabled = true;
	playButton.style.background = "#555"; 	

	const parts = drumFolder.split("_");
	const drumTempo = parseInt(parts[parts.length - 1]);
	
	if (Number.isFinite(drumTempo) && drumTempo > 0 && drumTempo != tempo){
		logger("Tempo mismatch!!! Using drums tempo " + drumTempo);   
		tempo = drumTempo;			
	}

	beatCounter = new BeatCounterWidget('#beat-counter-container', audioCtx, { bpm: tempo, beatsPerBar: 4});						
	
	const instrument = ["drums", "bass", "chords"];
	const folderHandles = [];		
	
	let drumDirHandle, bassDirHandle, chordDirHandle;
	let userModelingHandle = await rootDirHandle.getDirectoryHandle('USER_MODELING', { create: false });	


	try {
		drumDirHandle = await userModelingHandle.getDirectoryHandle('LiveDrum', { create: false });	
		folderHandles[0] = [];
		folderHandles[0][0] = await drumDirHandle.getDirectoryHandle(drumFolder, { create: false });		
	} catch (e) {
		throw new Error("Missing LiveDrum folder: " + e.message);
	}
	
	try {
		bassDirHandle = await userModelingHandle.getDirectoryHandle('RealBass', { create: false });	
		folderHandles[1] = [];					
		for (const i in bassFolders) if (bassFolders[i] != "") folderHandles[1][i] = await bassDirHandle.getDirectoryHandle(bassFolders[i], { create: false });		
	} catch (e) {
		//throw new Error("Missing RealBass folder: " + e.message);
		console.warn("Missing RealBass Folder");		
	}

	try {
		chordDirHandle = await userModelingHandle.getDirectoryHandle('RealChord', { create: false });
		folderHandles[2] = [];			
		for (const i in chordFolders) if (chordFolders[i] != "") folderHandles[2][i] = await chordDirHandle.getDirectoryHandle(chordFolders[i], { create: false });								
	} catch (e) {
		//throw new Error("Missing RealChord folder: " + e.message);
		console.warn("Missing RealChord Folder");
	}									
	
	for (const i in folderHandles) {
		const handles = folderHandles[i];
		
		for (const j in handles) {
			const folderHandle = handles[j];
			
			for await (const handle of folderHandle.values()) {
				const fileName = handle.name.toLowerCase();
				
				if (handle.kind === 'file' && (fileName.endsWith('.wav') || fileName.endsWith('.ogg') || fileName.endsWith('.flac'))) {
					let keyName;
					
					if (i == 0) {
						keyName = handle.name.toUpperCase().split(".")[0];
					}
					else
					
					if (i == 1) {
						keyName = j + "_" + handle.name.toUpperCase().split(".")[0];
					}
					else
					
					if (i == 2) {
						keyName = j + "_" + handle.name.toUpperCase().split(".")[0];
					}	
					
					if (keyName) {
						let audioData = loopAudioBuffers[instrument[i]][keyName];	
						
						if (!audioData) {
							const file = await handle.getFile();
							const buffer = await file.arrayBuffer();								
							audioData = await audioCtx.decodeAudioData(buffer);
							loopAudioBuffers[instrument[i]][keyName] = audioData;									
						}
					}							
				}
			}	
		}
	}
	
	// check for missing intro and endings
	
	for (let v=0; v<4; v++) {
		let keyName;
		
		for (let c=0; c<12; c++) {
			keyName = v + "_BIN_MAJ_" + noteNames[c];
			if (!loopAudioBuffers["bass"][keyName]) loopAudioBuffers["bass"][keyName] = loopAudioBuffers["bass"][v + "_BMAJ_" + noteNames[c]];
			if (!loopAudioBuffers["bass"][keyName]) loopAudioBuffers["bass"][keyName] = loopAudioBuffers["bass"][v + "_BMAJ_" + noteNames[c]];	

			keyName = v + "_BIN_MIN_" + noteNames[c];
			if (!loopAudioBuffers["bass"][keyName]) loopAudioBuffers["bass"][keyName] = loopAudioBuffers["bass"][v + "_BMIN_" + noteNames[c]];
			if (!loopAudioBuffers["bass"][keyName]) loopAudioBuffers["bass"][keyName] = loopAudioBuffers["bass"][v + "_BMIN_" + noteNames[c]];	

			keyName = v + "_BEN_MAJ_" + noteNames[c];
			if (!loopAudioBuffers["bass"][keyName]) loopAudioBuffers["bass"][keyName] = loopAudioBuffers["bass"][v + "_BMAJ_" + noteNames[c]];
			if (!loopAudioBuffers["bass"][keyName]) loopAudioBuffers["bass"][keyName] = loopAudioBuffers["bass"][v + "_BMAJ_" + noteNames[c]];	

			keyName = v + "_BEN_MIN_" + noteNames[c];
			if (!loopAudioBuffers["bass"][keyName]) loopAudioBuffers["bass"][keyName] = loopAudioBuffers["bass"][v + "_BMIN_" + noteNames[c]];
			if (!loopAudioBuffers["bass"][keyName]) loopAudioBuffers["bass"][keyName] = loopAudioBuffers["bass"][v + "_BMIN_" + noteNames[c]];	

			// Chords
			
			keyName = v + "_IN_MAJ_" + noteNames[c];
			if (!loopAudioBuffers["chords"][keyName]) loopAudioBuffers["chords"][keyName] = loopAudioBuffers["chords"][v + "_MAJ_" + noteNames[c]];
			if (!loopAudioBuffers["chords"][keyName]) loopAudioBuffers["chords"][keyName] = loopAudioBuffers["chords"][v + "_MAJ_" + noteNames[c]];	

			keyName = v + "_IN_MIN_" + noteNames[c];
			if (!loopAudioBuffers["chords"][keyName]) loopAudioBuffers["chords"][keyName] = loopAudioBuffers["chords"][v + "_MIN_" + noteNames[c]];
			if (!loopAudioBuffers["chords"][keyName]) loopAudioBuffers["chords"][keyName] = loopAudioBuffers["chords"][v + "_MIN_" + noteNames[c]];	

			keyName = v + "_EN_MAJ_" + noteNames[c];
			if (!loopAudioBuffers["chords"][keyName]) loopAudioBuffers["chords"][keyName] = loopAudioBuffers["chords"][v + "_MAJ_" + noteNames[c]];
			if (!loopAudioBuffers["chords"][keyName]) loopAudioBuffers["chords"][keyName] = loopAudioBuffers["chords"][v + "_MAJ_" + noteNames[c]];	

			keyName = v + "_EN_MIN_" + noteNames[c];
			if (!loopAudioBuffers["chords"][keyName]) loopAudioBuffers["chords"][keyName] = loopAudioBuffers["chords"][v + "_MIN_" + noteNames[c]];
			if (!loopAudioBuffers["chords"][keyName]) loopAudioBuffers["chords"][keyName] = loopAudioBuffers["chords"][v + "_MIN_" + noteNames[c]];						
		}
	}

	logger("Engine populated. Ready to run arranger phase verification matrix.");
	playButton.disabled = false;
	playButton.style.background = "#ff3d00"; 		
}		

const tempoInput = document.getElementById('ctrl-tempo');
const keyInput = document.getElementById('ctrl-key');

document.querySelectorAll('.intro-choice').forEach(button => button.addEventListener('click', () => {
	introEnding = Number(button.dataset.intro);
	document.querySelectorAll('.intro-choice').forEach(choice => choice.setAttribute('aria-pressed', String(choice === button)));
}));

tempoInput.addEventListener('input', (e) => {
	const rate = Math.pow(2, parseInt(e.target.value, 10) / 12);
	document.getElementById('style-tempo').textContent = Math.ceil(tempo * rate) + " BPM";
	document.getElementById('lbl-tempo').innerText = `Tempo Shift Step: ${e.target.value}`;
	if (isPlaying && !endingScheduled) restartArrangerEngine();
});

keyInput.addEventListener('change', () => {
	if (isPlaying && !endingScheduled) restartArrangerEngine();
});

document.getElementById('btn-play').addEventListener('click', (e) => {
	toggleStartEndArranger();
});


document.getElementById('btn-stop').addEventListener('click', (e) => {
	stopArranger();
});

document.getElementById('btn-neouke').addEventListener('click', async (e) => {
	let ready, device;
	const devices = await navigator.bluetooth.getDevices();		

	if (devices.length > 0) {
		device = devices[0];
		neoukeDevice = device;
						
		device.addEventListener('advertisementreceived', (event) => {	
			
			if (!ready) {
				console.debug('Bluetooth device advert', event, device);					
				ready = true;
				doNeoUkeSetup();
			}
		});
		
		await device.watchAdvertisements();		
		
	} else {
		device = await navigator.bluetooth.requestDevice({filters: [{services: ["03b80e5a-ede8-4b33-a751-6ce34ec4c700"]}]});
		
		if (neoukeDevice && device) {
			await device.forget();
			bluetoothGuitar	= null;				
			console.debug("forget neouke", device);						
		} 
		else 

		if (device) {
			neoukeDevice = device;			
			doNeoUkeSetup();		
		}
	}
	
	console.debug('on neouke click', device);	
});

async function doNeoUkeSetup() {
	console.debug('doNeoUkeSetup', neoukeDevice);	
	const target = document.getElementById('btn-neouke');
	target.classList.toggle('active', true);			

	if (neoukeDevice) {
		neoukeDevice.addEventListener('gattserverdisconnected', (event) => {
			console.debug('Bluetooth device ' + neoukeDevice.name + ' is disconnected.', event);
			target.classList.toggle('active', false);	
		});
		
		const handlers = {};		
		const server = await neoukeDevice.gatt.connect();
		console.debug('GATT server', server);

		const services = await server.getPrimaryServices();
		
		for (let service of services) {
			console.debug("GATT service", service.uuid, service.isPrimary, service);
			const characteristics = await service.getCharacteristics();
			
			for (let characteristic of characteristics) 
			{
				try {				
					const descriptors = await characteristic.getDescriptors();
				
					for (let descriptor of descriptors) {
						const value = await descriptor.readValue();
						console.debug('Found Descriptor', descriptor.uuid, value);				
					}
				} catch (e) {}

				console.debug('Found Characteristic', characteristic.uuid, characteristic.properties, service.uuid);										

				if (characteristic.properties.read) {
					const readCharacteristic = characteristic;	
					
					readCharacteristic.addEventListener('characteristicvaluechanged',  (evt) => {
						const {buffer}  = evt.target.value;
						const eventData = new Uint8Array(buffer);													
						//for (let i in eventData) console.debug("Read", eventData.length, i + ":" + eventData[i]);						
					});					

				}
					
				if (characteristic.properties.writeWithoutResponse) {
					//writeCharacteristic = characteristic;	
					//setTimeout(setNeoUkeSettings, 1000);
				}
				
					
				if (characteristic.properties.notify) {
					console.debug('Setup Notifier', characteristic.uuid);					
					handlers[characteristic.uuid] = await characteristic.startNotifications();
					
					handlers[characteristic.uuid].addEventListener('characteristicvaluechanged', (evt) => {
						const {buffer}  = evt.target.value;
						const eventData = new Uint8Array(buffer);
						
						for (let i in eventData) console.debug("Event", eventData.length, i + ":" + eventData[i]);	

						if (eventData.length == 7 && eventData[2] == 240 && eventData[6] == 247) 
						{ 
							if (eventData[3] == 10) {			// variation
								let newVar = currentVariation;
								
								if (eventData[4] == 1) {
									newVar++;
									if (newVar > 3) newVar = 0;
									setVariation(newVar);
								}
								else
								
								if (eventData[4] == 0) {
									playFillX();
								}
							}
							else

							if (eventData[3] == 2 || eventData[3] == 3) {			// registrations (program change roller)
								if (!isPlaying) 
								{
									if (!recalling) {
										let project = currentProject;
										
										if (eventData[3] == 2) {
											project++;												
											if (project > 20) project = 1;
										}
										
										if (eventData[3] == 3) {
											project--;
											if (project < 0) project = 0;
										}
										
										recallRegistration(project);
										document.getElementById('reg-select').selectedIndex = project - 1;
									}
								}	
							}									
							
						}
						else

						if (eventData.length == 13 && eventData[2] == 240 && eventData[12] == 247) { // stop/start
							toggleStartEndArranger();
						}
						else
						
						if (eventData.length == 11 && eventData[8] == 144 && eventData[10] == 127) { // chord key press	
						
							if (eventData[9] == 19) {			// 7
								changeStyleChord("Maj", 11, 0); 
							}
							else
								
							if (eventData[9] == 20) {			// 7b	
								changeStyleChord("Maj", 10, 0); 
							}
							else
								
							if (eventData[9] == 127) {			// 6b
								changeStyleChord("Maj", 8, 0); 
							}
							else

							if (eventData[9] == 15 || eventData[9] == 16) {	// 6m
								changeStyleChord("Min", 9, 0); 
							}
							else

							if (eventData[9] == 17) {			// 6
								changeStyleChord("Maj", 9, 0); 
							}
							else
								
							if (eventData[9] == 13) {			// 5
								changeStyleChord("Maj", 7, 0); 
							}
							else
								
							if (eventData[9] == 12) {			// 5sus
								changeStyleChord("Sus4", 7, 0); 
							}
							else
								
							if (eventData[9] == 14) {			// 5/7
								changeStyleChord("Maj", 7, 11); 
							}													
							else
								
							if (eventData[9] == 1) {			// 1
								changeStyleChord("Maj", 0, 0); 
							}
							else
								
							if (eventData[9] == 0) {			// 1sus
								changeStyleChord("Sus4", 0, 0); 
							}
							else

							if (eventData[9] == 2) {			// 1/3
								changeStyleChord("Maj", 0, 4); 
							}
							else						
								
							if (eventData[9] == 10) {			// 4
								changeStyleChord("Maj", 5, 0); 
							}
							else
								
							if (eventData[9] == 127) {			// 3b
								changeStyleChord("Maj", 3, 0); 
							}
							else

							if (eventData[9] == 9 ) {			// 4/6
								changeStyleChord("Maj", 5, 9); 
							}
							else						
								
							if (eventData[9] == 3 || eventData[9] == 4) {	//  2m
								changeStyleChord("Min", 2, 0); 
							}
							else
								
							if (eventData[9] == 5) {			// 2
								changeStyleChord("Maj", 2, 0); 
							}
							else
								
							if (eventData[9] == 11) {			// 4m
								changeStyleChord("Min", 5, 0); 
							}	
							else
								
							if (eventData[9] == 6 || eventData[9] == 7) {	// 3m
								changeStyleChord("Min", 4, 0); 
							}
							else
								
							if (eventData[9] == 8) {			// 3
								changeStyleChord("Maj", 4, 0); 
							}						
							else
								
							if (eventData[9] == 18) {			// 5b
								changeStyleChord("Maj", 6, 0); 
							} 		
						}					
					});					
				}
			}
		}
	}						
}

document.getElementById('btn-solo').addEventListener('click', async (e) => {
	soloActive = !soloActive;
	setSoloActive();
});

function setSoloActive() {
	const target = document.getElementById('btn-solo');
	target.classList.toggle('active', soloActive);
	target.innerText = "SOLO " + (soloActive ? "ON" : "OFF");		
}

function getMelodicKey() {
	const index = (noteNames.indexOf(keyInput.value) - parseInt(tempoInput.value, 10) + 12) % 12;
	return noteNames[index];
}

function hasBuffers(entries) {
	const missing = entries.filter(([type, key]) => !loopAudioBuffers[type][key]);
	if (missing.length) {
		logger(`Missing audio loops: ${missing.map(([type, key]) => `${type}/${key}`).join(", ")}`);
		return false;
	}
	return true;
}

function nextBarTime(now) {
	if (now < barStartTime) return barStartTime;
	return barStartTime + (Math.floor((now - barStartTime) / barDuration) + 1) * barDuration;
}

function scheduleDrumTransition(targetKey, fillKey = null) {
	if (!isPlaying || endingScheduled) {
		logger("Start the arranger before playing a fill, break, or variation.");
		return false;
	}
	const required = [["drums", targetKey]];
	if (fillKey) required.push(["drums", fillKey]);
	if (!hasBuffers(required)) return false;

	const now = audioCtx.currentTime;
	const boundary = nextBarTime(now);
	const rate = Math.pow(2, parseInt(tempoInput.value, 10) / 12);
	const fadeTime = Math.min(0.02, (boundary - now) / 2);

	// A new request replaces any drum sources already scheduled for a future bar.
	activeSources.filter(src => src.loopType === "drums").forEach(src => {
		if (src.startTime > now) {
			src.stop(now);
		} else if (fillKey) {
			src.gainNode.gain.cancelScheduledValues(now);
			src.gainNode.gain.setValueAtTime(src.gainNode.gain.value, now);
			src.gainNode.gain.linearRampToValueAtTime(0, now + fadeTime);
			src.stop(now + fadeTime);
		} else {
			src.stop(boundary);
		}
	});
	activeSources = activeSources.filter(src => src.loopType !== "drums" || src.startTime <= now);

	if (fillKey) {
		const buffer = loopAudioBuffers.drums[fillKey];
		const remaining = (boundary - now) * rate;
		const offset = (buffer.duration - remaining % buffer.duration) % buffer.duration;
		const fill = triggerLoopNode("drums", buffer, rate, now, fadeTime, offset);
		fill.stop(boundary);
		activeSources.push(fill);
	}
	activeSources.push(triggerLoopNode("drums", loopAudioBuffers.drums[targetKey], rate, boundary, 0));
	return true;
}

window.playDrumFill = function(key) {
	if (scheduleDrumTransition(currentDrumKey, key)) logger(`Playing drum ${key}.`);
};

window.playFillX = () => playDrumFill(fills[currentVariation % 4]);

window.playBreakX = () => playDrumFill(breaks[currentVariation % 4]);

window.setVariationLetter = letter => setVariation(letter + (altVariation ? 4 : 0));

window.toggleAltVariation = function() {
	altVariation = !altVariation;
	updateVariationButtons();
	if (isPlaying && !endingScheduled) setVariation((currentVariation % 4) + (altVariation ? 4 : 0));
};

function updateVariationButtons() {
	document.querySelectorAll('.btn-var').forEach((btn, index) => {
		btn.classList.toggle('active', index === currentVariation % 4);
	});
	const altButton = document.getElementById('btn-arr-x');
	altButton.setAttribute('aria-pressed', String(altVariation));
	altButton.textContent = altVariation ? 'VAR 1-8' : 'VAR 1-4';
}

function changeStyleChord(detectedType, detectedRoot, detectedBass) {
	const outputChord = document.getElementById('out-chord');
	const rootName = noteNames[detectedRoot];
	const bassName = noteNames[detectedBass];

	let chordDisplayName = `${rootName} ${detectedType}`;
	
	if (detectedRoot !== detectedRoot) {
		chordDisplayName += ` / ${bassName}`; // Format as slash chord if inverted
	}	
	
	outputChord.innerText = chordDisplayName;			
					
	if (currentChordType == detectedType && currentChordRoot == detectedRoot && currentBassRoot == detectedBass && !variationRequested) {
		return;
	}

	currentChordType = detectedType;
	currentChordRoot = detectedRoot;
	currentBassRoot = detectedBass;
	
	if (!isPlaying || endingScheduled) {
	  return;
	}			
	
	variationRequested = false;		// need to play same chord again if variation has changed

	if (soloActive) {				// fix to root	
		detectedType = "Maj";
		detectedRoot = 0;
		detectedBass = 0;
	} 
	
	const fadeTime = 0.1;
	const now = audioCtx.currentTime;	
	const newSources = [];
	
	activeSources.forEach(oldNode => 
	{
		if (oldNode.loopType == "drums") {
			newSources.push(oldNode);
			return;
		}

		const targetKey = keyInput.value;				
		const tempoStep = parseInt(tempoInput.value, 10);
		const rate = Math.pow(2, tempoStep / 12);
		const targetIndex = noteNames.indexOf(targetKey);
		
		let targetAssetIndex = (targetIndex - tempoStep + detectedRoot) % 12;
		if (targetAssetIndex < 0) targetAssetIndex += 12;
		
		let targetBassAssetIndex = (targetIndex - tempoStep + detectedBass) % 12;
		if (targetBassAssetIndex < 0) targetBassAssetIndex += 12;				
		
		let calculatedMelodicKey;

		if (oldNode.loopType == "bass") {				
			if (detectedType === "Maj") calculatedMelodicKey = (currentVariation % 4) + "_BMAJ_" + noteNames[targetBassAssetIndex];
			if (detectedType === "Min") calculatedMelodicKey = (currentVariation % 4) + "_BMIN_" + noteNames[targetBassAssetIndex];
			if (detectedType === "7th") calculatedMelodicKey = (currentVariation % 4) + "_BMAJ_" + noteNames[targetBassAssetIndex];
			if (detectedType === "Min7") calculatedMelodicKey = (currentVariation % 4) + "_BMIN_" + noteNames[targetBassAssetIndex];
			if (detectedType === "Sus2" || detectedType === "Sus4") calculatedMelodicKey = (currentVariation % 4) + "_BMAJ_" + noteNames[targetBassAssetIndex];
		}
		else 
		
		if (oldNode.loopType == "chords") {					
			if (detectedType === "Maj") calculatedMelodicKey = (currentVariation % 4) + "_MAJ_" + noteNames[targetAssetIndex];
			if (detectedType === "Min") calculatedMelodicKey = (currentVariation % 4) + "_MIN_" + noteNames[targetAssetIndex];
			if (detectedType === "7th") calculatedMelodicKey = (currentVariation % 4) + "_7TH_" + noteNames[targetAssetIndex];
			if (detectedType === "Min7") calculatedMelodicKey = (currentVariation % 4) + "_MIN_" + noteNames[targetAssetIndex];
			if (detectedType === "Sus2" || detectedType === "Sus4") calculatedMelodicKey = (currentVariation % 4) + "_SUS_" + noteNames[targetAssetIndex];
		}
		
		if (calculatedMelodicKey && hasBuffers([[oldNode.loopType, calculatedMelodicKey]])) {
			const buffer = loopAudioBuffers[oldNode.loopType][calculatedMelodicKey];					
			const offset = ((now - barStartTime) * rate % buffer.duration + buffer.duration) % buffer.duration;	
			
			oldNode.gainNode.gain.setValueAtTime(oldNode.gainNode.gain.value, now);
			oldNode.gainNode.gain.linearRampToValueAtTime(0, now + fadeTime);
			oldNode.stop(now + fadeTime + 0.1);
			const newNode = triggerLoopNode(oldNode.loopType, buffer, rate, now, fadeTime, offset);
			newSources.push(newNode);				
		} else newSources.push(oldNode);
	});	

	activeSources = newSources;
}

function runArrangerPlaybackChannels() {
	const targetKey = keyInput.value;
	const tempoStep = parseInt(tempoInput.value, 10);

	// Both tracks speed up/slow down identically to maintain rhythmic locking
	const rate = Math.pow(2, tempoStep / 12);
	const fadeTime = 0.1;

	// CALCULATE MELODIC SHIFT ONLY
	const targetIndex = noteNames.indexOf(targetKey);
	let targetAssetIndex = (targetIndex - tempoStep) % 12;
	if (targetAssetIndex < 0) targetAssetIndex += 12;
	const calculatedMelodicKey = noteNames[targetAssetIndex];

	//logger(`[DRUMS] Streaming default master loop at speed multiplier: x${rate.toFixed(4)}`);
	//logger(`[MELODIC] Root: ${targetKey} | Shift Offset: ${tempoStep} | Loading Asset Key: [${calculatedMelodicKey}]`);

	const startTime = audioCtx.currentTime + 0.03;
	barDuration = 4 * (60 / tempo) / rate;
	barStartTime = startTime;
	currentVariation = -1;
	altVariation = false;
	currentDrumKey = intros[introEnding];
	endingScheduled = false;
	//currentChordType = currentChordRoot = currentBassRoot = null;
	updateVariationButtons();

	// Drums get the base drum asset file but still follow the rhythm playback rate
	activeSources.push(triggerLoopNode("drums", loopAudioBuffers.drums[intros[introEnding]], rate, startTime, fadeTime));
	beatCounter.bpm = Math.ceil(tempo * rate); 
	beatCounter.start(startTime);
	
	// Bass and Chords pull the counter-shifted pitch key files
	activeSources.push(triggerLoopNode("bass", loopAudioBuffers.bass["0_BIN_MAJ_" + calculatedMelodicKey], rate, startTime, fadeTime));
	activeSources.push(triggerLoopNode("chords", loopAudioBuffers.chords["0_IN_MAJ_" + calculatedMelodicKey], rate, startTime, fadeTime));
}

function toggleStartEndArranger() {
	if (!audioCtx) return logger("Please click 'Link Folder' first.");
	
	if (isPlaying) {
		stopArrangerPlaybackChannels();				
	} else {
		startArrangerPlaybackChannels();
	}
};

async function startArrangerPlaybackChannels() {
	const playButton = document.querySelector("#btn-play");	
	
	if (audioCtx.state === "suspended") await audioCtx.resume();
	
	if (!hasBuffers([
		["drums", intros[introEnding]],
		["bass", "0_BIN_" + currentChordType.toUpperCase() + "_" + getMelodicKey()],
		["chords", "0_IN_" + currentChordType.toUpperCase() + "_" + getMelodicKey()]
	])) console.warn("Missing some intro loops");

	isPlaying = true;
	playButton.innerHTML = "END";
	playButton.style.background = "#00e676"; 				
	runArrangerPlaybackChannels();			
}

function stopArrangerPlaybackChannels() {
	if (endingScheduled) return;

	const playButton = document.querySelector("#btn-play");	
	const targetKey = keyInput.value;
	const tempoStep = parseInt(tempoInput.value, 10);
	const rate = Math.pow(2, tempoStep / 12);
	const fadeTime = 0.1;

	const targetIndex = noteNames.indexOf(targetKey);
	let targetAssetIndex = (targetIndex - tempoStep) % 12;
	if (targetAssetIndex < 0) targetAssetIndex += 12;
	const calculatedMelodicKey = noteNames[targetAssetIndex];

	const drumBuffer = loopAudioBuffers.drums[endings[introEnding]];
	
	if (!hasBuffers([	["drums", endings[introEnding]]	])) {
		setTimeout(stopArranger);
		return;
	}
	
	playButton.style.background = "brown";
	playButton.innerHTML = "ENDING..";
	const startTime = nextBarTime(audioCtx.currentTime);
	endingScheduled = true;
	activeSources.forEach(src => src.stop(startTime));
	activeSources = [];

	const drumNode = triggerLoopNode("drums", drumBuffer, rate, startTime, fadeTime, 0, false);
	endingNode = drumNode;
	activeSources.push(drumNode);
	
	drumNode.onended = () => {
		setTimeout(stopArranger);
	};		
	
	if (hasBuffers([  ["bass", "0_BEN_" + currentChordType.toUpperCase() + "_" + calculatedMelodicKey] ])) {		
		const bassNode = triggerLoopNode("bass", loopAudioBuffers.bass["0_BEN_MAJ_" + calculatedMelodicKey], rate, startTime, fadeTime, 0, false);
		activeSources.push(bassNode);
	}

	if (hasBuffers([  ["chords", "0_EN_" + currentChordType.toUpperCase() + "_" + calculatedMelodicKey]])) {	
		const chordNode = triggerLoopNode("chords", loopAudioBuffers.chords["0_EN_MAJ_" + calculatedMelodicKey], rate, startTime, fadeTime, 0, false);
		activeSources.push(chordNode);
	}
}

function triggerLoopNode(loopType, audioBuffer, rate, startTime, fadeTime, offset = 0, loop = true) {
	const src = audioCtx.createBufferSource();
	src.gainNode = audioCtx.createGain();
	src.connect(src.gainNode);			
	src.buffer = audioBuffer;
	src.loop = loop;
	src.playbackRate.setValueAtTime(rate, startTime);
	src.gainNode.connect(ensureMixer()[loopType]);
	src.gainNode.gain.setValueAtTime(0, startTime);			
	src.start(startTime, offset);
	src.gainNode.gain.linearRampToValueAtTime(1, startTime + fadeTime);			
	src.loopType = loopType;	
	src.startTime = startTime;
	src.onended = () => {
		activeSources = activeSources.filter(node => node !== src);
	};
	return src;
}

function stopWithFadeOut(src, fadeDuration = 2.0) {	
	const now = audioCtx.currentTime;		
	const gain = src.gainNode.gain;
	gain.setTargetAtTime(0.01, now, 0.5);	
	src.loop = false;			
	src.stop(now + fadeDuration);
}	

function stopArranger() {
	activeSources.forEach(src => { stopWithFadeOut(src)});
	activeSources = [];

	endingScheduled = false;
	endingNode = null;
	isPlaying = false;	
	const playButton = document.querySelector("#btn-play");			
	playButton.innerHTML = "START";
	playButton.style.background = "#ff3d00"; 			
	logger("Engine tracking stopped.");
	beatCounter.stop();				
}

function restartArrangerEngine() {
	activeSources.forEach(src => { try { src.stop(); } catch(e){} });
	activeSources = [];
	endingScheduled = false;
	endingNode = null;
	runArrangerPlaybackChannels();
}

function buildExtendedKeyboard() {
	const kbd = document.getElementById('virtual-keyboard');
	kbd.innerHTML = "";
	// Render 3 full octaves from Note 48 (C3) up to Note 84 (C6)
	for (let midiNote = 48; midiNote <= 84; midiNote++) {
		const name = noteNames[midiNote % 12];
		const isBlack = name.includes("#");
		
		const div = document.createElement('div');
		div.id = `note-${midiNote}`;
		div.className = isBlack ? "key black" : "key";
		div.innerText = `${name}${Math.floor(midiNote/12)-1}`;
		
		// Mouse interactions emulator for testing without physical controllers
		div.onpointerdown = event => {
			div.setPointerCapture(event.pointerId);
			handleInputRouting(144, midiNote, 100);
		};
		div.onpointerup = div.onpointercancel = () => handleInputRouting(128, midiNote, 0);
		
		kbd.appendChild(div);
	}
}		

document.getElementById('btn-midi-init').addEventListener('click', async (e) => {
	if (!navigator.requestMIDIAccess) {
		logger("CRITICAL: Browser does not support Web MIDI. Use Chrome, Edge, or Opera.");
		return;
	}

	try {
		midiAccess = await navigator.requestMIDIAccess();
		const statusBadge = document.getElementById('midi-status');
		const connectInputs = () => {
			let discovered = 0;
			for (let input of midiAccess.inputs.values()) {
				if (input.state !== 'connected') continue;
			input.onmidimessage = (e) => {
				const [status, note, velocity] = e.data;
				handleInputRouting(status, note, velocity);
			};
			discovered++;
			}
			statusBadge.innerText = discovered ? `${discovered} MIDI input${discovered === 1 ? '' : 's'} connected` : "Virtual keyboard";
			statusBadge.style.background = discovered ? "#00e676" : "#ffb300";
			statusBadge.style.color = "#000";
			document.getElementById('btn-midi-init').classList.toggle("active", true);
		};
		midiAccess.onstatechange = event => {
			if (event.port.type === 'input' && event.port.state === 'disconnected') {
				for (const note of activeNotes.keys()) {
					voices.noteOff(note);
					updateKeyVisual(note, 'off');
				}
				activeNotes.clear();
			}
			connectInputs();
		};
		connectInputs();
	} catch (err) {
		logger(`Driver load failure: ${err.message}`);
	}
});

function handleInputRouting(status, note, velocity) {
	const msgType = status & 0xF0;
	const channel = status & 0x0F;
	//console.debug("handleInputRouting", msgType, channel, note, velocity);
				
	const isNoteOn = (msgType === 144 && velocity > 0);
	const isNoteOff = (msgType === 128 || (msgType === 144 && velocity === 0));
	
	const isStart = msgType == 240 || (msgType == 176 && note == 23 && velocity == 127);
	const programChange = msgType == 192;
	const controlChange = msgType == 176;				

	if (isNoteOn) {
		if (audioCtx && audioCtx.state === 'suspended') {
			audioCtx.resume().catch(error => logger(`Audio resume failed: ${error.message}`));
		}
		activeNotes.set(note, performance.now());
		//logger(`📥 [INPUT TRIGGER] Note: ${note} | Velocity: ${velocity} -> Forwarded instantly to Sampler Layer`);
		
		// Immediately trigger visualization update
		updateKeyVisual(note, 'melody');
		voices.noteOn(note, velocity);

		// Queue microsecond time window evaluation to look for full harmonic shapes
		triggerChordEvaluationBuffer();
	} 
	else

	if (isNoteOff) {
		activeNotes.delete(note);
		updateKeyVisual(note, 'off');
		triggerChordEvaluationBuffer();
		voices.noteOff(note);
	}
	else
	
	if (isStart) {
		toggleStartEndArranger();
	}
	else 
	
	if (programChange) {	// drum pads - trigger variations
		
		if (!isPlaying) 
		{
			if (!recalling) {
				recallRegistration(note + 1);
				document.getElementById('reg-select').selectedIndex = note;
			}
		} else {
			if (note >= 0 && note < 8) setVariation(note);
			if (note > 7 && note < 12) playDrumFill(fills[note % 4]);
			if (note > 11 && note < 16) playDrumFill(breaks[note % 4]);			
		}
	}
	else
	
	if (controlChange) {	// encoders - change volumes
		let name;
		if (note == 21 || note == 12) {name = "drums"; 	document.querySelector("#volume-" + name).value = (velocity / 127) * 100};
		if (note == 22 || note == 13) {name = "bass"; 	document.querySelector("#volume-" + name).value = (velocity / 127) * 100};
		if (note == 23 || note == 14) {name = "chords"; document.querySelector("#volume-" + name).value = (velocity / 127) * 100};	
		if (note == 24 || note == 16) {name = "voice1"; document.querySelector("#volume-" + name).value = (velocity / 127) * 100};
		if (note == 25 || note == 17) {name = "voice2"; document.querySelector("#volume-" + name).value = (velocity / 127) * 100};
		if (note == 26 || note == 15) {name = "master"; document.querySelector("#volume-" + name).value = (velocity / 127) * 100};	

		if (mixer && name) {
			mixer[name].gain.setValueAtTime((velocity / 127), audioCtx.currentTime);	
			document.getElementById(`level-${name}`).textContent = `${Math.round((velocity / 127) * 100)}%`;		
		}					
	}
	
}

function triggerChordEvaluationBuffer() {
	clearTimeout(chordAnalysisTimeout);
	// 15ms window buffers individual human finger-strike execution deltas
	chordAnalysisTimeout = setTimeout(analyzeFullKeyboardHarmony, 15);
}

function analyzeFullKeyboardHarmony() {
	if (activeNotes.size < 3) return;

	// Sort notes numerically to ensure notesArray[0] is always the absolute lowest physical bass note
	const notesArray = Array.from(activeNotes.keys()).sort((a, b) => a - b);
	
	let detectedRoot = notesArray[0];
	let detectedType = "Maj";
	let bestMatchWeight = -1;

	// Test each note in the cluster as a candidate root to handle inversions cleanly
	for (let candidateRoot of notesArray) {
		// Map all notes relative to this candidate root (0 - 11 values)
		const relativePitches = notesArray.map(n => (n - candidateRoot + 120) % 12);
		const bitmask = relativePitches.reduce((mask, p) => mask | (1 << p), 0);

		// Define standard chord signature maps using integer bitmasks
		const chordsTable = [
			{ type: "Maj", mask: (1<<0) | (1<<4) | (1<<7), weight: 3 },
			{ type: "Min", mask: (1<<0) | (1<<3) | (1<<7), weight: 3 },
			{ type: "Sus2", mask: (1<<0) | (1<<2) | (1<<7), weight: 3 },
			{ type: "Sus4", mask: (1<<0) | (1<<5) | (1<<7), weight: 3 },
			{ type: "7th", mask: (1<<0) | (1<<4) | (1<<7) | (1<<10), weight: 4 },
			{ type: "7th", mask: (1<<0) | (1<<4) | (1<<10), weight: 2.5 }, // Dominant 7th drop 5th
			{ type: "Min7", mask: (1<<0) | (1<<3) | (1<<7) | (1<<10), weight: 4 }
		];

		for (let chord of chordsTable) {
			if ((bitmask & chord.mask) === chord.mask) {
				if (chord.weight > bestMatchWeight) {
					bestMatchWeight = chord.weight;
					detectedRoot = candidateRoot;
					detectedType = chord.type;
				}
			}
		}
	}

	if (bestMatchWeight < 0) return;
	// Extract pitch classes (0-11) for the root and the actual lowest note held
	const rootPitchClass = detectedRoot % 12;
	const bassPitchClass = notesArray[0] % 12;

	const rootName = noteNames[rootPitchClass];
	const bassName = noteNames[bassPitchClass];
	
	// Determine the user-facing text representation
	let chordDisplayName = `${rootName} ${detectedType}`;
	if (rootPitchClass !== bassPitchClass) {
		chordDisplayName += ` / ${bassName}`; // Format as slash chord if inverted
	}

	// Map the parsed chord directly to the Ketron loop file asset naming architecture
	let assetSuffix = "Maj.wav";
	if (detectedType === "Min") assetSuffix = "Min.wav";
	if (detectedType === "7th") assetSuffix = "7th.wav";
	if (detectedType === "Min7") assetSuffix = "Min.wav"; // Map Min7 directly to your Minor loop block
	if (detectedType === "Sus2" || detectedType === "Sus4") assetSuffix = "Maj.wav"; // Map suspensions to Major fallback loop blocks

	notesArray.forEach(note => updateKeyVisual(note, 'chord'));
	changeStyleChord(detectedType, rootPitchClass, bassPitchClass); 
}

function updateKeyVisual(note, state) {
	const el = document.getElementById(`note-${note}`);
	if (!el) return;

	el.classList.remove('active-melody', 'active-chord');
	if (state === 'melody') el.classList.add('active-melody');
	if (state === 'chord') el.classList.add('active-chord');
}


// Registrations: 20 JSON snapshots stored in <root>/REGISTRATIONS, with localStorage as fallback.
const regSelect = document.getElementById('reg-select');
const regName = n => `REG_${String(n).padStart(2, '0')}.json`;

async function regFolder(create) {
	return rootDirHandle ? rootDirHandle.getDirectoryHandle('REGISTRATIONS', { create }) : null;
}

async function readRegistration(n) {
	try {
		const folder = await regFolder(false);
		if (folder) return await (await (await folder.getFileHandle(regName(n))).getFile()).text();
	} catch (error) { if (error.name !== 'NotFoundError') logger(`Registration read error: ${error.message}`); }
	return localStorage.getItem(`evm-reg-${n}`);
}

async function refreshRegistrations() {
	for (let n = 1; n <= 20; n++) {
		const saved = await readRegistration(n);
		regSelect.options[n - 1].textContent = `Reg ${n}${saved ? ' ●' : ''}`;
	}
}

function captureRegistration() {
	return {
		version: 1,
		style: selectedStyleInfo ? { path: selectedStyleInfo.path, name: selectedStyleInfo.name } : null,
		performance: {
			key: keyInput.value, tempoShift: Number(tempoInput.value), autoFill: document.getElementById('auto-fill').checked,
			introEnding, variation: currentVariation % 4, alt: altVariation, solo: soloActive
		},
		mixer: JSON.parse(JSON.stringify(mixerState)),
		voices: voices.getState()
	};
}

async function saveRegistration(n) {
	const text = JSON.stringify(captureRegistration(), null, 2);
	let where = 'browser storage';
	try {
		const folder = await regFolder(true);
		if (folder) {
			const writable = await (await folder.getFileHandle(regName(n), { create: true })).createWritable();
			await writable.write(text);
			await writable.close();
			where = `REGISTRATIONS/${regName(n)}`;
		} else localStorage.setItem(`evm-reg-${n}`, text);
	} catch (error) {
		logger(`Could not write registration file (${error.message}); saved in browser storage instead.`);
		localStorage.setItem(`evm-reg-${n}`, text);
	}
	logger(`Registration ${n} saved to ${where}.`);
	refreshRegistrations();
}

async function recallRegistration(n) {
	if (recalling) return;
	recalling = true;			
	//console.debug("recallRegistration", n);
	
	const text = await readRegistration(n);
	if (!text) return logger(`Registration ${n} is empty.`);
	let reg;
	try { reg = JSON.parse(text); if (reg.version !== 1 || !Array.isArray(reg.voices?.voices) || !reg.mixer || !reg.performance) throw new Error('unrecognised format'); }
	catch (error) { return logger(`Registration ${n} is invalid: ${error.message}`); }
	const missing = [];
	for (const name of Object.keys(mixerState)) {
		const saved = reg.mixer[name];
		if (!saved) continue;
		mixerState[name].volume = Math.min(1, Math.max(0, Number(saved.volume) || 0));
		mixerState[name].muted = Boolean(saved.muted);
		mixerUpdaters[name]();
	}
	const perf = reg.performance;
	const previousTuning = keyInput.value + tempoInput.value;
	if (noteNames.includes(perf.key)) keyInput.value = perf.key;
	tempoInput.value = Math.min(6, Math.max(-6, Number(perf.tempoShift) || 0));
	document.getElementById('lbl-tempo').innerText = `Tempo Shift Step: ${tempoInput.value}`;
	document.getElementById('auto-fill').checked = Boolean(perf.autoFill);
	const intro = Number(perf.introEnding);
	if (intro >= 0 && intro < 3) document.querySelector(`.intro-choice[data-intro="${intro}"]`).click();
	const alt = Boolean(perf.alt);
	missing.push(...voices.setState(reg.voices));
	if (reg.style) {
		const entry = styleGroups.get(reg.style.path)?.find(candidate => candidate.name === reg.style.name);
		if (!entry) missing.push(`Style: ${reg.style.path}/${reg.style.name}`);
		else if (selectedStyleInfo?.handle !== entry) await selectStyle(entry, reg.style.path);
	}
	if (isPlaying && !endingScheduled) {
		if (keyInput.value + tempoInput.value !== previousTuning) restartArrangerEngine();
		altVariation = alt;
		setVariation((Number(perf.variation) || 0) % 4 + (alt ? 4 : 0));
	} else {
		altVariation = alt;
		updateVariationButtons();
	}
	soloActive = !!perf.solo;
	setSoloActive();
	recalling = false;
	currentProject = n;
	
	logger(`Registration ${n} recalled.${missing.length ? ` Not found in scanned folder: ${missing.join('; ')}` : ''}`);
}

document.getElementById('btn-reg-save').addEventListener('click', () => saveRegistration(Number(regSelect.value)));
document.getElementById('btn-reg-recall').addEventListener('click', () => {if (!recalling) recallRegistration(Number(regSelect.value))});
refreshRegistrations();

window.setVariation = function(varNo) {
	const targetKey = variations[varNo];
	const fillKey = document.getElementById('auto-fill').checked ? fills[varNo % fills.length] : null;
	if (!scheduleDrumTransition(targetKey, fillKey)) return;
	
	currentVariation = varNo;
	currentDrumKey = targetKey;
	updateVariationButtons();
	variationRequested = true;
	if (currentChordType !== null) changeStyleChord(currentChordType, currentChordRoot, currentBassRoot);
	//logger(`Queued drum variation ${targetKey}${fillKey ? ` with ${fillKey}` : ""}.`);
};
		
buildExtendedKeyboard();

