# Sonix Keyboard Flasher

This is the repository for a single page application capable of flashing the
firmware of Sonix sn32-based keyboards. It's a port of the official [Sonix 
Flasher][1] desktop application.

The app itself is hosted at https://sonixflasher.github.io.

## Usage

> [!CAUTION]
> Flashing comes with risks and the authors and maintainers of this repository
> hold no liability for bricked devices. You should take all necessary
> precautions before flashing your device.

You **must** boot into bootloader to flash the firmware. If you have previously
flashed your keyboard, you probably have a keyboard shortcut to do this.

1. Load the webpage
2. Put your device into bootloader
3. Click "Authorise USB Device Access"
4. Choose your keyboard from the list (it may probably show as "Unknown device")
5. Select the firmware file that you wish to flash
6. Click flash and **wait for the process to end**

[1]: https://github.com/SonixQMK/sonix-flasher

## Contributing

There are some features missing from the desktop application (such as commands
to reboot into bootloader). Pull requests are welcome!
