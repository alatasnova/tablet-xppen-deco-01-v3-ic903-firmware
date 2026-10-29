# XP-Pen Deco 01 V3 (IC903 / Rev B) — Technical Specification & Research Dossier

> **For AI Agents & Reverse Engineers**: This document provides the complete technical specification, reverse-engineering findings of the IC903 firmware, memory maps, algorithmic structures, and a roadmap for reaching stable 500 Hz and 1000 Hz.

---

## 1. Target Hardware & Architectural Constraints

* **Device**: Graphics tablet XP-Pen Deco 01 V3 (identified in DFU catalogs as `Deco 01 V3 Rev B`).
* **Microcontroller (MCU)**: Custom ASIC/MCU labeled **IC903**.
* **Processor Core**: **ARM Cortex-M** (Thumb-2 instruction set), Little-Endian.
* **Application Flash Base Address**: **`0x00006000`** (size of `ic903-code.bin` is exactly 104,448 bytes / `0x19800`, mapped to `0x00006000 - 0x0001F7FF`).
* **SRAM Base Address**: `0x20000000`, Initial Stack Pointer (`Initial SP`) = `0x200012D8`.
* **Peripheral MMIO Registers**: Base at `0x40000000` (Timer registers: `0x40051000..0x40051030`, ADC: `0x40004000`, USB HID core: standard Cortex-M USB peripheral).
* **Flashing Tool**: `tools/xppen-tools.exe` (authored by NiceAesth).

### ⚠️ Strict Safety Boundaries
1. ONLY modify the application `code` partition (`firmwares/original_firmware/ic903-code.bin`).
2. **NEVER MODIFY** `bootloader.bin` (`0x00000000 - 0x00002FFF`) or the state/calibration sector `state-page.bin` (`0x00003000 - 0x00005FFF`). Corrupting the bootloader will permanently brick the tablet without USB recovery capability.
3. Every compiled `.hex` binary must have base address `0x00006000` (`--ic 903`).

---

## 2. Hardware Milestones & Version History

| Revision | Measured Rate (Hardware) | Frame Period | Key Modifications |
|---|---|---|---|
| **Stock** | **~220–240 Hz** | ~4.40 ms | Stock firmware. `bInterval = 4`, ARR = 300, 7 coils/axis (17 coils/frame), 25 ADC samples, stock 2-stage smoothing. |
| **v1** | **270 Hz** | 3.70 ms | `bInterval = 2`, ARR = 140 (`0x0ab2`, `0x0e36`), settling delay scaling `scale = 0.53`. |
| **v2** | **300 Hz** | 3.33 ms | ARR = 100, idle carrier wave table `0x122c4` scaled (80/142), State 11 preliminary tuning count (`0x3600`) reduced from 5 to 3. |
| **v3** | **325 Hz** (500Hz) / **342 Hz** (1000Hz) | 2.92 ms | **Carrier Wave Breakthrough**: identified and scaled the 42-byte active excitation table `0x126ec` (file offset `0xc6ec`, scale 0.563 / 0.45). Exposed the physical bottleneck of 17 coils. |
| **v4** | **400 Hz** | **2.50 ms** | **5-Coil Geometry Optimization**: reduced coil scanning from 7 to 5 per axis (13 coils/frame instead of 17), rewrote X/Y coil ladders in `FUN_000064c8`, reduced ADC samples from 25 to 18, ARR = 75/45. Smooth, rock-solid tracking. |

---

## 3. Disassembled Firmware Routines & Core Mechanisms

### 3.1. Zero-Smoothing Bypass (100% Verified)
* **Problem**: Stock firmware runs low-pass coordinate filters inside `FUN_0000b20e` (Normal Mode) and `FUN_0000bb40` (Mode 4), adding significant input latency.
* **Mechanism**: Pointers in literal pools originally pointing to filtered coordinates were redirected to raw coordinates:
  * Raw X: `0x200002D4`
  * Raw Y: `0x200002D8`
  * Filtered X: `0x200002DC`
  * Filtered Y: `0x200002E0`
* **Patch Locations (4 bytes total)**:
  * `0x53b4` (ROM `0xb3b4`): `0xdc` $\to$ `0xd4` (Normal Mode X)
  * `0x53bc` (ROM `0xb3bc`): `0xe0` $\to$ `0xd8` (Normal Mode Y)
  * `0x5bf8` (ROM `0xbbf8`): `0xdc` $\to$ `0xd4` (Mode 4 X)
  * `0x5c00` (ROM `0xbc00`): `0xe0` $\to$ `0xd8` (Mode 4 Y)
* **Result**: The internal filter continues running in the background without arithmetic exceptions or crashes, but USB HID report packets take coordinates directly from the raw sensor buffers. Zero lag confirmed by hardware testing.

---

### 3.2. Interpolation Mathematics & 5-Coil Optimization
* **Interpolation Routines**: `FUN_0000b010` (for X) and `FUN_0000b09e` (for Y) invoke `FUN_000117b6`.
* **Signature of `FUN_000117b6`**:
  ```c
  uVar2 = FUN_000117b6(
      amp[peak - 2], // Point -2
      amp[peak - 1], // Point -1
      amp[peak],     // Center (0)
      amp[peak + 1], // Point +1
      amp[peak + 2], // Point +2
      coil_id,       // Physical center coil index
      0x46c          // Grid scale constant
  );
  ```
* **Discovery**: The polynomial interpolation function fits a 5-point curve to find the continuous sub-pixel pen position. In stock firmware, 7 coils were scanned: `[-4, -2, -1, 0, +1, +2, +4]`. Steps `-4` and `+4` were **never passed to the interpolation routine** — the MCU was scanning them in vain!
* **Implementation in v4**:
  1. `0x110e`: `07 20` $\to$ `05 20` (loop count initialization in `FUN_00006ec4` reduced from 7 to 5).
  2. Rewrote coil ladder logic in `FUN_000064c8`:
     * X axis (`0x0558..0x05eb`, 148 bytes): replaced with direct arithmetic `coil = center + counter - 2` (20 bytes Thumb code + NOP padding).
     * Y axis (`0x061e..0x06b1`, 148 bytes): replaced with direct arithmetic `coil = center + counter - 2`.
  3. Peak search limit in `FUN_0000af9c` (`0x500a`): `cmp r4, #9` $\to$ `cmp r4, #5` (limits peak search to the 5 scanned coils).
  4. Settling delay bounds in `FUN_0000929c` (`0x3a0e`, `0x3b9c`): `cmp r0, #6` $\to$ `cmp r0, #4`.

---

### 3.3. ADC Conversion Loop (`FUN_000064c8`)
* In `FUN_000064c8` lines `0x67ac..0x6856`:
  ```c
  *DAT_00006b90 = 0x19 - *DAT_00006b8c; // 25 samples minus adaptive gain offset
  do {
      *ADC_CR = 1;
      while ((*ADC_SR & 1) == 0); // wait for ADC conversion flag
      ...
  } while (count < target);
  ```
* For each coil, up to 25 successive ADC conversions were executed. In v4, file offset `0x07de` was patched: `19 20` $\to$ `12 20` (max 18 samples).

---

### 3.4. Carrier Wave Excitation Tables
1. **Idle Carrier Table**:
   * ROM `0x122c4` (file offset `0xc2c4`, 8 bytes). Scaled by 80/142 in v2/v3/v4.
2. **Active Tracking Table**:
   * ROM `0x126ec` (file offset `0xc6ec`, 42 bytes). Scaled by $0.563$ (for 500 Hz) and $0.45$ (for 1000 Hz) in v3/v4. Essential for stable tracking above 300 Hz.

---

## 4. Master Patch Table (Cheat Sheet)

| Function / Target | File Offset `.bin` | ROM Address | Stock Byte(s) | v4 Byte(s) (500Hz NoSmooth) | Description |
|---|---|---|---|---|---|
| **X Ladder rewrite** | `0x0558 - 0x05EB` | `0x6558` | (148 bytes ladder) | `7f 48 00 78 7f 49 ...` + NOPs | Direct `C + counter - 2` mapping for X |
| **Y Ladder rewrite** | `0x061E - 0x06B1` | `0x661E` | (148 bytes ladder) | `4e 48 00 78 51 49 ...` + NOPs | Direct `C + counter - 2` mapping for Y |
| **ADC Sample Count** | `0x07DE` | `0x67DE` | `19` | `12` | Max ADC samples: 25 $\to$ 18 |
| **Scan IRQ Timer ARR** | `0x0AB2 - 0x0AB5` | `0x6AB2` | `4f f4 96 70` (300) | `4f f0 4b 00` (75) | Coil scan interrupt ARR timer period |
| **Settling Delay 0** | `0x0ADE` | `0x6ADE` | `2d` (45) | `12` (18) | Settling delay (State 0) |
| **Settling Delay 2** | `0x0B40` | `0x6B40` | `2d` (45) | `12` (18) | Settling delay (State 2) |
| **Settling Delay 10** | `0x0CA2` | `0x6CA2` | `28` (40) | `10` (16) | Settling delay (State 10) |
| **Settling Delay 16** | `0x0D20` | `0x6D20` | `24` (36) | `0e` (14) | Settling delay (State 16) |
| **Settling Delay 19** | `0x0D7C` | `0x6D7C` | `24` (36) | `0e` (14) | Settling delay (State 19) |
| **Init Timer ARR** | `0x0E36 - 0x0E39` | `0x6E36` | `4f f4 96 70` (300) | `4f f0 4b 00` (75) | Timer initialization ARR |
| **Coil Scan Count** | `0x110E` | `0x710E` | `07` | `05` | Active coil scan count: 7 $\to$ 5 |
| **State 11 Tuning Count** | `0x3600` | `0x9600` | `05` | `03` | Calibration coils in State 11: 5 $\to$ 3 |
| **X Delay Bound** | `0x3A0E` | `0x9A0E` | `06` | `04` | Upper bound for X settling delays: 6 $\to$ 4 |
| **Y Delay Bound** | `0x3B9C` | `0x9B9C` | `06` | `04` | Upper bound for Y settling delays: 6 $\to$ 4 |
| **Max-Coil Bound** | `0x500A` | `0xB00A` | `09` | `05` | Peak search limit: 9 $\to$ 5 |
| **NoSmooth Normal X** | `0x53B4` | `0xB3B4` | `dc` | `d4` | Pointer X: `0x200002DC` $\to$ `0x200002D4` |
| **NoSmooth Normal Y** | `0x53BC` | `0xB3BC` | `e0` | `d8` | Pointer Y: `0x200002E0` $\to$ `0x200002D8` |
| **NoSmooth Mode4 X** | `0x5BF8` | `0xBBF8` | `dc` | `d4` | Pointer X Mode 4 |
| **NoSmooth Mode4 Y** | `0x5C00` | `0xBC00` | `e0` | `d8` | Pointer Y Mode 4 |
| **USB EP 0x81 bInterval** | `0xBFB6` | `0x11FB6` | `04` | `02` | Stylus interval: 4 ms $\to$ 2 ms (500Hz) |
| **USB EP 0x82 bInterval** | `0xBFCF` | `0x11FCF` | `04` | `02` | Button interval: 4 ms $\to$ 2 ms |
| **USB EP 0x83 bInterval** | `0xBFE8` | `0x11FE8` | `04` | `02` | Pad keys interval: 4 ms $\to$ 2 ms |
| **Idle Carrier Table** | `0xC2C4 - 0xC2CB` | `0x122C4` | (8 bytes) | (8 bytes) | Idle carrier table scaled |
| **Active Carrier Table** | `0xC6EC - 0xC715` | `0x126EC` | (42 bytes) | (42 bytes) | Active tracking carrier table scaled |

---

## 5. Engineering Roadmap: From 400 Hz to Clean 500 Hz & 1000 Hz

Current measured hardware performance: **400 Hz** (frame duration $2.50\text{ ms} = 2500\text{ µs}$).
To achieve true **500 Hz**, frame duration must be $\le 2000\text{ µs}$ ($\approx 500\text{ µs}$ margin to save).
To achieve **1000 Hz**, frame duration must be $\le 1000\text{ µs}$.

### Timing Optimization Targets:
1. **Reduce ADC Oversampling (ADC Sample Count)**:
   * Currently: 18 samples per coil (`0x07de: 0x12`).
   * Across 13 coils, this equals $13 \times 18 = 234$ ADC conversions per frame.
   * Decreasing from 18 to 12 samples (`0x07de: 0x0c`): $13 \times (18 - 12) \times 3\text{ µs} \approx \mathbf{230\text{ µs}}$ saved per frame!
2. **Optimize Microsecond Hardware Delays `FUN_000064bc(5)`**:
   * `FUN_000064c8` and `FUN_0000929c` contain multiple calls to `delay_us(5)` during analog multiplexer settling.
   * Total delay time per frame across 13 coils is $\approx 200\text{ µs}$.
   * Tuning `delay_us(5)` to `delay_us(2)` or `delay_us(3)` saves $\approx \mathbf{100\text{--}150\text{ µs}}$.
3. **Timer ARR Tuning**:
   * Currently ARR = 75. Once ADC and delay times are reduced, ARR can be safely lowered to **ARR = 60** (for 500 Hz) or **ARR = 30** (for 1000 Hz).
4. **State 11 Calibration Coils**:
   * Currently 3 coils (`0x3600: 0x03`).
   * In IC902 reference patches, calibration coils were reduced to 1 or 2 during tracking.

Summing steps 1 and 2 yields $\sim 350\text{--}400\text{ µs}$ of savings, bringing total frame time well below $2.0\text{ ms}$ and achieving stable **500 Hz**.
