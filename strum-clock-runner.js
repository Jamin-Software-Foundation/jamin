// strum-clock-runner.js
import { StrumSeqPattern } from './strumseq-parser.js';

const WORKER_CODE = `
  let intervalId = null;
  self.onmessage = (e) => {
    if (e.data === 'start') {
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(() => self.postMessage('tick'), 5);
    } else if (e.data === 'stop') {
      if (intervalId) clearInterval(intervalId);
      intervalId = null;
    }
  };
`;

export class StrumClockRunner {
  constructor(voice, onTick = () => {}) {
    this.suppressTickUntilSec = 0;	  
    this.voice = voice;
    this.onTick = onTick;
    this.pattern = new StrumSeqPattern();
    this.bpm = this.pattern.bpm;
    this.seqStep = 1;
    this.audioCtx = null;
    this.barStartTimeSec = null;
    this.nextStepTimeSec = 0;
    this.gridStepCounter = 0;
    this.isRunning = false;
    this.getVoicingFn = null;
    this.tapTimes = Array.of();

    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
    this.worker = new Worker(URL.createObjectURL(blob));
    this.worker.onmessage = () => this.onWorkerTick();
  }

  setAudioContext(ctx) { this.audioCtx = ctx; }

  nowSec() {
    return this.audioCtx ? this.audioCtx.currentTime : performance.now() / 1000;
  }

  loadXML(xmlText) {
    if (!this.pattern.parse(xmlText)) return false;
    this.bpm = this.pattern.bpm;
    return true;
  }

  syncBarStart(timeSec = this.nowSec()) {
    this.barStartTimeSec = timeSec;
  }

  getNearestStep(timeSec = this.nowSec()) {
    const sixteenthSec = 60 / this.bpm / 4;
    if (this.barStartTimeSec === null) this.barStartTimeSec = timeSec;
    const totalSteps = Math.max(0, Math.round((timeSec - this.barStartTimeSec) / sixteenthSec));
    return {
      totalSteps,
      stepNum: (totalSteps % 16) + 1,
      sixteenthSec
    };
  }

  executeStep(stepNum, voicing) {
    const { shouldMutePrev, event } = this.pattern.getStepData(stepNum);
    if (shouldMutePrev) this.voice.muteAllStrings();
    if (!event || !voicing) return;

    switch (event.articulation) {
      case 72: this.voice.strumChord(voicing, { direction: 'down', velocity: event.velocity, spreadMs: 36 }); break;
      case 74: this.voice.strumChord(voicing, { direction: 'down', velocity: event.velocity, spreadMs: 26, subset: 'treble' }); break;
      case 76: this.voice.strumChord(voicing, { direction: 'up', velocity: event.velocity, spreadMs: 28, subset: 'treble' }); break;
      case 77:
      case 79: this.voice.triggerGuitarNoise(event.articulation === 77 ? 'down' : 'up', voicing, this.bpm); break;
      default:
        if (event.articulation >= 81 && event.articulation <= 86) {
          const strIdx = event.articulation - 81;
          if (voicing.strings.at(strIdx) !== null) {
            this.voice.pluckString(strIdx, voicing.strings.at(strIdx), event.velocity);
          }
        }
    }
  }

  startClock(getVoicingFn) {
    this.getVoicingFn = getVoicingFn;
    const now = this.nowSec();
    const { totalSteps, sixteenthSec } = this.getNearestStep(now);

    this.gridStepCounter = totalSteps;
    this.seqStep = (this.gridStepCounter % 16) + 1;
    const voicing = this.getVoicingFn();

    // Only play if the .strumseq XML actually has a <Note> on this step
    if (voicing) this.executeStep(this.seqStep, voicing);
    this.onTick(this.seqStep);

    this.gridStepCounter += 1;
    this.nextStepTimeSec = this.barStartTimeSec + (this.gridStepCounter * sixteenthSec);
    this.isRunning = true;
    this.worker.postMessage('start');
  }

  onWorkerTick() {
    if (!this.isRunning || !this.getVoicingFn) return;
    const now = this.nowSec();
    const sixteenthSec = 60 / this.bpm / 4;

    if (now >= this.nextStepTimeSec - 0.002) {
      this.seqStep = (this.gridStepCounter % 16) + 1;
      const voicing = this.getVoicingFn();

      // Only trigger if not suppressed by an immediate chord-change strum <65ms ago
      if (voicing && now >= this.suppressTickUntilSec) {
        this.executeStep(this.seqStep, voicing);
      }
      this.onTick(this.seqStep);

      this.gridStepCounter += 1;
      this.nextStepTimeSec += sixteenthSec;
    }
  }

  stopClock() {
    this.isRunning = false;
    this.worker.postMessage('stop');
  }

  registerTap() {
    const nowMs = performance.now();
    this.tapTimes = this.tapTimes.filter(t => nowMs - t < 2500);
    this.tapTimes.push(nowMs);
    if (this.tapTimes.length >= 2) {
      const avg = this.tapTimes.slice(1).reduce((s, t, i) => s + (t - this.tapTimes.at(i)), 0) / (this.tapTimes.length - 1);
      this.bpm = Math.round(Math.min(240, Math.max(50, 60000 / avg)));
      this.barStartTimeSec = this.nowSec();
      return true;
    }
    return false;
  }
}
