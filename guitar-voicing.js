// guitar-voicing.js

// Fret masks use green, red, yellow, blue and orange as bits 0 through 4.
export const guitarChords = {
  4: ['Maj', 0, 0],   8: ['Min', 2, 2],   9: ['Min', 4, 4],
  16: ['Maj', 5, 5],  1: ['Maj', 7, 7],   2: ['Min', 9, 9],
  20: ['Sus4', 0, 0], 12: ['Maj', 0, 4],  10: ['Maj', 2, 2],
  26: ['Maj', 3, 3],  13: ['Maj', 4, 4],  30: ['Min', 5, 5],
  28: ['Maj', 5, 7],  24: ['Maj', 5, 9],  5: ['Sus4', 7, 7],
  17: ['Min', 7, 7],  3: ['Maj', 7, 11],  7: ['Maj', 6, 6],
  14: ['Maj', 9, 9],  6: ['Maj', 10, 10]
};

export const ARPEGGIO_SEQUENCES = {
  // 8 Folk / Travis & Alternating Bass Rolls (Yellow)
  ARP_YELLOW: Array.of(
    Array.of('bass', 3, 4, 2, 5, 3),             // Var 1: Classic Travis Folk Roll
    Array.of('bass', 2, 3, 4, 3, 2),             // Var 2: Gentle Inside Pendulum
    Array.of('bass', 3, 2, 4, 3, 5, 3, 4),       // Var 3: Extended Country Roll
    Array.of('bass', 4, 3, 5, 2, 4, 3, 5),       // Var 4: High-Energy Bluegrass Crosspick
    Array.of('bass', 2, 4, 3, 5, 2, 4, 3),       // Var 5: Syncopated Singer-Songwriter
    Array.of('bass', 3, 5, 4, 2, 5, 4, 3),       // Var 6: Reverse Travis Bounce
    Array.of('bass', 2, 3, 5, 4, 2, 3, 5),       // Var 7: Wide-Interval Folk Harp
    Array.of('bass', 3, 4, 5, 2, 4, 5, 3)        // Var 8: Finale Driving Travis
  ),

  // 8 Classical / Ascending & Cascading Sweeps (Blue)
  ARP_BLUE: Array.of(
    Array.of('bass', 2, 3, 4, 5, 4, 3, 2),       // Var 1: Standard Pyramid Sweep
    Array.of('bass', 3, 4, 5, 4, 3),             // Var 2: Tight 6-Eighth Waltz/Ballad
    Array.of('bass', 2, 3, 4, 3, 4, 5, 4),       // Var 3: Rising Classical Wave
    Array.of('bass', 5, 4, 3, 2, 3, 4, 5),       // Var 4: Descending Cascade
    Array.of('bass', 2, 4, 3, 5, 4, 3, 2),       // Var 5: Broken Thirds Sweep
    Array.of('bass', 3, 2, 4, 3, 5, 4, 5),       // Var 6: Etude Escalation
    Array.of('bass', 2, 3, 5, 4, 5, 3, 2),       // Var 7: Romantic Nocturne Roll
    Array.of('bass', 2, 3, 4, 5, 3, 4, 5)        // Var 8: Grand Arpeggio Climax
  ),

  // 8 Syncopated Pop, Latin & Contemporary Rolls (Orange)
  ARP_ORANGE: Array.of(
    Array.of('bass', 5, 4, 3, 5, 4),             // Var 1: Syncopated Pop Hook
    Array.of('bass', 4, 5, 3, 4, 5),             // Var 2: Inverted Top-String Pulse
    Array.of('bass', 3, 5, 4, 5, 3, 4),          // Var 3: Bossa / Latin Syncopation
    Array.of('bass', 5, 3, 4, 5, 2, 4),          // Var 4: Afro-Pop Highlife Pluck
    Array.of('bass', 4, 3, 5, 4, 2, 5),          // Var 5: Modern Indie-Pop Bounce
    Array.of('bass', 5, 4, 5, 3, 4, 2),          // Var 6: Cascading Treble Ostinato
    Array.of('bass', 3, 4, 5, 4, 5, 3),          // Var 7: Synth-Pop Pluck Sequence
    Array.of('bass', 5, 3, 5, 4, 5, 2)           // Var 8: Climax Polyrhythmic Roll
  )
};


const OPEN_STRINGS = Array.of(40, 45, 50, 55, 59, 64); // E2, A2, D3, G3, B3, E4
const CHORD_INTERVALS = {
  Maj:  Array.of(0, 4, 7),
  Min:  Array.of(0, 3, 7),
  Sus4: Array.of(0, 5, 7)
};

/**
 * Resolves [quality, rootOffset, bassOffset] + transpose into a 6-string MIDI array.
 * Index 0 = Low E (string 6), Index 5 = High E (string 1).
 */
export function resolveSixStringVoicing(chordDef, transpose = 0) {
  if (!chordDef) return null;
  const [quality, rootOffset, bassOffset] = chordDef;
  const rootPc = (rootOffset + transpose + 120) % 12;
  const bassPc = (bassOffset + transpose + 120) % 12;
  const intervals = CHORD_INTERVALS[quality] || CHORD_INTERVALS.Maj;
  const chordPcs = intervals.map(iv => (rootPc + iv) % 12);

  let bassString = 0;
  let bassMidi = null;

  for (let s = 0; s <= 2; s++) {
    const openPc = OPEN_STRINGS.at(s) % 12;
    const fret = (bassPc - openPc + 12) % 12;
    if (fret <= 4) {
      bassString = s;
      bassMidi = OPEN_STRINGS.at(s) + fret;
      break;
    }
  }

  if (bassMidi === null) {
    bassString = 1;
    const aString = OPEN_STRINGS.at(1);
    bassMidi = aString + ((bassPc - (aString % 12) + 12) % 12);
  }

  const strings = Array.of(null, null, null, null, null, null);
  strings[bassString] = bassMidi;

  for (let s = bassString + 1; s < 6; s++) {
    for (let fret = 0; fret <= 5; fret++) {
      const candidate = OPEN_STRINGS.at(s) + fret;
      if (chordPcs.includes(candidate % 12) && candidate > strings[s - 1]) {
        strings[s] = candidate;
        break;
      }
    }
  }

  return { strings, bassString };
}
