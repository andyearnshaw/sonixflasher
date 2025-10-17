import { flashDevice, validateFirmware, supportedDevices } from "./sn32-hid.js";

const wizard = document.getElementById('wizard');
const deviceName = document.getElementById('device-name');
const authDeviceButton = document.getElementById('authorize');
const backToAuthButton = document.getElementById('back-to-auth-btn');
const flashButton = document.getElementById('flash-btn');
const fileInput = document.getElementById('file-input');
const dropArea = document.getElementById('drop-area');
const dropAreaIcon = document.getElementById('drop-area-icon');
const dropAreaText = document.getElementById('drop-area-text');
const progressBar = document.getElementById('progress-bar');
const progressLabel = document.getElementById('progress-label');
const doneButton = document.getElementById('done-btn');
const themeAuto = document.getElementById('theme-auto');
const themeLight = document.getElementById('theme-light');
const themeDark = document.getElementById('theme-dark');

doneButton.disabled = true;

let flashInProgress = false;
let selectedDevice = null;
let selectedFirmware = null;

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error);

    reader.readAsArrayBuffer(file);
  });
}

function setSelectedDevice(device) {
  console.log('Device selected:', device);
  selectedDevice = device;

  const deviceInfo = supportedDevices.find(
    d => d.vendorId === device.vendorId && d.productId === device.productId
  );

  deviceName.textContent = deviceInfo.description;

  // Proceed to firmware selection step
  wizard.className = 'screen:control';
}

function backToDeviceSelection(forget = false) {
  if (forget && selectedDevice) {
    selectedDevice.forget();
  }

  selectedDevice = null;
  deviceName.textContent = '';
  wizard.className = 'screen:auth';
}

function backToFirmwareSelection() {
  dropArea.classList.remove('invalid', 'valid');
  wizard.className = 'screen:control';

  if (!selectedDevice) {
    backToDeviceSelection();
  }
}

async function requestDevice() {
  const device = await navigator.hid.requestDevice({
    filters: supportedDevices
  });

  if (device.length) {
    setSelectedDevice(device[0]);
  }
};

async function handleFileSelect(event) {
  flashButton.disabled = true;

  const [ file ] = fileInput.files;
  dropArea.classList.remove('invalid', 'valid');

  console.log('Firmware file selected:', file);

  try {
    const data = await readFile(file);
    validateFirmware(selectedDevice, data);
    dropArea.classList.add('valid');
    selectedFirmware = data;
    flashButton.disabled = false;
    dropAreaIcon.name = 'circle-check';
    dropAreaText.textContent = `${file.name}`;
  }
  catch (error) {
    dropArea.classList.add('invalid');
    dropAreaText.textContent = `Invalid firmware file: ${error.message}`;
    dropAreaIcon.name = 'circle-xmark';
  }
}

function dragEnter(event) {
  const { files } = event.dataTransfer;
  console.log('Files dragged in:', event);

  dropArea.classList.add('drag-over');
}

function dragLeave(event) {
  event.preventDefault();
  dropArea.classList.remove('drag-over', 'drag-over-invalid');
}

function handleDrop(event) {
  const { files } = event.dataTransfer;

  event.preventDefault();
  dropArea.classList.remove('drag-over');

  if (files.length === 1) {
    console.log('File dropped:', files[0]);
    fileInput.files = files;
    handleFileSelect();
    return;
  }

  dropArea.classList.add('invalid');
  const currentText = dropAreaText.textContent;
  const currentIcon = dropAreaIcon.name;
  dropAreaIcon.name = 'circle-xmark';
  dropAreaText.textContent = 'Too many files';

  setTimeout(() => {
    dropArea.classList.remove('invalid');
    dropAreaText.textContent = currentText;
    dropAreaIcon.name = currentIcon;
  }, 1000);
}

async function flashFirmware() {
  if (!selectedDevice || !selectedFirmware) {
    return;
  }

  wizard.className = 'screen:progress';
  progressBar.classList.remove('error', 'complete');
  progressLabel.classList.remove('error');

  const statusText = {
    initialize: 'Initializing device',
    prepare: 'Preparing for flashing',
    flash: 'Writing firmware',
    reboot: 'Rebooting device'
  }

  const deviceInfo = supportedDevices.find(
    d => d.vendorId === selectedDevice.vendorId && d.productId === selectedDevice.productId
  );

  try {
    flashInProgress = true;
    const flashIterator = flashDevice(selectedDevice, selectedFirmware, deviceInfo.qmkOffset);
    for await (const { step, progress } of flashIterator) {
      progressBar.indeterminate = step !== 'flash';
      progressBar.value = progress * 100;
      progressLabel.textContent = statusText[step];
    }

    progressBar.classList.add('complete');
    progressLabel.textContent = 'Complete';
  }
  catch (error) {
    console.error('Flashing error:', error.stack);
    progressBar.classList.add('error');
    progressLabel.classList.add('error');
    progressLabel.textContent = `Error: ${error.message}`;
  }
  finally {
    progressBar.indeterminate = false;
    progressBar.value = 100;
    flashInProgress = false;
    doneButton.disabled = false;
  }
}

function handlePageLeave() {
  if (flashInProgress) {
    return 'A firmware flash is in progress. Leaving the page may corrupt your device. Are you sure you want to leave?';
  }
}

// Set up event listeners
window.onbeforeunload = handlePageLeave;
document.addEventListener('dragover', (event) => event.preventDefault());
fileInput.addEventListener('change', handleFileSelect);
authDeviceButton.addEventListener('click', requestDevice);
backToAuthButton.addEventListener('click', () => backToDeviceSelection(true));
flashButton.addEventListener('click', flashFirmware);
doneButton.addEventListener('click', backToFirmwareSelection);
dropArea.addEventListener('dragenter', dragEnter);
dropArea.addEventListener('dragleave', dragLeave);
dropArea.addEventListener('drop', handleDrop);

themeAuto.addEventListener('click', () => {
  document.documentElement.className = 'wa-theme-solarized-auto';
});

themeLight.addEventListener('click', () => {
  document.documentElement.className = 'wa-theme-solarized-light';
});

themeDark.addEventListener('click', () => {
  document.documentElement.className = 'wa-theme-solarized-dark';
});

function isSupported(device) {
  return supportedDevices.some(
    d => d.vendorId === device.vendorId && d.productId === device.productId
  );
}

navigator.hid.addEventListener('disconnect', (event) => {
  if (event.device === selectedDevice) {
    selectedDevice = null;
    console.log('Selected device disconnected:', event.device);

    if (flashInProgress) {
      flashInProgress = false;
      progressBar.classList.add('error');
      progressLabel.classList.add('error');
      progressLabel.textContent = 'Error: Device disconnected during flash';
      doneButton.disabled = false;
    }
    else {
      backToDeviceSelection();
    }
  }
});

navigator.hid.addEventListener('connect', (event) => {
  if (!selectedDevice && isSupported(event.device)) {
    console.log('Supported device connected:', event.device);
    setSelectedDevice(event.device);
  }
});

// If a device was previously authorized, connect to it automatically
navigator.hid.getDevices().then(devices => {
  for (const device of devices) {
    if (isSupported(device)) {
      console.log('Reconnected to previously authorized device:', device);
      setSelectedDevice(device);
      break;
    }
  }
});
