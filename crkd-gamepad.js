// crkd-gamepad.js

export const crkdProfile = {
  frets: Array.of(1, 0, 2, 3, 4),
  strum: Array.of(12, 13),
  star: 14,
  logo: 16,
  whammy: 6,
  fillBreak: 11,
  recallReg: 8,
  transposeDown: 10,
  transposeUp: 15
};


export class CRKDGamepadController {
  constructor(profile = crkdProfile, handlers = {}) {
    this.profile = profile;
    this.handlers = handlers;
    this.prevButtons = Array.of();
    this.currentFretMask = 0;
    this.whammyHeld = false;
    this.whammyMask = 0;
    this.whammyActionFired = false;
    this.rafId = null;
  }

  reset() {
    this.prevButtons = Array.of();
    this.currentFretMask = 0;
    this.whammyHeld = false;
    this.whammyMask = 0;
    this.whammyActionFired = false;
  }

  start() {
    const poll = () => {
      const gp = Array.from(navigator.getGamepads()).find(candidate => candidate?.connected && candidate.mapping === 'standard');
      if (gp) this.update(gp);
      this.rafId = requestAnimationFrame(poll);
    };
    this.rafId = requestAnimationFrame(poll);
  }

  stop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  update(gp) {
    const isDown = (idx) => Boolean(gp.buttons.at(idx)?.pressed);
    const justPressed = (idx) => isDown(idx) && !this.prevButtons.at(idx);

    let fretMask = 0;
    this.profile.frets.forEach((btnIdx, bit) => {
      if (isDown(btnIdx)) fretMask |= (1 << bit);
    });

    if (justPressed(this.profile.logo)) this.handlers.onLogoPress?.(fretMask);
    if (justPressed(this.profile.star)) this.handlers.onStarPress?.(fretMask);
    if (justPressed(this.profile.fillBreak)) this.handlers.onFillBreak?.(fretMask);
    if (justPressed(this.profile.recallReg)) this.handlers.onRecallReg?.(fretMask);	

    const whammyDown = isDown(this.profile.whammy);
    const strumUp = justPressed(this.profile.strum.at(0));
    const strumDown = justPressed(this.profile.strum.at(1));

    if (justPressed(this.profile.transposeUp)) this.handlers.onTranspose?.(1);
    if (justPressed(this.profile.transposeDown)) this.handlers.onTranspose?.(-1);

    if (whammyDown) {
      this.whammyHeld = true;
      this.whammyMask |= fretMask;
      if (this.whammyMask === 6 && strumDown) {
        this.handlers.onTapTempo?.();
        this.whammyActionFired = true;
      }
    } else if (this.whammyHeld) {
      this.whammyHeld = false;
      if (!this.whammyActionFired) {
        this.handlers.onWhammyCommand?.(this.whammyMask);
      }
      this.whammyMask = 0;
      this.whammyActionFired = false;
    } else {
      if (fretMask !== this.currentFretMask) {
        this.currentFretMask = fretMask;
        this.handlers.onFretChange?.(fretMask);
      }
      if (strumUp) this.handlers.onStrum?.('up');
      if (strumDown) this.handlers.onStrum?.('down');
    }

    this.prevButtons = gp.buttons.map(b => Boolean(b?.pressed));
  }
}
