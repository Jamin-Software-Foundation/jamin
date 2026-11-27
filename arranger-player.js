// arranger-player.js
const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const variations = ['ARRA', 'ARRB', 'ARRC', 'ARRD', 'ARRA_1', 'ARRB_1', 'ARRC_1', 'ARRD_1'];
const fills = ['FILA', 'FILB', 'FILC', 'FILD'], breaks = ['BRKA', 'BRKB', 'BRKC', 'BRKD'];
const intros = ['INT1', 'INT2', 'INT3'], endings = ['END1', 'END2', 'END3'];

export function createArrangerPlayer({ getAudio, ensureMixer, strummer, logger }) {
  let loopAudioBuffers = { drums: {}, bass: {}, chords: {} };
  let activeSources = [], tempo = 120, isPlaying = false, endingScheduled = false;
  let barDuration = null, barStartTime = null, currentVariation = 0, altVariation = false;
  let introEnding = 2, currentDrumKey = null, beatCounter = null, soloActive = false;
  let currentChordRoot = 0, currentBassRoot = 0, currentChordType = 'Maj', variationRequested = false;

  const tempoInput = document.getElementById('ctrl-tempo'), keyInput = document.getElementById('ctrl-key');
  const getRate = () => Math.pow(2, parseInt(tempoInput.value, 10) / 12);

  function triggerLoopNode(loopType, buffer, rate, startTime, fadeTime, offset = 0, loop = true) {
    const audio = getAudio(), src = audio.createBufferSource();
    src.gainNode = audio.createGain(); src.connect(src.gainNode); src.buffer = buffer; src.loop = loop;
    src.playbackRate.setValueAtTime(rate, startTime); src.gainNode.connect(ensureMixer()[loopType]);
    src.gainNode.gain.setValueAtTime(0, startTime); src.start(startTime, offset);
    src.gainNode.gain.linearRampToValueAtTime(1, startTime + fadeTime);
    src.loopType = loopType; src.startTime = startTime;
    src.onended = () => {
      activeSources = activeSources.filter(n => n !== src);
      try { src.disconnect(); } catch {}
      try { src.gainNode.disconnect(); } catch {}
      src.buffer = null;
    };
    return src;
  }


  function playDrumTransition(fillKey) {
    if (!isPlaying || endingScheduled || !currentDrumKey) return;
    const targetBuf = loopAudioBuffers.drums[currentDrumKey];
    const fillBuf = loopAudioBuffers.drums[fillKey];
    if (!targetBuf || !fillBuf) return logger(`Missing drum asset: ${fillKey}`);

    const now = getAudio().currentTime;
    const boundary = barStartTime + (Math.floor((now - barStartTime) / barDuration) + 1) * barDuration;
    const rate = getRate();
    const fadeTime = Math.min(0.02, (boundary - now) / 2);

    activeSources.filter(s => s.loopType === 'drums').forEach(src => {
      if (src.startTime > now) {
        src.stop(now);
      } else {
        src.gainNode.gain.cancelScheduledValues(now);
        src.gainNode.gain.setValueAtTime(src.gainNode.gain.value, now);
        src.gainNode.gain.linearRampToValueAtTime(0, now + fadeTime);
        src.stop(now + fadeTime);
      }
    });
    activeSources = activeSources.filter(s => s.loopType !== 'drums' || s.startTime <= now);

    const remaining = (boundary - now) * rate;
    const offset = (fillBuf.duration - remaining % fillBuf.duration) % fillBuf.duration;
    const fillNode = triggerLoopNode('drums', fillBuf, rate, now, fadeTime, offset, false);
    fillNode.stop(boundary);
    activeSources.push(fillNode);
    activeSources.push(triggerLoopNode('drums', targetBuf, rate, boundary, 0, 0, true));
    logger(`Playing drum ${fillKey}.`);
  }

  function startChannels() {
    const audio = getAudio(), rate = getRate();
    const bpm = Math.ceil(tempo * rate);
    const keyIdx = (noteNames.indexOf(keyInput.value) - parseInt(tempoInput.value, 10) + 12) % 12;
    const key = noteNames[keyIdx];
    const now = audio.currentTime;

    barDuration = 4 * (60 / tempo) / rate;
    let startTime = now + 0.03;

    // If the guitar .strumseq loop is already running, snap the audio style's Beat 1
    // onto the exact next bar downbeat of the running strum clock
    if (strummer.clock.isRunning && strummer.clock.barStartTimeSec !== null) {
      strummer.clock.bpm = bpm;
      const strumBarStart = strummer.clock.barStartTimeSec;
      const barsElapsed = Math.floor((now + 0.02 - strumBarStart) / barDuration) + 1;
      startTime = strumBarStart + Math.max(1, barsElapsed) * barDuration;
    } else {
      strummer.clock.bpm = bpm;
      strummer.syncBarStart(startTime);
    }

    strummer.externalClockLocked = true;
	strummer.setVariationIndex?.(0);	
	
    barStartTime = startTime;
    currentVariation = -1;
    altVariation = false;
    currentDrumKey = intros[introEnding];
    endingScheduled = false;

    if (loopAudioBuffers.drums[currentDrumKey]) {
      activeSources.push(triggerLoopNode('drums', loopAudioBuffers.drums[currentDrumKey], rate, startTime, 0.1));
    }
    if (loopAudioBuffers.bass[`0_BIN_MAJ_${key}`]) {
      activeSources.push(triggerLoopNode('bass', loopAudioBuffers.bass[`0_BIN_MAJ_${key}`], rate, startTime, 0.1));
    }
    if (loopAudioBuffers.chords[`0_IN_MAJ_${key}`]) {
      activeSources.push(triggerLoopNode('chords', loopAudioBuffers.chords[`0_IN_MAJ_${key}`], rate, startTime, 0.1));
    }

    beatCounter?.setBpm(bpm);
    beatCounter?.start(startTime);
  }

  function stopImmediate() {
    activeSources.forEach(s => { try { s.stop(); } catch {} });
    activeSources = [];
    endingScheduled = false;
    isPlaying = false;
    document.querySelector('#btn-play').innerHTML = 'START';
    beatCounter?.stop();
    strummer.externalClockLocked = false;
    strummer.stop();
  }


  function toggleStartEnd() {
    const audio = getAudio();
    if (!audio) return logger("Click 'ON' first.");
    if (isPlaying) {
      if (endingScheduled) return;
      endingScheduled = true;
      const startTime = barStartTime + (Math.floor((audio.currentTime - barStartTime) / barDuration) + 1) * barDuration;
      activeSources.forEach(s => s.stop(startTime)); activeSources = [];
      const endBuf = loopAudioBuffers.drums[endings[introEnding]];
      if (!endBuf) return stopImmediate();
      const node = triggerLoopNode('drums', endBuf, getRate(), startTime, 0.05, 0, false);
      activeSources.push(node); node.onended = () => setTimeout(stopImmediate);
    } else {
      audio.resume(); isPlaying = true;
      document.querySelector('#btn-play').innerHTML = 'END';
      startChannels();
    }
  }

  function changeChord(type, root, bass) {
    const key = noteNames.indexOf(keyInput.value);
    document.getElementById('out-chord').innerText = `${noteNames[(key + root) % 12]} ${type}${root === bass ? '' : ` / ${noteNames[(key + bass) % 12]}`}`;
    if (currentChordType === type && currentChordRoot === root && currentBassRoot === bass && !variationRequested) return;
    currentChordType = type; currentChordRoot = root; currentBassRoot = bass;
    if (!isPlaying || endingScheduled) return;
    variationRequested = false;

    const dType = soloActive ? 'Maj' : type, dRoot = soloActive ? 0 : root, dBass = soloActive ? 0 : bass;
    const rate = getRate(), now = getAudio().currentTime, v = Math.max(0, currentVariation) % 4;
    activeSources = activeSources.map(old => {
      if (old.loopType === 'drums') return old;
      const idx = (key - parseInt(tempoInput.value, 10) + (old.loopType === 'bass' ? dBass : dRoot) + 24) % 12;
      const k = old.loopType === 'bass' ? `${v}_B${dType === 'Min' || dType === 'Min7' ? 'MIN' : 'MAJ'}_${noteNames[idx]}` : `${v}_${dType === 'Sus2' || dType === 'Sus4' ? 'SUS' : dType.toUpperCase()}_${noteNames[idx]}`;
      const buf = loopAudioBuffers[old.loopType][k];
      if (!buf) return old;
      const offset = ((now - barStartTime) * rate % buf.duration + buf.duration) % buf.duration;
      old.gainNode.gain.linearRampToValueAtTime(0, now + 0.08); old.stop(now + 0.1);
      return triggerLoopNode(old.loopType, buf, rate, now, 0.08, offset);
    });
  }

  function setVariation(varNo) {
    currentVariation = varNo;
    altVariation = varNo >= 4;
    strummer.setVariationIndex?.(varNo);

    // Always update the UI Variation buttons (VAR 1-4 / VAR 1-8) even when playing solo guitar
    document.querySelectorAll('.btn-var').forEach((b, i) => b.classList.toggle('active', i === currentVariation % 4));
    const altBtn = document.getElementById('btn-arr-x');
    if (altBtn) {
      altBtn.setAttribute('aria-pressed', String(altVariation));
      altBtn.textContent = altVariation ? 'VAR 1-8' : 'VAR 1-4';
    }

    const target = variations[varNo];
    const targetBuf = loopAudioBuffers.drums[target];
    if (!isPlaying || endingScheduled || !targetBuf) return;

    const autoFill = Boolean(document.getElementById('auto-fill')?.checked);
    const fillKey = autoFill ? fills[varNo % 4] : null;
    const fillBuf = fillKey ? loopAudioBuffers.drums[fillKey] : null;

    const now = getAudio().currentTime;
    const boundary = barStartTime + (Math.floor((now - barStartTime) / barDuration) + 1) * barDuration;
    const rate = getRate();
    const fadeTime = Math.min(0.02, (boundary - now) / 2);

    activeSources.filter(s => s.loopType === 'drums').forEach(src => {
      if (src.startTime > now) {
        src.stop(now);
      } else if (fillBuf) {
        src.gainNode.gain.cancelScheduledValues(now);
        src.gainNode.gain.setValueAtTime(src.gainNode.gain.value, now);
        src.gainNode.gain.linearRampToValueAtTime(0, now + fadeTime);
        src.stop(now + fadeTime);
      } else {
        src.stop(boundary);
      }
    });
    activeSources = activeSources.filter(s => s.loopType !== 'drums' || s.startTime <= now);

    if (fillBuf) {
      const remaining = (boundary - now) * rate;
      const offset = (fillBuf.duration - remaining % fillBuf.duration) % fillBuf.duration;
      const fillNode = triggerLoopNode('drums', fillBuf, rate, now, fadeTime, offset, false);
      fillNode.stop(boundary);
      activeSources.push(fillNode);
    }

    activeSources.push(triggerLoopNode('drums', targetBuf, rate, boundary, 0, 0, true));
    currentDrumKey = target;
    variationRequested = true;
    changeChord(currentChordType, currentChordRoot, currentBassRoot);
  }

  return {
    setStyleData(newTempo, buffers) {
      tempo = newTempo;
      loopAudioBuffers = buffers;
      const effectiveBpm = Math.ceil(tempo * getRate());
      strummer.clock.bpm = effectiveBpm;
      beatCounter = new BeatCounterWidget('#beat-counter-container', getAudio(), { bpm: effectiveBpm, beatsPerBar: 4 });
    },	  
    toggleStartEnd, stopImmediate, changeChord, setVariation,
    restart: () => { stopImmediate(); isPlaying = true; document.querySelector('#btn-play').innerHTML = 'END'; startChannels(); },
    requestVariation: () => { variationRequested = true; },
    setIntroEnding: (idx) => { introEnding = idx; },
    toggleSolo: () => { soloActive = !soloActive; return soloActive; },
    toggleAlt: () => { altVariation = !altVariation; if (isPlaying) setVariation((currentVariation % 4) + (altVariation ? 4 : 0)); },
    nextVar: () => setVariation(((currentVariation + 1) % 4) + (altVariation ? 4 : 0)),
    prevVar: () => setVariation(((Math.max(0, currentVariation) + 3) % 4) + (altVariation ? 4 : 0)),
    setVarLetter: (l) => setVariation(l + (altVariation ? 4 : 0)),
    getState: () => ({ isPlaying, endingScheduled, tempo, introEnding, currentVariation, altVariation, soloActive, currentChordType, currentChordRoot, currentBassRoot }),
    playFill: (idx) => playDrumTransition(fills.at(idx % 4)),
    playBreak: () => playDrumTransition(breaks.at(Math.max(0, currentVariation) % 4)),	
    applyState: (p) => { introEnding = p.introEnding ?? 2; soloActive = !!p.solo; altVariation = !!p.alt; }
  };
}
