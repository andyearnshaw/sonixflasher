/**
 * Ported from SonixQMK/sonix-flasher with a little cleanup.
 */

const RESPONSE_LEN = 64;
const CHUNK_SIZE = 64;
const MAX_FIRMWARE_SN32F260 = 30 * 1024;  // 30K
const MAX_FIRMWARE_SN32F240 = 64 * 1024;  // 64K Also 240B

const CMD_BASE = 0x55AA00;
const CMD_INIT = CMD_BASE + 1;
const CMD_PREPARE = CMD_BASE + 5;
const CMD_REBOOT = CMD_BASE + 7;

const EXPECTED_STATUS = 0xFAFAFAFA;

const vendorId = 0x0c45; // Sonix Technology Co., Ltd

// Only supporting keyboards in bootloader mode for now
export const supportedDevices = [
  { vendorId, productId: 0x7010, description: "SN32F268F (bootloader)", qmkOffset: 0x200 },
  { vendorId, productId: 0x7040, description: "SN32F248B (bootloader)", qmkOffset: 0x0 },
  { vendorId, productId: 0x7900, description: "SN32F248 (bootloader)", qmkOffset: 0x0 },
];

const firmwareSizeLimits = {
  [0x7010]: MAX_FIRMWARE_SN32F260,
  [0x7040]: MAX_FIRMWARE_SN32F240,
  [0x7900]: MAX_FIRMWARE_SN32F240,
};

const pad = data => {
  if (data.length % CHUNK_SIZE === 0) {
    return data;
  }
  const padding = new Uint8Array(CHUNK_SIZE - (data.length % CHUNK_SIZE));
  return new Uint8Array([...data, ...padding]);
}

function hidSetFeatureReport(device, report, sendReportId = true) {
  if (report.length > RESPONSE_LEN) {
    throw new Error(`Report must be less than ${RESPONSE_LEN} bytes`);
  }

  // Pad the report to 64 bytes as necessary
  report = pad(report);

  if (sendReportId) {
    return device.sendFeatureReport(0x00, report);
  } else {
    return device.sendReport(report.slice(0, 1), report.slice(1));
  }
}

async function hidGetFeatureReport(device) {
  const report = await device.receiveFeatureReport(0x00);
  return new Uint8Array(report.buffer);
}

const pack = (...data) => {
  const array = new Uint8Array(data.length * 4);
  const view = new DataView(array.buffer);

  data.forEach((value, index) => {
    view.setUint32(index * 4, value, true);
  });

  return array;
}

const unpack = (data) => {
  const view = new DataView(data.buffer);
  const result = [];

  for (let i = 0; i < data.length; i += 4) {
    result.push(view.getUint32(i, true));
  }

  return result;
}

/**
 * Flashes firmware to the provided device. Yields progress updates.
 *
 * @param {HIDDevice} device
 * @param {Uint8Array} firmware
 * @param {number} qmkOffset
 * @returns {AsyncIterator<>}
 */
export async function* flashDevice(device, firmware, qmkOffset) {
  const format = (data) => `0x${data.toString(16).padStart(8, "0")}`;

  if (firmware.length > firmwareSizeLimits[device.productId]) {
    throw new Error(`Firmware size exceeds maximum of ${firmwareSizeLimits[device.productId]} bytes`);
  }

  firmware = pad(firmware);

  yield { step: "initialize", progress: 0 };

  // 1) Initialize
  if (!device.opened) {
    await device.open();
  }
  await hidSetFeatureReport(device, pack(CMD_INIT));
  const initResponse = await hidGetFeatureReport(device);

  if (initResponse.length !== RESPONSE_LEN) {
    throw new Error(`Failed to initialize: got response of length ${initResponse.length}, expected ${RESPONSE_LEN}`);
  }

  const [initCmd, initStatus] = unpack(initResponse);

  if (initCmd !== CMD_INIT) {
    throw new Error(`Failed to initialize: response cmd is ${format(initCmd)}, expected ${format(CMD_INIT)}`);
  }
  if (initStatus !== EXPECTED_STATUS) {
    throw new Error(`Failed to initialize: response status is ${format(initStatus)}, expected ${format(EXPECTED_STATUS)}`);
  }

  // 2) Prepare for flashing
  yield { step: "prepare", progress: 0 };

  await hidSetFeatureReport(device, pack(CMD_PREPARE, qmkOffset, firmware.length));
  const prepResponse = await hidGetFeatureReport(device);
  const [prepCmd, prepStatus] = unpack(prepResponse);

  if (prepCmd !== CMD_PREPARE) {
    throw new Error(`Failed to prepare: response cmd is ${format(prepCmd)}, expected ${format(CMD_PREPARE)}`);
  }
  if (prepStatus !== EXPECTED_STATUS) {
    throw new Error(`Failed to prepare: response status is ${format(prepStatus)}, expected ${format(EXPECTED_STATUS)}`);
  }

  // 3) Flash the firmware
  yield { step: "flash", progress: 0 };

  for (let offset = 0; offset < firmware.length; offset += CHUNK_SIZE) {
    const chunk = firmware.slice(offset, offset + CHUNK_SIZE);
    await hidSetFeatureReport(device, chunk);

    yield { step: "flash", progress: (offset + chunk.length) / firmware.length };
  }

  // 4) Reboot the device
  yield { step: "reboot", progress: 1 };
  await hidSetFeatureReport(device, pack(CMD_REBOOT));

  // Artificial delay to allow device to reboot
  await new Promise(resolve => setTimeout(resolve, 5000));

  yield { step: "complete", progress: 1 };
}

/**
 * Checks the firmware to ensure the validity
 *
 * @param {Uint8Array} firmware
 * @param {number} qmkOffset
 * @returns {boolean}
 */
export function validateFirmware(device, firmware, qmkOffset) {
  // Early checks on firmware size
  if (firmware.length + qmkOffset > firmwareSizeLimits[device.productId]) {
    throw new Error(
      `Firmware is too large: 0x${firmware.length.toString(16).toUpperCase()} max allowed is 0x${(firmwareSizeLimits[device.productId] - qmkOffset).toString(16).toUpperCase()}`
    );
  }

  if (firmware.length < 0x100) {
    throw new Error("Firmware is too small");
  }

  // Check stack pointer is valid and that first 3 vectors have bit0 set
  const [sp, ...vecs] = unpack(firmware.slice(0, 16));

  if (
    sp < 0x20000000 ||
    sp > 0x20000800 ||
    (vecs[0] & 1) !== 1 ||
    (vecs[1] & 1) !== 1 ||
    (vecs[2] & 1) !== 1
  ) {
    throw new Error("Firmware appears to be corrupted");
  }
  return true;
}
