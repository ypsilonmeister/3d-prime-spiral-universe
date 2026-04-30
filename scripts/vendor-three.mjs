import { copyFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const files = [
  [
    'node_modules/three/build/three.module.js',
    'vendor/three/build/three.module.js',
  ],
  [
    'node_modules/three/examples/jsm/controls/OrbitControls.js',
    'vendor/three/examples/jsm/controls/OrbitControls.js',
  ],
];

for (const [source, target] of files) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  console.log(`Copied ${source} -> ${target}`);
}
