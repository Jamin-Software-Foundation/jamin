// strumseq-parser.js

export const DEFAULT_STRUMSEQ_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Pattern Author="Ample Sound" Category="Pop" Time-Signature="4/4" Quantize="1/16" BPM="130">
  <Note Note="72" Velocity="100" Begin="1" End="2"/>
  <Note Note="74" Velocity="80" Begin="3" End="3"/>
  <Note Note="76" Velocity="60" Begin="4" End="5"/>
  <Note Note="76" Velocity="70" Begin="6" End="7"/>
  <Note Note="76" Velocity="60" Begin="8" End="8"/>
  <Note Note="72" Velocity="70" Begin="9" End="10"/>
  <Note Note="74" Velocity="40" Begin="11" End="11"/>
  <Note Note="76" Velocity="90" Begin="12" End="12"/>
  <Note Note="74" Velocity="50" Begin="13" End="13"/>
  <Note Note="76" Velocity="40" Begin="14" End="14"/>
  <Note Note="74" Velocity="50" Begin="15" End="15"/>
  <Note Note="76" Velocity="60" Begin="16" End="16"/>
</Pattern>`;

export class StrumSeqPattern {
  constructor(xmlText = DEFAULT_STRUMSEQ_XML) {
    this.bpm = 130;
    this.events = [];
    this.parse(xmlText);
  }

  parse(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    const pattern = doc.querySelector('Pattern');
    if (!pattern) return false;

    this.bpm = parseInt(pattern.getAttribute('BPM') || '120', 10);
    const notes = Array.from(doc.querySelectorAll('Note'));
    this.events = notes.map(n => ({
      articulation: parseInt(n.getAttribute('Note'), 10),
      velocity: parseInt(n.getAttribute('Velocity'), 10),
      begin: parseInt(n.getAttribute('Begin'), 10),
      end: parseInt(n.getAttribute('End'), 10)
    })).sort((a, b) => a.begin - b.begin);

    return true;
  }

  getStepData(stepNum) {
    return {
      shouldMutePrev: this.events.some(e => (e.end + 1) === stepNum),
      event: this.events.find(e => e.begin === stepNum) || null
    };
  }
}
