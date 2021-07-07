import { NumVec3, RectanglePoints } from '../types/vectors';
import { Gene, Genome } from './genetic';

// Car has 16 distance sensors.
export const CAR_SENSORS_NUM = 16;

export const BIAS_UNITS = 1;

// How many genes we need to encode each numeric parameter for the formulas.
export const GENES_PER_NUMBER = 8;

/*
0 123 4567 - genes indices
X XXX XXXX - 8-bits number
_ ___ ____
|  |   |
|  |   |____ fraction bits
|  |
|  |________ exponent bits (biased)
|            Bias equals to 2^(k−1) − 1, where k is the number of bits in the exponent
|
|___________ sign bit (0 - positive, 1 - negative)

@see: https://en.wikipedia.org/wiki/Exponent_bias
@see: https://medium.com/@sarafecadu/64-bit-floating-point-a-javascript-story-fa6aad266665
*/
const SIGN_GENE_INDEX = 0;
const EXPONENT_GENE_INDEX = 1;
const FRACTION_GENE_INDEX = 4;
const EXPONENT_BIAS = 2 ** (FRACTION_GENE_INDEX - EXPONENT_GENE_INDEX - 1) - 1;

// Based on 16 distance sensors we need to provide two formulas that would define car's behaviour:
// 1. Engine formula (input: 16 sensors; output: -1 (backward), 0 (neutral), +1 (forward))
// 2. Wheels formula (input: 16 sensors; output: -1 (left), 0 (straight), +1 (right))
export const ENGINE_FORMULA_GENES_NUM = (CAR_SENSORS_NUM + BIAS_UNITS) * GENES_PER_NUMBER;
export const WHEELS_FORMULA_GENES_NUM = (CAR_SENSORS_NUM + BIAS_UNITS) * GENES_PER_NUMBER;

// The length of the binary genome of the car.
export const GENOME_LENGTH = ENGINE_FORMULA_GENES_NUM + WHEELS_FORMULA_GENES_NUM;

type LossParams = {
  wheelsPosition: RectanglePoints,
  parkingLotCorners: RectanglePoints,
};

// Loss function calculates how far the car is from the parking lot
// by comparing the wheels positions with parking lot corners positions.
export const loss = (params: LossParams): number => {
  const { wheelsPosition, parkingLotCorners } = params;

  const {
    fl: flWheel,
    fr: frWheel,
    br: brWheel,
    bl: blWheel,
  } = wheelsPosition;

  const {
    fl: flCorner,
    fr: frCorner,
    br: brCorner,
    bl: blCorner,
  } = parkingLotCorners;

  const flDistance = distance(flWheel, flCorner);
  const frDistance = distance(frWheel, frCorner);
  const brDistance = distance(brWheel, brCorner);
  const blDistance = distance(blWheel, blCorner);

  return (flDistance + frDistance + brDistance + blDistance) / 4;
};

// Calculates the XZ distance between two points in space.
// The vertical Y distance is not being taken into account.
const distance = (from: NumVec3, to: NumVec3) => {
  const [fromX, fromY, fromZ] = from;
  const [toX, toY, toZ] = to;
  return Math.sqrt((fromX - toX) ** 2 + (fromZ - toZ) ** 2);
};

type SensorValues = number[];

export type FormulaCoefficients = number[];

type FormulaResult = -1 | 0 | 1;

type DecodedGenome = {
  engineFormulaCoefficients: FormulaCoefficients,
  wheelsFormulaCoefficients: FormulaCoefficients,
}

export const decodeGenome = (genome: Genome): DecodedGenome => {
  const engineGenes: Gene[] = genome.slice(0, ENGINE_FORMULA_GENES_NUM);
  const wheelsGenes: Gene[] = genome.slice(
    ENGINE_FORMULA_GENES_NUM,
    ENGINE_FORMULA_GENES_NUM + WHEELS_FORMULA_GENES_NUM,
  );

  const engineFormulaCoefficients: FormulaCoefficients = decodeNumbers(engineGenes);
  const wheelsFormulaCoefficients: FormulaCoefficients = decodeNumbers(wheelsGenes);

  return {
    engineFormulaCoefficients,
    wheelsFormulaCoefficients,
  };
};

const decodeNumbers = (genes: Gene[]): number[] => {
  if (genes.length % GENES_PER_NUMBER !== 0) {
    throw new Error('Wrong number of genes in the numbers genome');
  }
  const numbers: number[] = [];
  for (let numberIndex = 0; numberIndex < genes.length; numberIndex += GENES_PER_NUMBER) {
    const number: number = decodeNumber(genes.slice(numberIndex, numberIndex + GENES_PER_NUMBER));
    numbers.push(number);
  }
  return numbers;
};

const decodeNumber = (genes: Gene[]): number => {
  if (genes.length !== GENES_PER_NUMBER) {
    throw new Error('Wrong number of genes in the number genome');
  }
  // Getting the sign.
  const sign = genes[SIGN_GENE_INDEX] ? -1 : 1;

  // Getting the exponent.
  const exponentGenes = genes.slice(EXPONENT_GENE_INDEX, FRACTION_GENE_INDEX);
  const exponent = binaryArrayToNumber(exponentGenes) - EXPONENT_BIAS;

  // Getting the fraction.
  const fractionGenes = genes.slice(FRACTION_GENE_INDEX);
  const fraction = binaryArrayToNumber(fractionGenes);

  return sign * fraction * (10 ** exponent);
};

/**
 * Converts array of genes (bits) to a number.
 *
 * Powers of 2: 8421
 *             [1010] -> (2 + 8) -> 10
 */
const binaryArrayToNumber = (genes: Gene[]): number => {
  return genes.reduce(
    (result: number, gene: Gene, geneIndex: number) => {
      return result + gene * (2 ** (genes.length - geneIndex - 1));
    },
    0
  );
};

export const engineFormula = (genome: Genome, sensors: SensorValues): FormulaResult => {
  const {engineFormulaCoefficients} = decodeGenome(genome);
  const rawResult = linearPolynomial(engineFormulaCoefficients, sensors);
  const normalizedResult = sigmoid(rawResult);
  const categoricalResult = sigmoidToCategorical(normalizedResult);
  return categoricalResult;
};

export const wheelsFormula = (genome: Genome, sensors: SensorValues): FormulaResult => {
  const {wheelsFormulaCoefficients} = decodeGenome(genome);
  const rawResult = linearPolynomial(wheelsFormulaCoefficients, sensors);
  const normalizedResult = sigmoid(rawResult);
  const categoricalResult = sigmoidToCategorical(normalizedResult);
  return categoricalResult;
};

const linearPolynomial = (coefficients: number[], variables: number[]): number => {
  if (coefficients.length !== (variables.length + 1)) {
    throw new Error('Incompatible number polynomial coefficients and variables');
  }
  let result = 0;
  coefficients.forEach((coefficient: number, coefficientIndex: number) => {
    if (coefficientIndex < variables.length) {
      result += coefficient * variables[coefficientIndex];
    } else {
      result += coefficient
    }
  });
  return result;
};

const sigmoid = (x: number): number => {
  return 1 / (1 + Math.E ** -x);
};

const sigmoidToCategorical = (
  sigmoidValue: number,
  aroundZeroMargin: number = 0.5, // Value between 0 and 1
): FormulaResult => {
  if (sigmoidValue > (0.5 + aroundZeroMargin / 2)) {
    return 1;
  }
  if (sigmoidValue < (0.5 - aroundZeroMargin / 2)) {
    return -1;
  }
  return 0;
};
