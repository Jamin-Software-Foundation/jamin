// Fret masks use green, red, yellow, blue and orange as bits 0 through 4.
export const guitarChords = {
    4: ['Maj', 0, 0], 8: ['Min', 2, 2], 9: ['Min', 4, 4],
    16: ['Maj', 5, 5], 1: ['Maj', 7, 7], 2: ['Min', 9, 9],
    20: ['Sus4', 0, 0], 12: ['Maj', 0, 4], 10: ['Maj', 2, 2],
    26: ['Maj', 3, 3], 13: ['Maj', 4, 4], 30: ['Min', 5, 5],
    28: ['Maj', 5, 7], 24: ['Maj', 5, 9], 5: ['Sus4', 7, 7],
    17: ['Min', 7, 7], 3: ['Maj', 7, 11], 7: ['Maj', 6, 6],
    14: ['Maj', 9, 9], 6: ['Maj', 10, 10]
};

// CRKD Les Paul, PC guitar default mode, exposed as a standard XInput gamepad.
// Other devices can supply a profile with the same button roles.
export const crkdProfile = {
    frets: [0, 1, 3, 2, 4],
    strum: [12, 13],
    star: 8,
    logo: 16,
    transposeDown: 14,
    transposeUp: 15
};

export function createGuitarInput(profile, actions) {
    let previous = null;
    let starUsed = false;
    return {
        update(gamepad) {
            const pressed = index => Boolean(gamepad.buttons[index]?.pressed);
            const frets = profile.frets.reduce((mask, index, bit) => mask | (pressed(index) ? 1 << bit : 0), 0);
            const state = {
                frets, star: pressed(profile.star), logo: pressed(profile.logo),
                up: pressed(profile.strum[0]), down: pressed(profile.strum[1]),
                transposeDown: pressed(profile.transposeDown), transposeUp: pressed(profile.transposeUp)
            };
            if (!previous) starUsed = state.star;
            if (previous) {
                if (state.logo && !previous.logo) actions.toggle();
                if (state.transposeDown && !previous.transposeDown) actions.transpose(-1);
                if (state.transposeUp && !previous.transposeUp) actions.transpose(1);
                if (state.star && (!previous.star || frets !== previous.frets)) {
                    const variation = { 1: 0, 2: 1, 4: 2, 8: 3 }[frets];
                    if (variation !== undefined) {
                        actions.variation(variation);
                        starUsed = true;
                    } else if (frets === 16) {
                        actions.nextVariation();
                        starUsed = true;
                    } else if (frets !== 0) starUsed = true;
                }
                if (!state.star && previous.star) {
                    if (!starUsed && previous.frets === 0) actions.nextVariation();
                    starUsed = false;
                }
                if (!state.star && !previous.star && ((state.up && !previous.up) || (state.down && !previous.down))) {
                    const chord = guitarChords[frets];
                    if (chord) actions.chord(...chord);
                }
            }
            previous = state;
        },
        reset() { previous = null; starUsed = false; }
    };
}
