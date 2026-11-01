import type { BodyRegion } from '../../lib/types';

/**
 * The body map's drawing: one neutral figure, front and back, 300 units tall. Paths draw the body's
 * right half from x = 0 at its centre line, and BodyMap.svelte mirrors them for the other half. A
 * region that shows in both views, like the calves, is drawn in each.
 */

export interface BodyShape {
  region: BodyRegion;
  d: string;
}

export const OUTLINE =
  'M0 0C10 0 15.5 8 15.5 18C15.5 26 12 32 8.5 35.5C7.8 37 7.5 40 8 45C14 50 24 50 33 52C44 54 53 62 55 76C57 90 58 102 60 114C63 128 66 146 68 162C70 170 70 178 66 184C62 188 58 184 58 176C56 160 50 140 46 122C44 112 42 100 40 90C38 104 34 118 31 130C31 142 34 150 35 160C37 186 34 214 30 232C31 246 30 262 26 282C27 288 31 293 31 297C31 300 27 301 23 301L13 301C10 301 10 298 10.5 295C11.5 290 11 285 10 280C8 262 8 246 10 232C8 214 5 190 2 168L0 166Z';

const SIDE_DELTS = 'M44 57C50 60 53.5 68 54 80C51 83 47 85 42.5 85C43 76 43.5 66 44 57Z';
/** The cap of the shoulder that faces the viewer: the front delts from the front, the rear from behind. */
const NEAR_DELTS = 'M30 53.5C35 53 40 54 42.3 56C42 64 41.5 74 40.5 84C39 72 36 61 30 56.5Z';
const FOREARMS = 'M48 122C52 122 57 120 60 119C63 132 65 148 66 160L60 162C56 148 51 134 48 122Z';
const UPPER_ARM = 'M42 90C47 89 52 89 55.5 90C57 100 58 108 58 114C54 118 50 118 47 116C45 108 43 98 42 90Z';

export const FRONT: BodyShape[] = [
  { region: 'chest', d: 'M1.5 62C10 56 24 56 34 60C37 70 35 82 27 90C18 96 8 96 1.5 92Z' },
  { region: 'frontDelts', d: NEAR_DELTS },
  { region: 'sideDelts', d: SIDE_DELTS },
  { region: 'biceps', d: UPPER_ARM },
  { region: 'forearms', d: FOREARMS },
  {
    region: 'abs',
    d: 'M1.5 99C7 99 13 98 17 97L17 111L1.5 112ZM1.5 115L17 114L17 128L1.5 129ZM1.5 132L17 131L15 152L1.5 160ZM20 97C25 96 31 94 33 92C33 105 30 118 28 130C28 136 29 142 30 146L18 152L20 128Z',
  },
  { region: 'quads', d: 'M5 170C14 162 28 158 34 164C35 184 32 208 27 224C24 227 20 227 17 225C12 210 7 190 5 170Z' },
  { region: 'calves', d: 'M12 238C15 236 24 236 28 238C29 250 28 264 25 278L17 278C13 264 11 250 12 238Z' },
];

export const BACK: BodyShape[] = [
  { region: 'upperBack', d: 'M1.5 48L8 47C14 52 24 53 32 56C30 64 20 76 10 84C6 90 3 96 1.5 102Z' },
  { region: 'rearDelts', d: NEAR_DELTS },
  { region: 'sideDelts', d: SIDE_DELTS },
  { region: 'lats', d: 'M33 62C36 72 35 84 33 94C31 108 28 118 26 124C20 126 14 128 8 130L3 124L3 106C8 92 20 78 33 62Z' },
  { region: 'triceps', d: UPPER_ARM },
  { region: 'forearms', d: FOREARMS },
  { region: 'lowerBack', d: 'M1.5 126L8 134L25 128C26 136 28 142 30 148C20 150 10 152 1.5 154Z' },
  { region: 'glutes', d: 'M1.5 157C12 154 26 152 33 156C36 168 35 178 30 186C22 190 10 190 3 186C1.5 176 1.5 166 1.5 157Z' },
  { region: 'hamstrings', d: 'M4 192C12 194 24 194 33 190C34 204 30 218 27 228C23 230 18 230 15 228C10 216 6 204 4 192Z' },
  { region: 'calves', d: 'M11 236C15 233 25 233 29 236C31 248 29 262 25 274L21 280L17 280C12 262 9 248 11 236Z' },
];
