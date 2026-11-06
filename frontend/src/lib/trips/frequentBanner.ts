import type { FrequentDestination } from './api';

export const MIN_FREQUENT_VISITS = 5;

export function pickFrequentDestination(destinations: FrequentDestination[]): FrequentDestination | null {
  const top = destinations[0];
  return top && top.visit_count >= MIN_FREQUENT_VISITS ? top : null;
}
