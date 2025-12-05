export interface Preset {
  id: string;
  name: string;
  red: number;
  green: number;
  blue: number;
  isOrganic: boolean;
  lfoRate: number;
  lfoDepth: number;
  lfoShape: string;
  randomness: number;
  phaseOffset: number;
}