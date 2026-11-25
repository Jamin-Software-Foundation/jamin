// neouke-ble.js
const CHORD_NOTE_MAP = {
  19: ['Maj', 11, 0], // 7
  20: ['Maj', 10, 0], // 7b
  127: ['Maj', 8, 0], // 6b
  15: ['Min', 9, 0],  // 6m
  16: ['Min', 9, 0],  // 6m
  17: ['Maj', 9, 0],  // 6
  13: ['Maj', 7, 0],  // 5
  12: ['Sus4', 7, 0], // 5sus
  14: ['Maj', 7, 11], // 5/7
  1:  ['Maj', 0, 0],  // 1
  0:  ['Sus4', 0, 0], // 1sus
  2:  ['Maj', 0, 4],  // 1/3
  10: ['Maj', 5, 0],  // 4
  9:  ['Maj', 5, 9],  // 4/6
  3:  ['Min', 2, 0],  // 2m
  4:  ['Min', 2, 0],  // 2m
  5:  ['Maj', 2, 0],  // 2
  11: ['Min', 5, 0],  // 4m
  6:  ['Min', 4, 0],  // 3m
  7:  ['Min', 4, 0],  // 3m
  8:  ['Maj', 4, 0],  // 3
  18: ['Maj', 6, 0]   // 5b
};

export function initNeoUke({ arranger, getRegs, logger }) {
  const btn = document.getElementById('btn-neouke');
  if (!btn) return;

  let neoukeDevice = null;
  let currentProject = 0;

  async function setupDevice() {
    if (!neoukeDevice) return;
    btn.classList.add('active');

    neoukeDevice.addEventListener('gattserverdisconnected', () => {
      btn.classList.remove('active');
      logger(`Bluetooth device ${neoukeDevice.name || 'NeoUke'} disconnected.`);
    });

    const server = await neoukeDevice.gatt.connect();
    const services = await server.getPrimaryServices();

    for (const service of services) {
      const characteristics = await service.getCharacteristics();
      for (const char of characteristics) {
        if (!char.properties.notify) continue;
        const notifier = await char.startNotifications();
        notifier.addEventListener('characteristicvaluechanged', (evt) => {
          const data = new Uint8Array(evt.target.value.buffer);
          const state = arranger.getState();

          // 7-byte SysEx: Variation / Fill or Registration Roller
          if (data.length === 7 && data.at(2) === 240 && data.at(6) === 247) {
            if (data.at(3) === 10) {
              if (data.at(4) === 1) arranger.nextVar();
              else if (data.at(4) === 0) arranger.playFill(Math.max(0, state.currentVariation));
            } else if ((data.at(3) === 2 || data.at(3) === 3) && !state.isPlaying) {
              const regs = getRegs();
              if (regs && !regs.isRecalling()) {
                currentProject = data.at(3) === 2
                  ? (currentProject + 1 > 20 ? 1 : currentProject + 1)
                  : Math.max(1, currentProject - 1);
                const regSelect = document.getElementById('reg-select');
                if (regSelect) regSelect.selectedIndex = currentProject - 1;
                regs.recall(currentProject);
              }
            }
          }
          // 13-byte SysEx: Start / Stop Arranger
          else if (data.length === 13 && data.at(2) === 240 && data.at(12) === 247) {
            arranger.toggleStartEnd();
          }
          // 11-byte Chord Key Press
          else if (data.length === 11 && data.at(8) === 144 && data.at(10) === 127) {
            const chord = CHORD_NOTE_MAP[data.at(9)];
            if (chord) {
              arranger.requestVariation();
              arranger.changeChord(chord.at(0), chord.at(1), chord.at(2));
            }
          }
        });
      }
    }
    logger(`Connected to ${neoukeDevice.name || 'Sonicake NeoUke'}.`);
  }

  btn.addEventListener('click', async () => {
    if (!navigator.bluetooth) return logger('Web Bluetooth is not supported in this browser.');
    try {
      const devices = navigator.bluetooth.getDevices ? await navigator.bluetooth.getDevices() : [];
      if (devices.length > 0) {
        neoukeDevice = devices.at(0);
        let ready = false;
        neoukeDevice.addEventListener('advertisementreceived', () => {
          if (!ready) { ready = true; setupDevice(); }
        });
        await neoukeDevice.watchAdvertisements();
      } else {
        const device = await navigator.bluetooth.requestDevice({
          filters: [{ services: ['03b80e5a-ede8-4b33-a751-6ce34ec4c700'] }]
        });
        if (device) {
          neoukeDevice = device;
          await setupDevice();
        }
      }
    } catch (err) {
      logger(`NeoUke connection failed: ${err.message}`);
    }
  });
}
