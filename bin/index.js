#!/usr/bin/env node
"use strict";

import { readFileSync, writeFileSync } from 'node:fs';

import { Command } from 'commander';

const program = new Command();

program.name('mic-cal-txt-to-etx')
    .alias('mctte')
    .version('1.0.0')
    .description('Convert microphone calibration file from txt to etx')
    .usage('mic-calibration-file.txt')
    .argument('<filename>', 'source cablibration file')
    .option('-s, --sample-rate <number>', 'sample rate (Hz)', 48000)
    .option('-f, --fft-size <number>', 'Fast Fourier Transform number of points', 65536)
    .option('-t, --correction-threshold <number>', 'correction threshold (dB)', 0)
    .option('-m, --microphone <string>', 'microphone reference')
    .option('-o, --output-file <string>', 'custom output filename');

program.parse();

const options = program.opts();

const sourceFilename = program.args[0];
const sampleRate = options.sampleRate;
const fftSize = options.fftSize;
const correctionThreshold = Math.abs(options.correctionThreshold);
const outputFilename = ((customFilename) => {
    const formatIndex = customFilename?.indexOf('.etx');
    if (customFilename && formatIndex !== 0) {
        return formatIndex != -1 ? customFilename : customFilename + '.etx';
    } 
    return `${options.microphone ? options.microphone : sourceFilename.replace('.txt', '')}-${sampleRate} Hz-${fftSize} points${correctionThreshold ? '-' + correctionThreshold + ' db threshold' : ''}.etx`;
})(options.outputFile);
const step = sampleRate / fftSize;
let frequencyIndex = 0;
let buffer = "* SDA\tetx\n\n* SampleRate [Hz]\t" + sampleRate + "\n* DataType\tFrequency (Real + Imag)\n* DataSubType\tNot Specified\n* Unit\tNormalized\n* X-Values\tyes\n* Complex\tyes\n* TimeSamples\t" + fftSize + "\n* Data\t" + (sampleRate / 2 / step) + "\nHz\tNormalized\tNormalized\n";
const frequencyTable = [];
const correctionTable = [];

const calibrationFileData = readFileSync(sourceFilename, {encoding: 'utf8'}).replaceAll('\r', '').split("\n");

for (let line of calibrationFileData) {
    if (line.charAt(0) != ';') {
        if ((line = line.split('\t'))[0]) {
            frequencyTable.push(parseInt(line[0]));
            correctionTable.push(parseFloat(line[1]));
        }
    }
}

function findClosest(source, target) {
    let closestIndex = 0; 
    for (let i = 1; i < source.length; i++) {
        if (Math.abs(source[i] - target) < Math.abs(source[closestIndex] - target)) {
            closestIndex = i;
        }
    }
    return closestIndex;
}

function calculateCorrection(target, closestIndex) {
    if (target == frequencyTable[closestIndex]
        || (target < frequencyTable[closestIndex] && (Math.abs(frequencyTable[closestIndex] - frequencyTable[closestIndex - 1]) < step
        || closestIndex == 0)) || (target > frequencyTable[closestIndex] && ((Math.abs(frequencyTable[closestIndex] - frequencyTable[closestIndex + 1]) < step) || closestIndex == (frequencyTable.length - 1)))) {
        return correctionTable[closestIndex];
    }

    let closestIndex2;
    let percentDiff;
    let calculatedCorrection;
    if (target < frequencyTable[closestIndex]) {
        closestIndex2 = closestIndex - 1;
        percentDiff = (target - frequencyTable[closestIndex2]) / (frequencyTable[closestIndex] - frequencyTable[closestIndex2]);
        calculatedCorrection = correctionTable[closestIndex2] + (percentDiff * (correctionTable[closestIndex] - correctionTable[closestIndex2]))
    } else if (target > frequencyTable[closestIndex]) {
        closestIndex2 = closestIndex + 1;
        percentDiff = (target - frequencyTable[closestIndex]) / (frequencyTable[closestIndex2] - frequencyTable[closestIndex]);
        calculatedCorrection = correctionTable[closestIndex] + (percentDiff * (correctionTable[closestIndex2] - correctionTable[closestIndex]))
    }

    return calculatedCorrection;
}


function calculateRatio(target) {
    const correction = calculateCorrection(target, findClosest(frequencyTable, target));

    return Math.abs(correction) > correctionThreshold ? Math.round(Math.pow(10, correction / 20) * 10000) / 10000 : 0;
}

while (frequencyIndex <= (sampleRate / 2)) {
    buffer += frequencyIndex + "\t" + calculateRatio(frequencyIndex) + "\t0\n";
    frequencyIndex += step;
}

writeFileSync(outputFilename, buffer);