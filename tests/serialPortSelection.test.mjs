import assert from 'node:assert/strict';

import { selectSerialPortCandidate } from '../src/utils/serialPortSelection.js';

const ports = [
  {
    id: 'COM3',
    label: 'Bluetooth Serial Port',
    product: 'Bluetooth',
    raw: 'Bluetooth Serial Port'
  },
  {
    id: 'COM7',
    label: 'Silicon Labs CP210x USB to UART Bridge',
    product: 'CP210x',
    raw: 'USB VID:PID=10C4:EA60'
  },
];

assert.equal(
  selectSerialPortCandidate(ports, 'COM7')?.id,
  'COM7',
  'keeps the currently selected serial port when it is still present'
);

assert.equal(
  selectSerialPortCandidate([{ id: 'COM9', label: 'USB Serial Device' }])?.id,
  'COM9',
  'auto-selects the only serial port when there is exactly one'
);

assert.equal(
  selectSerialPortCandidate(ports)?.id,
  'COM7',
  'auto-selects the unique AI toy USB serial candidate from multiple ports'
);

assert.equal(
  selectSerialPortCandidate([
    { id: 'COM5', label: 'USB Serial Device', raw: 'CH340' },
    { id: 'COM6', label: 'USB Serial Device', raw: 'CP210x' },
  ]),
  null,
  'does not guess when multiple likely USB serial candidates are present'
);
