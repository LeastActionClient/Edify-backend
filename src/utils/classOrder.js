const ROMAN_MAP = {
  'xii': 12,
  'xi': 11,
  'x': 10,
  'ix': 9,
  'viii': 8,
  'vii': 7,
  'vi': 6,
  'v': 5,
  'iv': 4,
  'iii': 3,
  'ii': 2,
  'i': 1
};

export const getClassRank = (value) => {
  if (!value) return 9999;
  const raw = typeof value === 'object' ? (value?.name || value?.className || value?.currentClass || '') : String(value ?? '');
  const trimmed = raw.trim().toLowerCase();
  const norm = trimmed.replace(/[^a-z0-9]/g, '');

  if (!norm) return 9999;

  // 1. Preschool / Kindergarten
  if (norm === 'pkg' || norm === 'prekg' || norm === 'nursery' || norm === 'playgroup' || norm.includes('prekg') || norm.includes('pkg')) {
    return 10;
  }
  if (norm === 'lkg' || norm === 'lowerkg' || norm === 'jrkg' || norm === 'juniorkg' || norm === 'pp1' || norm === 'kg1' || norm.includes('lkg')) {
    return 20;
  }
  if (norm === 'ukg' || norm === 'upperkg' || norm === 'srkg' || norm === 'seniorkg' || norm === 'pp2' || norm === 'kg2' || norm.includes('ukg')) {
    return 30;
  }

  // 2. Strip standard prefixes/suffixes like 'class', 'std', 'standard', 'grade', 'th', 'st', 'nd', 'rd'
  const stripped = norm.replace(/(standard|class|grade|std)/g, '');

  // Check Roman numerals on stripped
  if (ROMAN_MAP[stripped] !== undefined) {
    return 100 + ROMAN_MAP[stripped];
  }

  // Check numeric digit
  const numOnly = stripped.replace(/(th|st|nd|rd)/g, '');
  const parsedNum = parseInt(numOnly, 10);
  if (!isNaN(parsedNum) && parsedNum > 0) {
    return 100 + parsedNum;
  }

  // Fallback: check if raw tokens contain roman numerals or digits
  const tokens = trimmed.split(/[\s\-_]+/);
  for (const token of tokens) {
    const cleanToken = token.replace(/[^a-z0-9]/g, '');
    if (ROMAN_MAP[cleanToken] !== undefined) {
      return 100 + ROMAN_MAP[cleanToken];
    }
    const tokenNum = parseInt(cleanToken.replace(/(th|st|nd|rd)/g, ''), 10);
    if (!isNaN(tokenNum) && tokenNum > 0) {
      return 100 + tokenNum;
    }
  }

  return 9000;
};

export const compareClassNames = (a, b) => {
  const nameA = typeof a === 'object' ? (a?.name || a?.className || a?.currentClass || '') : String(a ?? '');
  const nameB = typeof b === 'object' ? (b?.name || b?.className || b?.currentClass || '') : String(b ?? '');

  const rankA = getClassRank(nameA);
  const rankB = getClassRank(nameB);

  if (rankA !== rankB) {
    return rankA - rankB;
  }

  return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
};

export const classSortFn = compareClassNames;
