function createRoomImpulse(ctx, seconds = 1.4, decay = 2.8) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return impulse;
}

/*
export function createIRCabinet(audioCtx, destinationNode) {
  const powerAmpSag = audioCtx.createDynamicsCompressor();
  powerAmpSag.threshold.value = -18; powerAmpSag.knee.value = 12;
  powerAmpSag.ratio.value = 4.5; powerAmpSag.attack.value = 0.006; powerAmpSag.release.value = 0.14;

  const convolver = audioCtx.createConvolver(), wetGain = audioCtx.createGain();
  const dryGain = audioCtx.createGain(), levelGain = audioCtx.createGain();
  const roomVerb = audioCtx.createConvolver(), roomMix = audioCtx.createGain();
  roomVerb.buffer = createRoomImpulse(audioCtx);
  roomMix.gain.value = 0.25;

  let hasIR = false, isEnabled = true, currentIrPath = null;
  wetGain.gain.value = 0; dryGain.gain.value = 1;

  powerAmpSag.connect(convolver); powerAmpSag.connect(dryGain);
  convolver.connect(wetGain); wetGain.connect(levelGain); dryGain.connect(levelGain);
  levelGain.connect(destinationNode);
  levelGain.connect(roomVerb); roomVerb.connect(roomMix); roomMix.connect(destinationNode);

  const updateRouting = () => {
    const active = hasIR && isEnabled;
    wetGain.gain.value = active ? 1 : 0; dryGain.gain.value = active ? 0 : 1;
  };

  return {
    connectSource(src) {
      try { src.disconnect(); } catch (_) {}
      src.connect(powerAmpSag);
    },
    async loadBuffer(arrayBuffer, path) {
      convolver.buffer = await audioCtx.decodeAudioData(arrayBuffer);
      hasIR = true; currentIrPath = path; updateRouting();
    },
    setAudioBuffer(audioBuffer, path) {
      convolver.buffer = audioBuffer;
      hasIR = true;
      currentIrPath = path;
      updateRouting();
    },	
    setBypass(en) { isEnabled = Boolean(en); updateRouting(); },
    setLevel(v) { levelGain.gain.value = parseFloat(v); },
    setRoom(v) { roomMix.gain.value = parseFloat(v); },
    getState: () => ({ irPath: currentIrPath, level: levelGain.gain.value, room: roomMix.gain.value, enabled: isEnabled }),
    setState(s) {
      if (!s) return;
      if (typeof s.level === "number") levelGain.gain.value = s.level;
      if (typeof s.room === "number") roomMix.gain.value = s.room;
      if (typeof s.enabled === "boolean") { isEnabled = s.enabled; updateRouting(); }
    }
  };
}
*/

export function createIRCabinet(audioCtx, destinationNode) {
  // Unity-gain input stage (avoids browser DynamicsCompressor auto-makeup-gain noise floor boost)
  const inputStage = audioCtx.createGain();
  inputStage.gain.value = 1.0;

  const convolver = audioCtx.createConvolver(), wetGain = audioCtx.createGain();
  const dryGain = audioCtx.createGain(), levelGain = audioCtx.createGain();
  const roomVerb = audioCtx.createConvolver(), roomMix = audioCtx.createGain();
  roomVerb.buffer = createRoomImpulse(audioCtx);
  roomMix.gain.value = 0.25;

  let hasIR = false, isEnabled = true, currentIrPath = null;
  wetGain.gain.value = 0; dryGain.gain.value = 1;

  inputStage.connect(convolver); inputStage.connect(dryGain);
  convolver.connect(wetGain); wetGain.connect(levelGain); dryGain.connect(levelGain);
  levelGain.connect(destinationNode);
  levelGain.connect(roomVerb); roomVerb.connect(roomMix); roomMix.connect(destinationNode);

  const updateRouting = () => {
    const active = hasIR && isEnabled;
    wetGain.gain.value = active ? 1 : 0; dryGain.gain.value = active ? 0 : 1;
  };

  return {
    connectSource(src) {
      try { src.disconnect(); } catch (_) {}
      src.connect(inputStage);
    },
    async loadBuffer(arrayBuffer, path) {
      convolver.buffer = await audioCtx.decodeAudioData(arrayBuffer);
      hasIR = true; currentIrPath = path; updateRouting();
    },
    setAudioBuffer(audioBuffer, path) {
      convolver.buffer = audioBuffer;
      hasIR = true;
      currentIrPath = path;
      updateRouting();
    },	
    setBypass(en) { isEnabled = Boolean(en); updateRouting(); },
    setLevel(v) { levelGain.gain.value = parseFloat(v); },
    setRoom(v) { roomMix.gain.value = parseFloat(v); },
    getState: () => ({ irPath: currentIrPath, level: levelGain.gain.value, room: roomMix.gain.value, enabled: isEnabled }),
    setState(s) {
      if (!s) return;
      if (typeof s.level === "number") levelGain.gain.value = s.level;
      if (typeof s.room === "number") roomMix.gain.value = s.room;
      if (typeof s.enabled === "boolean") { isEnabled = s.enabled; updateRouting(); }
    }
  };
}
