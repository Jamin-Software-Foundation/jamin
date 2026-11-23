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
  ARP_YELLOW: ['bass', 3, 4, 2, 5, 3],       // Travis / Folk Roll
  ARP_BLUE:   ['bass', 2, 3, 4, 5, 4, 3, 2], // Ascending Classical Sweep
  ARP_ORANGE: ['bass', 5, 4, 3, 5, 4]        // Syncopated Pop / Spanish Roll
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
