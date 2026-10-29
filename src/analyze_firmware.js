#!/usr/bin/env node
/**
 * Firmware Parameter & Architecture Analyzer for IC903
 * Reads a target binary / dump and extracts operational parameters
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const STOCK_BIN = path.join(ROOT_DIR, 'firmwares', 'original_firmware', 'ic903-code.bin');

const targetPath = process.argv[2] || STOCK_BIN;
if (!fs.existsSync(targetPath)) {
  console.error(`File not found: ${targetPath}`);
  process.exit(1);
}

const bin = fs.readFileSync(targetPath);
console.log(`Analyzing: ${path.relative(ROOT_DIR, targetPath)} (${bin.length} bytes)\n`);

// 1. USB Descriptors
console.log('--- 1. USB HID Endpoints ---');
console.log(`  EP 0x81 (Stylus Coordinates) bInterval: ${bin[0xbfb6]} ms (${1000 / bin[0xbfb6]} Hz)`);
console.log(`  EP 0x82 (Buttons/Status)      bInterval: ${bin[0xbfcf]} ms`);
console.log(`  EP 0x83 (Pad Keys)            bInterval: ${bin[0xbfe8]} ms`);

// 2. Hardware Timers
console.log('\n--- 2. Timer Auto-Reload (ARR) ---');
const irqArr = bin.readUInt16LE(0x0ab2);
const initArr = bin.readUInt16LE(0x0e36);
console.log(`  Scan IRQ ARR (offset 0x0ab2): ${bin[0x0ab4]} (raw: ${bin.subarray(0x0ab2, 0x0ab6).toString('hex')})`);
console.log(`  Init ARR     (offset 0x0e36): ${bin[0x0e38]} (raw: ${bin.subarray(0x0e36, 0x0e3a).toString('hex')})`);

// 3. Settling Delays
console.log('\n--- 3. Settling Delays ---');
console.log(`  State 0  (offset 0x0ade): ${bin[0x0ade]} (stock: 45)`);
console.log(`  State 2  (offset 0x0b40): ${bin[0x0b40]} (stock: 45)`);
console.log(`  State 10 (offset 0x0ca2): ${bin[0x0ca2]} (stock: 40)`);
console.log(`  State 16 (offset 0x0d20): ${bin[0x0d20]} (stock: 36)`);
console.log(`  State 19 (offset 0x0d7c): ${bin[0x0d7c]} (stock: 36)`);

// 4. Geometry & Scan Configuration
console.log('\n--- 4. Geometry & Coil Scanning ---');
const coilCount = bin[0x110e];
console.log(`  Coil scan count (offset 0x110e): ${coilCount} coils per axis (stock: 7)`);
console.log(`  Total active coils per frame:    ${coilCount * 2 + 3} coils (stock: 17)`);

const xLadderStart = bin.subarray(0x0558, 0x0558 + 20).toString('hex');
const is5CoilX = xLadderStart.startsWith('7f4800787f49');
console.log(`  X-Axis Ladder mapping:           ${is5CoilX ? '5-point direct [C-2..C+2]' : 'Stock 7-step ladder'}`);

const is5CoilY = bin.subarray(0x061e, 0x061e + 20).toString('hex').startsWith('4e4800785149');
console.log(`  Y-Axis Ladder mapping:           ${is5CoilY ? '5-point direct [C-2..C+2]' : 'Stock 7-step ladder'}`);
console.log(`  Delay bounds (0x3a0e, 0x3b9c):   ${bin[0x3a0e]}, ${bin[0x3b9c]} (stock: 6, 6)`);
console.log(`  Max-coil search limit (0x500a):  ${bin[0x500a]} (stock: 9)`);

// 5. ADC Sampling
console.log('\n--- 5. ADC Sampling Configuration ---');
console.log(`  Max ADC sample count (0x07de):   ${bin[0x07de]} (stock: 25)`);

// 6. Smoothing / Coordinate Filtering
console.log('\n--- 6. Smoothing Configuration ---');
const normX = bin[0x53b4].toString(16);
const normY = bin[0x53bc].toString(16);
const mode4X = bin[0x5bf8].toString(16);
const mode4Y = bin[0x5c00].toString(16);
const isNoSmoothing = (normX === 'd4' && normY === 'd8' && mode4X === 'd4' && mode4Y === 'd8');
console.log(`  Filter status:                   ${isNoSmoothing ? 'DISABLED (Zero-Smoothing / Raw Unfiltered)' : 'ENABLED (Stock 2-stage smoothing)'}`);
console.log(`  Pointers (Normal X/Y, Mode4 X/Y): 0x200002${normX}, 0x200002${normY}, 0x200002${mode4X}, 0x200002${mode4Y}`);
