import { SoundBankLoader, SpessaSynthProcessor } from './spessasynth/spessasynth_core.js';
import { StbVorbis } from './spessasynth/stb-vorbis.js';

class SpessaLoopWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.synth = null;
    this.activeSchedule = null;
    this.playheadSample = 0;
    this.loopPlayback = true;

    this.port.onmessage = async (event) => {
      const msg = event.data;

      if (msg.type === 'init') {
        const soundBank = SoundBankLoader.fromArrayBuffer(msg.sf2Buffer);
        this.synth = new SpessaSynthProcessor(sampleRate);
        this.synth.soundBankManager.addSoundBank(soundBank, 'main');
        await this.synth.ready;
        this.synth.setSystemParameter('autoAllocateVoices', true);
        this.port.postMessage({ type: 'ready' });
      } else if (msg.type === 'play') {
        if (this.synth) this.synth.stopAll(true);
        this.activeSchedule = msg.schedule;
        this.playheadSample = 0;
        this.loopPlayback = msg.loop;
      } else if (msg.type === 'stop') {
        this.activeSchedule = null;
        if (this.synth) this.synth.stopAll(true);
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs.at(0);
    if (!output || output.length < 2) return true;

    const left = output.at(0);
    const right = output.at(1);
    left.fill(0);
    right.fill(0);

    if (!this.synth) return true;

    const quantum = left.length; // Always 128 samples in AudioWorklet
    if (this.activeSchedule) {
      const startSample = this.playheadSample;
      const endSample = startSample + quantum;

      for (const ev of this.activeSchedule.events) {
        if (ev.sample >= startSample && ev.sample < endSample) {
          if (ev.type === 'cc') this.synth.controllerChange(ev.channel, ev.controller, ev.value);
          else if (ev.type === 'program') this.synth.programChange(ev.channel, ev.program);
          else if (ev.type === 'noteOn') this.synth.noteOn(ev.channel, ev.midi, ev.velocity);
          else if (ev.type === 'noteOff') this.synth.noteOff(ev.channel, ev.midi);
        }
      }

      this.playheadSample += quantum;

      if (this.playheadSample >= this.activeSchedule.totalSamples) {
        if (this.loopPlayback) {
          this.playheadSample = 0;
        } else {
          this.activeSchedule = null;
          this.port.postMessage({ type: 'ended' });
        }
      }
    }

    this.synth.process(left, right, 0, quantum);
    return true;
  }
}

registerProcessor('spessa-loop-worklet', SpessaLoopWorkletProcessor);
