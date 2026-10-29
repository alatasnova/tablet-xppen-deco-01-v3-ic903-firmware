#!/usr/bin/env node
/**
 * XP-Pen Deco 01 V3 (MCU IC903 / Rev B) Custom Firmware Builder
 * 
 * Features:
 *   - Polling rate overclocking: 250 Hz (stock) / 500 Hz / 1000 Hz
 *   - Zero-smoothing bypass (raw coordinates directly to USB HID reports)
 *   - Automated Intel HEX conversion via xppen-tools.exe
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration Paths
const ROOT_DIR = path.resolve(__dirname, '..');
const STOCK_BIN = path.join(ROOT_DIR, 'firmwares', 'original_firmware', 'ic903-code.bin');
const TOOLS_EXE = path.join(ROOT_DIR, 'tools', 'xppen-tools.exe');
const DEFAULT_OUT_DIR = path.join(ROOT_DIR, 'firmwares', 'custom_firmware');

function printBanner() {
  console.log(`
================================================================
       XP-Pen Deco 01 V3 (IC903) Firmware Patch Generator
================================================================
`);
}

function printHelp() {
  printBanner();
  console.log(`Usage:
  node src/build_firmware.js [options]

Options:
  --version <v1|v2|v3|v4> Patch architecture version (default: v4)
  --hz <250|500|1000>     USB HID polling rate (default: 500)
  --no-smoothing          Enable hardware zero-smoothing bypass (raw coordinates)
  --all                   Build all standard firmware variants for selected version
  --output <dir>          Target output directory (default: firmwares/custom_firmware/<version>)
  --help, -h              Show this help message

Examples:
  # Build all v4 firmware binaries (500Hz, 500Hz+NoSmoothing, 1000Hz+NoSmoothing, Stock+NoSmoothing):
  node src/build_firmware.js --all --version v4

  # Build 500Hz + No-Smoothing v4 only:
  node src/build_firmware.js --version v4 --hz 500 --no-smoothing
`);
}

function verifyPrerequisites() {
  if (!fs.existsSync(STOCK_BIN)) {
    console.error(`[ERROR] Stock firmware dump not found: ${STOCK_BIN}`);
    process.exit(1);
  }
  if (!fs.existsSync(TOOLS_EXE)) {
    console.error(`[ERROR] Flashing tool xppen-tools not found: ${TOOLS_EXE}`);
    process.exit(1);
  }
}

/**
 * Patch engine for IC903
 */
function createPatchedBinary(stockBuf, options) {
  const bin = Buffer.from(stockBuf);
  const version = options.version || 'v4';
  const hz = options.hz || 500;
  const noSmoothing = Boolean(options.noSmoothing);

  const diffLog = [];
  function recordChange(offset, oldVal, newVal, desc) {
    diffLog.push({ offset, oldVal, newVal, desc });
  }

  // --- 1. USB Endpoint Descriptor bInterval ---
  if (hz === 500 || hz === 1000) {
    const interval = hz === 1000 ? 0x01 : 0x02;
    // EP 0x81 (Stylus coordinates)
    recordChange(0xbfb6, bin[0xbfb6], interval, `USB EP 0x81 bInterval -> ${hz}Hz`);
    bin[0xbfb6] = interval;

    // EP 0x82 (Buttons/Status)
    recordChange(0xbfcf, bin[0xbfcf], interval, `USB EP 0x82 bInterval -> ${hz}Hz`);
    bin[0xbfcf] = interval;

    // EP 0x83 (Pad Keys)
    recordChange(0xbfe8, bin[0xbfe8], interval, `USB EP 0x83 bInterval -> ${hz}Hz`);
    bin[0xbfe8] = interval;
  }

  // --- 2. Hardware Timer ARR (Auto-Reload Register 0x40051024) ---
  if (hz >= 500) {
    let arrVal = 140; // v1 default
    if (version === 'v2') arrVal = 100;
    if (version === 'v3') arrVal = hz === 1000 ? 80 : 100;
    if (version === 'v4') arrVal = hz === 1000 ? 45 : 75;

    const arrBytes = Buffer.from([0x4f, 0xf0, arrVal, 0x00]); // MOV.W r0, #arrVal
    recordChange(0x0ab2, bin.subarray(0x0ab2, 0x0ab6).toString('hex'), arrBytes.toString('hex'), `Scan IRQ Timer ARR -> ${arrVal}`);
    arrBytes.copy(bin, 0x0ab2);

    recordChange(0x0e36, bin.subarray(0x0e36, 0x0e3a).toString('hex'), arrBytes.toString('hex'), `Timer Init ARR -> ${arrVal}`);
    arrBytes.copy(bin, 0x0e36);
  }

  // --- 3. Coil Settling Delay Multipliers in FUN_00006a8e ---
  if (hz >= 500) {
    let scale = 0.53; // v1: 45->24, 40->22, 36->20
    if (version === 'v2' || version === 'v3' || version === 'v4') {
      scale = hz === 1000 ? 0.30 : 0.40; // v3/v4: 45->18, 40->16, 36->14
    }

    const d45 = Math.round(45 * scale);
    const d40 = Math.round(40 * scale);
    const d36 = Math.round(36 * scale);

    recordChange(0x0ade, bin[0x0ade], d45, `Settling delay State 0 -> ${d45}`);
    bin[0x0ade] = d45;

    recordChange(0x0b40, bin[0x0b40], d45, `Settling delay State 2 -> ${d45}`);
    bin[0x0b40] = d45;

    recordChange(0x0ca2, bin[0x0ca2], d40, `Settling delay State 10 -> ${d40}`);
    bin[0x0ca2] = d40;

    recordChange(0x0d20, bin[0x0d20], d36, `Settling delay State 16 -> ${d36}`);
    bin[0x0d20] = d36;

    recordChange(0x0d7c, bin[0x0d7c], d36, `Settling delay State 19 -> ${d36}`);
    bin[0x0d7c] = d36;
  }

  // --- 4. Preliminary Frequency Tuning Count in State 11 (ROM 0x9600) ---
  if (hz >= 500 && (version === 'v2' || version === 'v3' || version === 'v4')) {
    recordChange(0x3600, bin[0x3600], 0x03, `State 11 Tuning Count -> 3`);
    bin[0x3600] = 0x03; // cmp r0, #3 (was #5)
  }

  // --- 5. Idle Carrier Wave Excitation Table (ROM 0x122c4 / Offset 0xc2c4) ---
  if (hz >= 500 && (version === 'v2' || version === 'v3' || version === 'v4')) {
    const scaledIdle = [0x5d, 0x5b, 0x57, 0x56, 0x54, 0x53, 0x50, 0x4c];
    recordChange(0xc2c4, bin.subarray(0xc2c4, 0xc2cc).toString('hex'), Buffer.from(scaledIdle).toString('hex'), `Idle Excitation Table -> Scaled (80/142)`);
    Buffer.from(scaledIdle).copy(bin, 0xc2c4);
  }

  // --- 6. Active Pen Carrier Wave Excitation Table (ROM 0x126ec / Offset 0xc6ec) ---
  // Key breakthrough in v3: 42-byte table controlling active coil pulses during pen tracking!
  if (hz >= 500 && (version === 'v3' || version === 'v4')) {
    const tableOffset = 0xc6ec;
    const tableLen = 42;
    const scaleFactor = hz === 1000 ? 0.45 : 0.563; // 80 / 142 ≈ 0.563
    const oldSlice = bin.subarray(tableOffset, tableOffset + tableLen);
    const newSlice = Buffer.alloc(tableLen);
    for (let i = 0; i < tableLen; i++) {
      newSlice[i] = Math.round(oldSlice[i] * scaleFactor);
    }
    recordChange(tableOffset, oldSlice.toString('hex').slice(0, 16) + '...', newSlice.toString('hex').slice(0, 16) + '...', `Active Tracking Table (42 entries) -> Scaled (${Math.round(scaleFactor*100)}%)`);
    newSlice.copy(bin, tableOffset);
  }

  // --- 7. 5-Coil Geometry Scan Optimization (v4 Breakthrough) ---
  // Reduces active coil scans from 7+7=14 to 5+5=10 per frame (13 coils total).
  // Eliminates outer unused coils (-4 and +4) while preserving exact 5-point interpolation.
  if (hz >= 500 && version === 'v4') {
    // 7a. Loop count initialization in FUN_00006ec4
    recordChange(0x110e, bin[0x110e], 0x05, 'Loop coil scan count -> 5 (was 7)');
    bin[0x110e] = 0x05;

    // 7b. Re-map X axis coil ladder in FUN_000064c8 (center + counter - 2)
    const xCode = Buffer.concat([
      Buffer.from([0x7f, 0x48, 0x00, 0x78, 0x7f, 0x49, 0x91, 0xf8, 0xd9, 0x10, 0x40, 0x18, 0x80, 0x1e, 0x7e, 0x49, 0x08, 0x70, 0x3f, 0xe0]),
      Buffer.alloc(128, 0x00)
    ]);
    for (let i = 20; i < 148; i += 2) { xCode[i] = 0x00; xCode[i + 1] = 0xbf; } // NOP padding
    recordChange(0x0558, bin.subarray(0x0558, 0x0558 + 20).toString('hex') + '...', xCode.subarray(0, 20).toString('hex') + '...', 'X-Axis Coil Ladder -> 5-point direct mapping');
    xCode.copy(bin, 0x0558);

    // 7c. Re-map Y axis coil ladder in FUN_000064c8 (center + counter - 2)
    const yCode = Buffer.concat([
      Buffer.from([0x4e, 0x48, 0x00, 0x78, 0x51, 0x49, 0x91, 0xf8, 0xd9, 0x10, 0x40, 0x18, 0x80, 0x1e, 0x4f, 0x49, 0x08, 0x70, 0x3f, 0xe0]),
      Buffer.alloc(128, 0x00)
    ]);
    for (let i = 20; i < 148; i += 2) { yCode[i] = 0x00; yCode[i + 1] = 0xbf; } // NOP padding
    recordChange(0x061e, bin.subarray(0x061e, 0x061e + 20).toString('hex') + '...', yCode.subarray(0, 20).toString('hex') + '...', 'Y-Axis Coil Ladder -> 5-point direct mapping');
    yCode.copy(bin, 0x061e);

    // 7d. Settling delay upper bounds in FUN_0000929c (cmp r0, #4)
    recordChange(0x3a0e, bin[0x3a0e], 0x04, 'X settling delay upper bound -> 4 (was 6)');
    bin[0x3a0e] = 0x04;
    recordChange(0x3b9c, bin[0x3b9c], 0x04, 'Y settling delay upper bound -> 4 (was 6)');
    bin[0x3b9c] = 0x04;

    // 7e. Max-coil search bound in FUN_0000af9c (cmp r4, #5)
    recordChange(0x500a, bin[0x500a], 0x05, 'Max-coil search bound -> 5 (was 9)');
    bin[0x500a] = 0x05;

    // 7f. ADC Sample Count Optimization in FUN_000064c8 (18 samples max, was 25)
    recordChange(0x07de, bin[0x07de], 0x12, 'ADC sample count -> 18 (was 25)');
    bin[0x07de] = 0x12;
  }

  // --- 7. No-Smoothing Literal Pool Redirects ---
  if (noSmoothing) {
    // Normal mode literal pool
    recordChange(0x53b4, bin[0x53b4], 0xd4, 'Normal mode X pointer -> 0x200002D4 (Raw X)');
    bin[0x53b4] = 0xd4;

    recordChange(0x53bc, bin[0x53bc], 0xd8, 'Normal mode Y pointer -> 0x200002D8 (Raw Y)');
    bin[0x53bc] = 0xd8;

    // Mode 4 literal pool
    recordChange(0x5bf8, bin[0x5bf8], 0xd4, 'Mode 4 X pointer -> 0x200002D4 (Raw X)');
    bin[0x5bf8] = 0xd4;

    recordChange(0x5c00, bin[0x5c00], 0xd8, 'Mode 4 Y pointer -> 0x200002D8 (Raw Y)');
    bin[0x5c00] = 0xd8;
  }

  return { bin, diffLog };
}

function compileHex(binPath, hexPath) {
  const cmd = `"${TOOLS_EXE}" ihex "${binPath}" --ic 903 -o "${hexPath}"`;
  execSync(cmd, { stdio: 'pipe' });
}

function buildTarget(stockBuf, options, outDir) {
  const hzStr = options.hz === 250 ? 'stock' : `${options.hz}hz`;
  const smoothStr = options.noSmoothing ? '-nosmoothing' : '';
  const verStr = (options.hz === 250 && !options.version) ? '' : `-${options.version}`;
  const baseName = `ic903-${hzStr}${smoothStr}${verStr}`;

  const binPath = path.join(outDir, `${baseName}.bin`);
  const hexPath = path.join(outDir, `${baseName}.hex`);

  const { bin, diffLog } = createPatchedBinary(stockBuf, options);
  fs.writeFileSync(binPath, bin);
  compileHex(binPath, hexPath);

  console.log(`  [OK] Built: ${path.relative(ROOT_DIR, hexPath)}`);
  console.log(`       Patches applied: ${diffLog.length} edits, bytes changed: ${bin.filter((b, i) => b !== stockBuf[i]).length}`);
  return { hexPath, binPath };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  verifyPrerequisites();
  const stockBuf = fs.readFileSync(STOCK_BIN);

  let version = 'v4';
  let hz = 500;
  let noSmoothing = false;
  let buildAll = false;
  let customOut = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--version' && args[i + 1]) version = args[++i].toLowerCase();
    else if (args[i] === '--hz' && args[i + 1]) hz = parseInt(args[++i], 10);
    else if (args[i] === '--no-smoothing') noSmoothing = true;
    else if (args[i] === '--all') buildAll = true;
    else if (args[i] === '--output' && args[i + 1]) customOut = args[++i];
  }

  const outDir = customOut || path.join(DEFAULT_OUT_DIR, version);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  printBanner();
  console.log(`Target Version:   ${version.toUpperCase()}`);
  console.log(`Output Directory: ${path.relative(ROOT_DIR, outDir)}\n`);

  if (buildAll) {
    console.log(`Building full firmware suite for revision [${version}]:\n`);
    // 1. 500Hz + NoSmoothing
    buildTarget(stockBuf, { version, hz: 500, noSmoothing: true }, outDir);
    // 2. 500Hz Stock Smoothing
    buildTarget(stockBuf, { version, hz: 500, noSmoothing: false }, outDir);
    // 3. Stock 250Hz + NoSmoothing
    buildTarget(stockBuf, { version, hz: 250, noSmoothing: true }, outDir);
    // 4. Optional 1000Hz + NoSmoothing for v3 / v4
    if (version === 'v3' || version === 'v4') {
      buildTarget(stockBuf, { version, hz: 1000, noSmoothing: true }, outDir);
    }
  } else {
    buildTarget(stockBuf, { version, hz, noSmoothing }, outDir);
  }

  console.log(`\nDone! Firmware binaries saved to: ${path.relative(ROOT_DIR, outDir)}`);
}

main();
