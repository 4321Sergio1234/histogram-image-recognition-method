import brain from 'brain.js/dist/browser.js';
import type { NeuralNetwork } from 'brain.js';
import type { INeuralNetworkJSON } from 'brain.js/dist/neural-network';
export type Network = NeuralNetwork<number[], number[]>;
export type NetworkJSON = INeuralNetworkJSON;
export function createNetwork(hiddenLayers: number[] = []): Network {
  return new brain.NeuralNetwork<number[], number[]>({ hiddenLayers });
}
export function loadNetwork(json: NetworkJSON): Network {
  return createNetwork().fromJSON(json);
}
