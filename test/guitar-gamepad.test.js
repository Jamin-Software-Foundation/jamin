import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuitarInput, crkdProfile } from '../guitar-gamepad.js';

function setup() {
    const calls = [];
    const actions = Object.fromEntries(['toggle', 'chord', 'variation', 'nextVariation', 'transpose']
        .map(name => [name, (...args) => calls.push([name, ...args])]));
    const input = createGuitarInput(crkdProfile, actions);
    const update = (...pressed) => input.update({
        buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index) }))
    });
    update();
    return { calls, update, input };
}

test('all twenty fret shapes trigger their Nashville chord only on strum edges', () => {
    const shapes = [
        [4, 'Maj', 0, 0], [8, 'Min', 2, 2], [9, 'Min', 4, 4], [16, 'Maj', 5, 5],
        [1, 'Maj', 7, 7], [2, 'Min', 9, 9], [20, 'Sus4', 0, 0], [12, 'Maj', 0, 4],
        [10, 'Maj', 2, 2], [26, 'Maj', 3, 3], [13, 'Maj', 4, 4], [30, 'Min', 5, 5],
        [28, 'Maj', 5, 7], [24, 'Maj', 5, 9], [5, 'Sus4', 7, 7], [17, 'Min', 7, 7],
        [3, 'Maj', 7, 11], [7, 'Maj', 6, 6], [14, 'Maj', 9, 9], [6, 'Maj', 10, 10]
    ];
    const { calls, update } = setup();
    for (const [mask, ...chord] of shapes) {
        const frets = crkdProfile.frets.filter((_, bit) => mask & (1 << bit));
        update(...frets);
        update(...frets, 12);
        update(...frets, 12);
        update(...frets);
        update(...frets, 13);
        update();
        assert.deepEqual(calls.splice(0), [['chord', ...chord], ['chord', ...chord]]);
    }
    update(0, 1, 2, 3, 4, 12);
    update();
    update(12);
    assert.deepEqual(calls, []);
});

test('starpower selects variations in either press order, and alone advances on release', () => {
    const { calls, update } = setup();
    for (const [button, variation] of [[0, 0], [1, 1], [3, 2], [2, 3]]) {
        update(button); update(button, 8); update(button, 8, 12); update(); update();
        assert.deepEqual(calls.splice(0), [['variation', variation]]);
        update(8); update(8, button); update(8); update();
        assert.deepEqual(calls.splice(0), [['variation', variation]]);
    }
    update(8); update();
    update(4, 8); update();
    assert.deepEqual(calls.splice(0), [['nextVariation'], ['nextVariation']]);
    update(0, 1, 8); update();
    assert.deepEqual(calls, []);
});

test('logo and headstock controls are edge triggered and reset on disconnect', () => {
    const { calls, update, input } = setup();
    update(16, 14); update(16, 14); update(); update(15); update();
    assert.deepEqual(calls.splice(0), [['toggle'], ['transpose', -1], ['transpose', 1]]);
    input.reset();
    update(16);
    assert.deepEqual(calls, []);
    update(); update(16);
    assert.deepEqual(calls, [['toggle']]);
    calls.length = 0;
    input.reset();
    update(8); update();
    assert.deepEqual(calls, []);
});
