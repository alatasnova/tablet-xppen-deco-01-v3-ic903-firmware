#!/usr/bin/env node
/**
 * IC902 Reference Patch Comparative Analyzer
 * Compares stock IC902 against NiceAesth's 500Hz patched firmware
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const STOCK_HEX = path.join(ROOT_DIR, 'firmwares', 'reference_firmware', 'stock', 'ic902-stock.hex');
const PATCHED_HEX = path.join(ROOT_DIR, 'firmwares', 'reference_firmware', 'patched', '500hz.hex');

function parseHex(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const mem = new Map();
  let base = 0;
  for (let line of lines) {
    line = line.trim();
    if (!line.startsWith(':')) continue;
    const len = parseInt(line.substr(1, 2), 16);
    const addr = parseInt(line.substr(3, 4), 16);
    const type = parseInt(line.substr(7, 2), 16);
    const data = line.substr(9, len * 2);
    if (type === 0x00) {
      for (let i = 0; i < len; i++) {
        mem.set(base + addr + i, parseInt(data.substr(i * 2, 2), 16));
      }
    } else if (type === 0x04) {
      base = parseInt(data, 16) << 16;
    }
  }
  return mem;
}

if (!fs.existsSync(STOCK_HEX) || !fs.existsSync(PATCHED_HEX)) {
  console.error('IC902 firmware files not found!');
  process.exit(1);
}

const stock = parseHex(STOCK_HEX);
const patched = parseHex(PATCHED_HEX);

const diffAddrs = [];
for (let [addr, val] of stock.entries()) {
  const pVal = patched.get(addr);
  if (pVal !== undefined && pVal !== val) {
    diffAddrs.push(addr);
  }
}
diffAddrs.sort((a, b) => a - b);

console.log(`Total byte differences between IC902 stock and 500Hz: ${diffAddrs.length}\n`);

const clusters = [];
let curCluster = [];
for (let a of diffAddrs) {
  if (curCluster.length === 0 || a <= curCluster[curCluster.length - 1] + 4) {
    curCluster.push(a);
  } else {
    clusters.push(curCluster);
    curCluster = [a];
  }
}
if (curCluster.length > 0) clusters.push(curCluster);

for (let cl of clusters) {
  const start = cl[0];
  const end = cl[cl.length - 1];
  console.log(`--- Cluster: 0x${start.toString(16)} .. 0x${end.toString(16)} (${end - start + 1} bytes) ---`);
  for (let a of cl) {
    const s = stock.get(a).toString(16).padStart(2, '0');
    const p = patched.get(a).toString(16).padStart(2, '0');
    console.log(`  0x${a.toString(16)}: 0x${s} -> 0x${p}`);
  }
}
