const stripNonDigits = (value) => String(value).replace(/\D/g, '');

/**
 * Normalizes a parent/guardian contact number into the international E.164
 * format used by the wa.me WhatsApp deep link for an Indian school.
 *
 * Handles the following input shapes:
 *   9876543210            -> 919876543210
 *   +919876543210         -> 919876543210
 *   919876543210          -> 919876543210
 *   +91 98765 43210       -> 919876543210
 *   09876543210           -> 919876543210
 *   (987) 654-3210        -> 919876543210
 *
 * Also rejects masked or non-mobile values (e.g. "98XX..." or landlines),
 * returning { ok: false, reason } so callers can surface a friendly message.
 *
 * The leading `[5-9]` check mirrors the existing student form validators
 * used across this application (see Admissions/StudentEdit).
 *
 * @param {string} input
 * @returns {{ ok: boolean, reason?: string, number?: string, e164?: string, display?: string }}
 */
export const normalizeIndianMobile = (input) => {
  if (input === null || input === undefined) {
    return { ok: false, reason: 'missing' };
  }

  const raw = String(input).trim();
  if (!raw) {
    return { ok: false, reason: 'missing' };
  }

  let digits = stripNonDigits(raw);

  // A single leading 0 is commonly used for STDs; drop it if present so
  // "09876543210" resolves to the 10-digit mobile "9876543210".
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  let normalized = null;
  if (digits.length === 12 && digits.startsWith('91')) {
    normalized = digits;
  } else if (digits.length === 10) {
    normalized = `91${digits}`;
  }

  // 91 + a valid 10-digit Indian mobile (leading digit 5-9).
  if (!normalized || !/^91[5-9]\d{9}$/.test(normalized)) {
    return { ok: false, reason: 'invalid' };
  }

  return {
    ok: true,
    reason: 'ok',
    number: normalized,
    e164: `+${normalized}`,
    display: `+91 ${normalized.slice(2, 7)} ${normalized.slice(7)}`
  };
};

export const isWhitespaceNumber = (value) => String(value || '').trim() === '';
