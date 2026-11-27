export const SUBDIV_LABELS = Array.of("1/16", "1/8", "1/8D", "1/4", "1/4D", "1/2");
const SUBDIV_MULTS = Array.of(0.25, 0.5, 0.75, 1.0, 1.5, 2.0);

export function getSubdivIndex(v2) {
  return Math.min(5, Math.floor((v2 / 128) * 6));
}

function getDelaySeconds(v2, bpm) {
  const mult = SUBDIV_MULTS.at(getSubdivIndex(v2));
  const sec = (60 / Math.max(40, bpm)) * mult;
  return Math.max(0.05, Math.min(1.95, sec));
}

export const DEFAULT_PEDALS = [
  { id: "wah",    name: "Auto Wah",   color: "#047857", l1: "Sens",  v1: 85, l2: "Res",    v2: 65, active: false },
  { id: "drive",  name: "Overdrive",  color: "#b91c1c", l1: "Drive", v1: 75, l2: "Tone",   v2: 70, active: true },
  { id: "eq",     name: "Guitar EQ",  color: "#b45309", l1: "Bass",  v1: 64, l2: "Treble", v2: 72, active: true },
  { id: "chorus", name: "Chorus",     color: "#0369a1", l1: "Depth", v1: 70, l2: "Rate",   v2: 45, active: false },
  { id: "delay",  name: "Echo Delay", color: "#6d28d9", l1: "Mix",   v1: 65, l2: "1/8D",   v2: 52, active: true }
];

function makeTubeCurve(drive) {
  const k = 1 + (drive / 127) * 45;
  const n = 44100;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = x >= 0 ? Math.tanh(x * k) : Math.tanh(x * k * 0.8) * 0.92;
  }
  return curve;
}

function buildPedalNodes(ctx) {
  let currentBpm = 120;

  const wahIn = ctx.createGain(), wahOut = ctx.createGain();
  const wahFilter = ctx.createBiquadFilter(), analyser = ctx.createAnalyser();
  wahFilter.type = "lowpass"; wahFilter.frequency.value = 350; analyser.fftSize = 256;
  wahIn.connect(analyser); wahIn.connect(wahFilter); wahFilter.connect(wahOut);
  let wahSens = 0.65;
  const envData = new Uint8Array(analyser.frequencyBinCount);
  (function trackEnv() {
    analyser.getByteTimeDomainData(envData);
    let peak = 0;
    for (let i = 0; i < envData.length; i++) peak = Math.max(peak, Math.abs(envData[i] - 128) / 128);
    wahFilter.frequency.setTargetAtTime(320 + Math.min(peak * wahSens * 9000, 2600), ctx.currentTime, 0.025);
    requestAnimationFrame(trackEnv);
  })();

  const driveIn = ctx.createGain(), driveOut = ctx.createGain();
  const preGain = ctx.createGain(), shaper = ctx.createWaveShaper(), tone = ctx.createBiquadFilter();
  shaper.oversample = "4x"; tone.type = "lowpass";
  driveIn.connect(preGain); preGain.connect(shaper); shaper.connect(tone); tone.connect(driveOut);

  const eqIn = ctx.createGain(), eqOut = ctx.createGain();
  const lowShelf = ctx.createBiquadFilter(), highShelf = ctx.createBiquadFilter();
  lowShelf.type = "lowshelf"; lowShelf.frequency.value = 180;
  highShelf.type = "highshelf"; highShelf.frequency.value = 2800;
  eqIn.connect(lowShelf); lowShelf.connect(highShelf); highShelf.connect(eqOut);

  const chorusIn = ctx.createGain(), chorusOut = ctx.createGain();
  const merger = ctx.createChannelMerger(2), dL = ctx.createDelay(), dR = ctx.createDelay();
  const lfo = ctx.createOscillator(), gL = ctx.createGain(), gR = ctx.createGain(), cWet = ctx.createGain();
  dL.delayTime.value = 0.014; dR.delayTime.value = 0.019; gL.gain.value = 0.006; gR.gain.value = -0.006;
  lfo.connect(gL); lfo.connect(gR); gL.connect(dL.delayTime); gR.connect(dR.delayTime); lfo.start();
  chorusIn.connect(chorusOut); chorusIn.connect(dL); chorusIn.connect(dR);
  dL.connect(merger, 0, 0); dR.connect(merger, 0, 1); merger.connect(cWet); cWet.connect(chorusOut);

  const delayIn = ctx.createGain(), delayOut = ctx.createGain();
  const dNode = ctx.createDelay(2.0), dFb = ctx.createGain(), dTone = ctx.createBiquadFilter(), dWet = ctx.createGain();
  dFb.gain.value = 0.55; dTone.type = "lowpass"; dTone.frequency.value = 2600;
  delayIn.connect(delayOut); delayIn.connect(dNode); dNode.connect(dTone);
  dTone.connect(dFb); dFb.connect(dNode); dTone.connect(dWet); dWet.connect(delayOut);

  return {
    wah:    { input: wahIn,    output: wahOut,    update: (p) => { wahSens = (p.v1 / 127) * 1.4; wahFilter.Q.value = 1.5 + (p.v2 / 127) * 10; } },
    drive:  { input: driveIn,  output: driveOut,  update: (p) => { preGain.gain.value = 1 + (p.v1 / 127) * 3; shaper.curve = makeTubeCurve(p.v1); tone.frequency.value = 1200 + (p.v2 / 127) * 4500; } },
    eq:     { input: eqIn,     output: eqOut,     update: (p) => { lowShelf.gain.value = ((p.v1 - 64) / 64) * 14; highShelf.gain.value = ((p.v2 - 64) / 64) * 14; } },
    chorus: { input: chorusIn, output: chorusOut, update: (p) => { cWet.gain.value = (p.v1 / 127) * 0.9; lfo.frequency.value = 0.3 + (p.v2 / 127) * 4.5; } },
    delay:  {
      input: delayIn, output: delayOut,
      update: (p) => {
        dWet.gain.setTargetAtTime((p.v1 / 127) * 1.15, ctx.currentTime, 0.015);
        dNode.delayTime.setTargetAtTime(getDelaySeconds(p.v2, currentBpm), ctx.currentTime, 0.04);
      },
      setBpm: (bpm, p) => {
        currentBpm = bpm;
        if (p) dNode.delayTime.setTargetAtTime(getDelaySeconds(p.v2, currentBpm), ctx.currentTime, 0.04);
      }
    }
  };
}

export function createPedalChain(audioCtx, cabinet) {
  const nodes = buildPedalNodes(audioCtx);
  const chainInput = audioCtx.createGain();

  return {
    input: chainInput,
    setBpm(bpm, pedals) {
      nodes.delay?.setBpm(bpm, pedals.find(p => p.id === "delay"));
    },
    sync(pedals) {
      chainInput.disconnect();
      Object.values(nodes).forEach(n => n.output.disconnect());
      let current = chainInput;
      document.querySelectorAll(".slot").forEach(slotEl => {
        const id = slotEl.querySelector(".pedal")?.dataset.id;
        const pedal = pedals.find(p => p.id === id);
        if (pedal && pedal.active && nodes[id]) {
          nodes[id].update(pedal);
          current.connect(nodes[id].input);
          current = nodes[id].output;
        }
      });
      cabinet.connectSource(current);
    }
  };
}
