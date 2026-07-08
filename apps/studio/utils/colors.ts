type ColorPalette = { [key: string]: { [key: number]: string } };

export const VIEWPORT_BACKGROUND = '#171717';

export const colors: ColorPalette = {
  teal: {
    50: '240 253 250',
    100: '204 251 241',
    200: '167 243 235',
    300: '107 231 214',
    400: '45 212 191',
    500: '20 184 166',
    600: '13 148 136',
    700: '15 118 110',
    800: '17 94 89',
    900: '19 78 74',
    950: '4 47 46',
  },
  blue: {
    50: '239 246 255',
    100: '219 234 254',
    200: '191 219 254',
    300: '147 197 253',
    400: '96 165 250',
    500: '59 130 246',
    600: '37 99 235',
    700: '29 78 216',
    800: '30 64 175',
    900: '30 58 138',
    950: '23 37 84',
  },
  rose: {
    50: '255 241 242',
    100: '255 228 230',
    200: '254 205 211',
    300: '253 164 175',
    400: '251 113 133',
    500: '244 63 94',
    600: '225 29 72',
    700: '190 18 60',
    800: '159 18 57',
    900: '136 19 55',
    950: '76 5 25',
  },
  amber: {
    50: '255 251 235',
    100: '254 243 199',
    200: '253 230 138',
    300: '252 211 77',
    400: '251 191 36',
    500: '245 158 11',
    600: '217 119 6',
    700: '180 83 9',
    800: '146 64 14',
    900: '120 53 15',
    950: '69 28 8',
  },
  green: {
    50: '240 253 244',
    100: '220 252 231',
    200: '187 247 208',
    300: '134 239 172',
    400: '74 222 128',
    500: '34 197 94',
    600: '22 163 74',
    700: '21 128 61',
    800: '22 101 52',
    900: '20 83 45',
    950: '5 46 22',
  },
  indigo: {
    50: '238 242 255',
    100: '224 231 255',
    200: '199 210 254',
    300: '165 180 252',
    400: '129 140 248',
    500: '99 102 241',
    600: '79 70 229',
    700: '67 56 202',
    800: '55 48 163',
    900: '49 46 129',
    950: '30 27 75',
  },
};

const colorHues: Record<string, number> = {
  teal: 172,
  blue: 217,
  rose: 350,
  amber: 38,
  green: 145,
  indigo: 239,
};

export const applyTheme = (color: string) => {
  const palette = colors[color] || colors.teal;
  const root = document.documentElement;
  for (const shade in palette) {
    root.style.setProperty(`--color-primary-${shade}`, palette[shade]);
  }
  const hue = colorHues[color] || colorHues.teal;
  root.style.setProperty('--color-primary-hue', String(hue));
};

export const applyUiStyle = (style: 'glass' | 'solid') => {
  document.body.classList.remove('ui-glass', 'ui-solid');
  document.body.classList.add(`ui-${style}`);
};

export type ComponentStyle = 'glass' | 'flat';

export const applyComponentStyle = (style: ComponentStyle) => {
  document.documentElement.dataset.componentStyle = style;
};
