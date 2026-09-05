const AI_TOY_SERIAL_HINTS = [
  'usbmodem',
  'usbserial',
  'usb serial',
  'usb-to-serial',
  'cp210',
  'ch340',
  'ch910',
  'silicon labs',
  'wch',
  'esp32',
  'uart',
];

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function getDeviceText(device) {
  return [
    device?.id,
    device?.sn,
    device?.path,
    device?.label,
    device?.model,
    device?.product,
    device?.manufacturer,
    device?.vendorId,
    device?.productId,
    device?.raw,
  ].filter(Boolean).join(' ');
}

function matchesCurrentPort(device, currentValue) {
  const current = normalize(currentValue);
  if (!current) return false;
  return [device?.id, device?.sn, device?.path].some((value) => normalize(value) === current);
}

function isLikelyAiToySerialPort(device) {
  const text = normalize(getDeviceText(device));
  return AI_TOY_SERIAL_HINTS.some((hint) => text.includes(hint));
}

export function selectSerialPortCandidate(devices = [], currentValue = '') {
  const validDevices = (Array.isArray(devices) ? devices : []).filter((device) => device?.id);
  if (!validDevices.length) return null;

  const currentDevice = validDevices.find((device) => matchesCurrentPort(device, currentValue));
  if (currentDevice) return currentDevice;

  if (validDevices.length === 1) return validDevices[0];

  const likelyDevices = validDevices.filter(isLikelyAiToySerialPort);
  return likelyDevices.length === 1 ? likelyDevices[0] : null;
}
