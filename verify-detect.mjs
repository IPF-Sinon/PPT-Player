import { readFileSync } from 'node:fs'
import { zipSync, strToU8 } from 'fflate'
import { detectFormat } from './src/main/convert/detect.ts'
