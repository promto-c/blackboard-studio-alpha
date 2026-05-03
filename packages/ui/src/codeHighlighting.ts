type CodeTokenClass =
  | 'attribute'
  | 'boolean'
  | 'builtin'
  | 'comment'
  | 'function'
  | 'keyword'
  | 'number'
  | 'operator'
  | 'preprocessor'
  | 'property'
  | 'string'
  | 'tag'
  | 'type';

interface TokenPattern {
  className: CodeTokenClass;
  regex: RegExp;
}

interface LanguageDefinition {
  aliases: string[];
  patterns: TokenPattern[];
}

const STYLE_ELEMENT_ID = 'bb-code-highlight-styles';

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const createWordPattern = (values: string[], flags = '') =>
  new RegExp(`\\b(?:${values.map(escapeRegex).join('|')})\\b`, flags);

const createStickyRegExp = (pattern: RegExp) => {
  const flags = pattern.flags.replace(/g/g, '');
  return new RegExp(pattern.source, flags.includes('y') ? flags : `${flags}y`);
};

const createTokenPatterns = (patterns: Array<[RegExp, CodeTokenClass]>): TokenPattern[] =>
  patterns.map(([regex, className]) => ({
    className,
    regex: createStickyRegExp(regex),
  }));

const createLanguageDefinition = (
  aliases: string[],
  patterns: Array<[RegExp, CodeTokenClass]>,
): LanguageDefinition => ({
  aliases,
  patterns: createTokenPatterns(patterns),
});

const COMMON_OPERATORS = /[+\-*/=<>!&|?%^~:]+/;
const COMMON_FUNCTION = /\b[A-Za-z_$][\w$-]*(?=\s*\()/;
const COMMON_NUMBER =
  /\b-?(?:0x[0-9a-f]+|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(?:f|n|px|rem|em|%|ms|s)?\b/i;

const GENERIC_LANGUAGE = createLanguageDefinition(
  ['generic'],
  [
    [/(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)/, 'comment'],
    [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\[\s\S]|[^`])*`/, 'string'],
    [createWordPattern(['true', 'false', 'null', 'undefined']), 'boolean'],
    [COMMON_NUMBER, 'number'],
    [COMMON_FUNCTION, 'function'],
    [COMMON_OPERATORS, 'operator'],
  ],
);

const GLSL_LANGUAGE = createLanguageDefinition(
  ['glsl', 'frag', 'vert', 'shader'],
  [
    [/#[^\n]*/, 'preprocessor'],
    [/(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/, 'comment'],
    [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/, 'string'],
    [
      createWordPattern([
        'precision',
        'highp',
        'mediump',
        'lowp',
        'uniform',
        'in',
        'out',
        'inout',
        'const',
        'void',
        'if',
        'else',
        'for',
        'while',
        'do',
        'break',
        'continue',
        'return',
        'discard',
        'struct',
        'layout',
      ]),
      'keyword',
    ],
    [
      createWordPattern([
        'float',
        'int',
        'uint',
        'bool',
        'vec2',
        'vec3',
        'vec4',
        'ivec2',
        'ivec3',
        'ivec4',
        'uvec2',
        'uvec3',
        'uvec4',
        'mat2',
        'mat3',
        'mat4',
        'sampler2D',
        'samplerCube',
      ]),
      'type',
    ],
    [
      createWordPattern(['gl_Position', 'gl_FragCoord', 'gl_FragColor', 'fragColor', 'v_uv']),
      'builtin',
    ],
    [
      createWordPattern([
        'texture',
        'mix',
        'clamp',
        'pow',
        'dot',
        'normalize',
        'length',
        'sin',
        'cos',
        'tan',
        'atan',
        'abs',
        'floor',
        'ceil',
        'mod',
        'fract',
        'step',
        'smoothstep',
        'cross',
        'distance',
        'reflect',
        'refract',
        'faceforward',
        'exp',
        'log',
        'exp2',
        'log2',
        'sqrt',
        'inversesqrt',
        'min',
        'max',
        'sign',
        'main',
      ]),
      'function',
    ],
    [createWordPattern(['true', 'false']), 'boolean'],
    [/\b-?(?:\d+\.\d*|\.\d+|\d+)(?:e[+-]?\d+)?f?\b/i, 'number'],
    [COMMON_OPERATORS, 'operator'],
  ],
);

const JAVASCRIPT_LANGUAGE = createLanguageDefinition(
  ['javascript', 'js', 'jsx', 'typescript', 'ts', 'tsx'],
  [
    [/(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/, 'comment'],
    [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\[\s\S]|[^`])*`/, 'string'],
    [
      createWordPattern([
        'await',
        'async',
        'break',
        'case',
        'catch',
        'class',
        'const',
        'continue',
        'debugger',
        'default',
        'delete',
        'do',
        'else',
        'enum',
        'export',
        'extends',
        'finally',
        'for',
        'from',
        'function',
        'if',
        'import',
        'in',
        'instanceof',
        'interface',
        'let',
        'new',
        'of',
        'return',
        'switch',
        'throw',
        'try',
        'type',
        'var',
        'while',
        'with',
        'yield',
      ]),
      'keyword',
    ],
    [
      createWordPattern([
        'Array',
        'Date',
        'Error',
        'JSON',
        'Map',
        'Math',
        'Number',
        'Object',
        'Promise',
        'React',
        'RegExp',
        'Set',
        'String',
        'console',
        'window',
        'document',
      ]),
      'builtin',
    ],
    [
      createWordPattern([
        'any',
        'boolean',
        'never',
        'null',
        'number',
        'string',
        'symbol',
        'unknown',
        'undefined',
        'void',
      ]),
      'type',
    ],
    [createWordPattern(['true', 'false', 'null', 'undefined']), 'boolean'],
    [COMMON_NUMBER, 'number'],
    [COMMON_FUNCTION, 'function'],
    [COMMON_OPERATORS, 'operator'],
  ],
);

const JSON_LANGUAGE = createLanguageDefinition(
  ['json'],
  [
    [/"(?:\\.|[^"\\])*"(?=\s*:)/, 'property'],
    [/"(?:\\.|[^"\\])*"/, 'string'],
    [createWordPattern(['true', 'false', 'null']), 'boolean'],
    [COMMON_NUMBER, 'number'],
    [/[\[\]{}:,]+/, 'operator'],
  ],
);

const BASH_LANGUAGE = createLanguageDefinition(
  ['bash', 'sh', 'shell', 'zsh'],
  [
    [/#![^\n]*/, 'preprocessor'],
    [/#[^\n]*/, 'comment'],
    [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/, 'string'],
    [
      createWordPattern([
        'if',
        'then',
        'fi',
        'for',
        'while',
        'do',
        'done',
        'case',
        'esac',
        'function',
        'in',
        'else',
        'elif',
      ]),
      'keyword',
    ],
    [/\$[A-Za-z_][A-Za-z0-9_]*|\$\{[^}]+\}/, 'builtin'],
    [
      createWordPattern(['alias', 'cd', 'echo', 'export', 'grep', 'pwd', 'printf', 'source']),
      'builtin',
    ],
    [COMMON_NUMBER, 'number'],
    [COMMON_FUNCTION, 'function'],
    [COMMON_OPERATORS, 'operator'],
  ],
);

const PYTHON_LANGUAGE = createLanguageDefinition(
  ['python', 'py'],
  [
    [/#[^\n]*/, 'comment'],
    [/@[A-Za-z_][A-Za-z0-9_.]*/, 'preprocessor'],
    [/"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/, 'string'],
    [
      createWordPattern([
        'and',
        'as',
        'assert',
        'async',
        'await',
        'break',
        'class',
        'continue',
        'def',
        'del',
        'elif',
        'else',
        'except',
        'finally',
        'for',
        'from',
        'global',
        'if',
        'import',
        'in',
        'is',
        'lambda',
        'nonlocal',
        'not',
        'or',
        'pass',
        'raise',
        'return',
        'try',
        'while',
        'with',
        'yield',
      ]),
      'keyword',
    ],
    [
      createWordPattern([
        'dict',
        'float',
        'int',
        'len',
        'list',
        'None',
        'print',
        'range',
        'set',
        'str',
        'tuple',
      ]),
      'builtin',
    ],
    [createWordPattern(['True', 'False']), 'boolean'],
    [COMMON_NUMBER, 'number'],
    [COMMON_FUNCTION, 'function'],
    [COMMON_OPERATORS, 'operator'],
  ],
);

const HTML_LANGUAGE = createLanguageDefinition(
  ['html', 'xml', 'svg'],
  [
    [/<!--[\s\S]*?-->/, 'comment'],
    [/<!DOCTYPE[\s\S]*?>/i, 'preprocessor'],
    [/<\/?[A-Za-z][A-Za-z0-9:-]*/, 'tag'],
    [/\b[A-Za-z_:][-\w:.]*(?=\=)/, 'attribute'],
    [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/, 'string'],
    [/\/?>|=/, 'operator'],
  ],
);

const CSS_LANGUAGE = createLanguageDefinition(
  ['css', 'scss', 'sass'],
  [
    [/(?:\/\*[\s\S]*?\*\/)/, 'comment'],
    [/@[A-Za-z-]+\b/i, 'preprocessor'],
    [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/, 'string'],
    [/[A-Za-z-]+(?=\s*:)/i, 'property'],
    [/[A-Za-z-]+(?=\s*\()/i, 'function'],
    [/#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b/i, 'number'],
    [/\b-?(?:\d+\.?\d*|\.\d+)(?:%|[a-z]+)?\b/i, 'number'],
    [/[{}:;(),.]+/, 'operator'],
  ],
);

const SQL_LANGUAGE = createLanguageDefinition(
  ['sql'],
  [
    [/(?:--[^\n]*|\/\*[\s\S]*?\*\/)/, 'comment'],
    [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/, 'string'],
    [
      createWordPattern(
        [
          'alter',
          'and',
          'as',
          'by',
          'case',
          'create',
          'delete',
          'desc',
          'distinct',
          'drop',
          'else',
          'end',
          'from',
          'group',
          'having',
          'insert',
          'into',
          'join',
          'left',
          'limit',
          'not',
          'null',
          'offset',
          'on',
          'or',
          'order',
          'right',
          'select',
          'set',
          'table',
          'then',
          'union',
          'update',
          'values',
          'when',
          'where',
        ],
        'i',
      ),
      'keyword',
    ],
    [createWordPattern(['avg', 'coalesce', 'count', 'max', 'min', 'now', 'sum'], 'i'), 'function'],
    [
      createWordPattern(
        ['bigint', 'boolean', 'date', 'decimal', 'integer', 'text', 'timestamp', 'varchar'],
        'i',
      ),
      'type',
    ],
    [COMMON_NUMBER, 'number'],
    [COMMON_OPERATORS, 'operator'],
  ],
);

const LANGUAGE_DEFINITIONS = [
  GENERIC_LANGUAGE,
  GLSL_LANGUAGE,
  JAVASCRIPT_LANGUAGE,
  JSON_LANGUAGE,
  BASH_LANGUAGE,
  PYTHON_LANGUAGE,
  HTML_LANGUAGE,
  CSS_LANGUAGE,
  SQL_LANGUAGE,
];

const LANGUAGE_MAP = new Map(
  LANGUAGE_DEFINITIONS.flatMap((definition) =>
    definition.aliases.map((alias) => [alias, definition] as const),
  ),
);

const normalizeLanguage = (language?: string | null) => {
  const normalized = language?.trim().toLowerCase();
  return normalized ? normalized : null;
};

const resolveLanguageDefinition = (language?: string | null) => {
  const normalizedLanguage = normalizeLanguage(language);

  if (!normalizedLanguage) {
    return GENERIC_LANGUAGE;
  }

  if (
    normalizedLanguage === 'text' ||
    normalizedLanguage === 'plain' ||
    normalizedLanguage === 'plaintext'
  ) {
    return null;
  }

  return LANGUAGE_MAP.get(normalizedLanguage) ?? GENERIC_LANGUAGE;
};

export const ensureCodeHighlightStyles = () => {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ELEMENT_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
    .bb-code-token-root {
      color: #e5edf8;
    }

    .bb-code-token--comment {
      color: #7d8ca3;
      font-style: italic;
    }

    .bb-code-token--preprocessor {
      color: #94a3b8;
    }

    .bb-code-token--keyword {
      color: #f472b6;
    }

    .bb-code-token--type {
      color: #67e8f9;
      font-style: italic;
    }

    .bb-code-token--builtin {
      color: #7dd3fc;
    }

    .bb-code-token--function {
      color: #bef264;
    }

    .bb-code-token--boolean,
    .bb-code-token--number {
      color: #c4b5fd;
    }

    .bb-code-token--operator {
      color: #fda4af;
    }

    .bb-code-token--string {
      color: #fdba74;
    }

    .bb-code-token--property {
      color: #fde68a;
    }

    .bb-code-token--tag {
      color: #f9a8d4;
    }

    .bb-code-token--attribute {
      color: #93c5fd;
    }
  `;
  document.head.appendChild(style);
};

export const highlightCode = (code: string, language?: string | null) => {
  const definition = resolveLanguageDefinition(language);
  if (!definition) {
    return escapeHtml(code);
  }

  let highlighted = '';
  let index = 0;

  while (index < code.length) {
    let didMatchPattern = false;

    for (const pattern of definition.patterns) {
      pattern.regex.lastIndex = index;
      const match = pattern.regex.exec(code);
      if (!match || match.index !== index || !match[0]) {
        continue;
      }

      highlighted += `<span class="bb-code-token--${pattern.className}">${escapeHtml(match[0])}</span>`;
      index += match[0].length;
      didMatchPattern = true;
      break;
    }

    if (!didMatchPattern) {
      highlighted += escapeHtml(code[index]);
      index += 1;
    }
  }

  return highlighted;
};
