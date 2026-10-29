# XP-Pen Deco 01 V3 (IC903 / Rev B) — Custom Firmware

Custom high-performance firmware for the **XP-Pen Deco 01 V3** graphics tablet powered by the **IC903** microcontroller (**Rev B** hardware revision).

> 🇷🇺 **Russian documentation**: [README_RU.md](README_RU.md)  
> 🔬 **Technical Reverse Engineering Dossier**: [TASK.md](TASK.md)

---

## ⚡ Key Features

* 🚀 **Polling Rate Overclocking**:
  * Stock polling rate: **~220–240 Hz** (`bInterval = 4 ms`).
  * Custom firmware v4: **up to 400–500 Hz** via coil matrix scan optimization (**5-Coil Optimization**) and hardware timer overclocking.
* 🎯 **Hardware Zero-Smoothing (Raw Coordinates)**:
  * Hardware-level bypass of built-in smoothing and jitter-reduction filters.
  * True 1:1 raw coordinate reporting with zero interpolation lag.
  * Essential for rhythm games (**osu!**) and ultra-responsive sketching/drawing.
* 🛡️ **Safe Flashing Architecture**:
  * Only modifies the application code section (`ic903-code.bin`, base address `0x00006000`).
  * Factory DFU bootloader and calibration/state pages are untouched. Reverting to factory stock firmware is always possible.

---

## 📁 Repository Layout

```text
tablet-reverse-engeneering/
├── README.md               # Main User Guide (English)
├── README_RU.md            # User Guide (Russian)
├── TASK.md                 # Technical Reverse Engineering Specification & Notes
├── firmwares/
│   ├── custom_firmware/    # Ready-to-flash custom firmwares (.bin and .hex)
│   │   ├── v4/             # Current release (5-Coil Optimization, 400–500Hz)
│   │   ├── v3/             # Intermediate release (Scaled Carrier Table, ~325–342Hz)
│   │   ├── v2/             # 300Hz release
│   │   └── v1/             # Initial 270Hz release
│   ├── original_firmware/  # Clean factory dump for Deco 01 V3 Rev B
│   └── reference_firmware/ # Reference IC902 dumps & patches by NiceAesth
├── src/
│   ├── build_firmware.js   # Automated firmware patch engine and compiler
│   ├── analyze_firmware.js # Binary inspection and parameter verification tool
│   └── diff_ic902.js       # IC902 stock vs patched comparative analyzer
└── tools/
    └── xppen-tools.exe     # XP-Pen/UGEE DFU flashing utility (by NiceAesth)
```

---

## 🎮 Pre-Built Firmware Binaries (Revision v4)

Ready-to-flash Intel HEX files are located in [`firmwares/custom_firmware/v4/`](firmwares/custom_firmware/v4/):

| Firmware File | USB Rate | Smoothing | Description |
|---|---|---|---|
| **`ic903-500hz-nosmoothing-v4.hex`** | **500 Hz** | **Disabled (Zero)** | **Recommended:** maximum responsiveness for osu! and drawing |
| **`ic903-500hz-v4.hex`** | **500 Hz** | Enabled (Stock) | High polling rate with smooth stock coordinate interpolation |
| **`ic903-1000hz-nosmoothing-v4.hex`** | **1000 Hz** | **Disabled (Zero)** | Experimental high-frequency profile with minimum timer period |
| **`ic903-stock-nosmoothing-v4.hex`** | 250 Hz | **Disabled (Zero)** | Stock polling frequency with smoothing completely removed |

---

## 🛠️ Flashing Guide

### Step 1. Preparation
1. Connect your XP-Pen Deco 01 V3 tablet to your computer via USB.
2. Close the official XP-Pen driver software from the system tray to prevent USB endpoint conflicts.
3. Open a PowerShell or Command Prompt terminal in the project root:
   ```powershell
   cd E:\Coding\tablet-reverse-engeneering
   ```

### Step 2. Enter DFU Bootloader Mode
Run:
```powershell
.\tools\xppen-tools.exe dfu
```
The tablet will reboot into its resident DFU bootloader (the LED indicator may turn off or change blinking pattern).

### Step 3. Flash the Firmware
Flash your chosen firmware (for example, 500 Hz with No-Smoothing):
```powershell
.\tools\xppen-tools.exe update firmwares\custom_firmware\v4\ic903-500hz-nosmoothing-v4.hex
```
The utility will erase the application flash sector, write the patched blocks, verify memory, and reboot the tablet into normal runtime mode.

### Step 4. Verify Live Polling Rate
Run the real-time hardware monitor:
```powershell
.\tools\xppen-tools.exe monitor
```
Move the stylus across the active area. The console will display real-time coordinates, pressure, and the **live measured report rate (Hz)**.

---

## ↩️ Reverting to Factory Stock Firmware

To restore the factory firmware at any time:
```powershell
.\tools\xppen-tools.exe dfu
.\tools\xppen-tools.exe update firmwares\original_firmware\ic903-stock.hex
```

---

## 🏗️ Building Custom Firmware from Source

If you want to compile custom firmware variants with customized parameters, use [`src/build_firmware.js`](src/build_firmware.js) (requires Node.js 18+):

### Build all variants for version v4:
```powershell
node src/build_firmware.js --all --version v4
```

### Build a specific configuration:
```powershell
# 500Hz + Zero Smoothing:
node src/build_firmware.js --version v4 --hz 500 --no-smoothing

# 1000Hz + Zero Smoothing:
node src/build_firmware.js --version v4 --hz 1000 --no-smoothing

# Stock 250Hz + Zero Smoothing:
node src/build_firmware.js --version v4 --hz 250 --no-smoothing
```

---

## 🔍 Firmware Inspection Tool

To verify patched parameters inside any generated `.bin` file:
```powershell
node src/analyze_firmware.js firmwares/custom_firmware/v4/ic903-500hz-nosmoothing-v4.bin
```
The tool will inspect USB endpoint descriptors, timer ARR values, settling delay constants, coil matrix mapping, and coordinate filter pointers.

---

## ⚠️ Disclaimer

This project is created by enthusiasts for the community. Use at your own risk. The authors are not responsible for any hardware issues resulting from third-party firmware flashing. Do not attempt to modify the bootloader sector (`bootloader.bin`).
