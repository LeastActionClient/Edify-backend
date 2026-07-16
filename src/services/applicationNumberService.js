import { Application } from '../models/index.js';
import { getSettingsDocument, updateSettingsSnapshot } from './settingsService.js';

const DEFAULT_PREFIX = 'AC-';
const DEFAULT_PADDING = 3;

const parseSequence = (value) => {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(.*?)(\d+)$/);
  if (!match) return null;

  const prefix = match[1];
  const numericPart = match[2];
  const parsedValue = Number.parseInt(numericPart, 10);

  if (!Number.isFinite(parsedValue)) return null;

  return {
    prefix,
    padding: numericPart.length,
    value: parsedValue
  };
};

const formatSequence = ({ prefix, padding, value }) => {
  const safePrefix = prefix || DEFAULT_PREFIX;
  const safePadding = Number.isFinite(Number(padding)) && Number(padding) > 0 ? Number(padding) : DEFAULT_PADDING;
  return `${safePrefix}${String(value).padStart(safePadding, '0')}`;
};

const seedFromLatestApplication = async (session = null) => {
  let query = Application.findOne({
    applicationId: { $exists: true, $type: 'string', $ne: '' }
  })
    .sort({ applicationDate: -1, createdAt: -1, _id: -1 })
    .select('applicationId');

  if (session) {
    query = query.session(session);
  }

  const latestApp = await query.lean();
  return parseSequence(latestApp?.applicationId);
};

const getInitialSequence = () => ({
  prefix: DEFAULT_PREFIX,
  padding: DEFAULT_PADDING,
  value: 1
});

const resolveCurrentSequence = async (session = null) => {
  const settings = await getSettingsDocument(session);
  const settingsSeq = parseSequence(settings?.nextApplicationNo);
  if (settingsSeq) {
    return settingsSeq;
  }

  const latestSeq = await seedFromLatestApplication(session);
  if (latestSeq) {
    const nextSeq = nextSequence(latestSeq);
    await updateSettingsSnapshot({
      nextApplicationNo: formatSequence(nextSeq)
    }, session);
    return nextSeq;
  }

  return getInitialSequence();
};

const nextSequence = (sequence) => ({
  prefix: sequence.prefix,
  padding: sequence.padding,
  value: sequence.value + 1
});

export const getCurrentApplicationNumber = async (session = null) => {
  const sequence = await resolveCurrentSequence(session);
  return formatSequence(sequence);
};

export const reserveNextApplicationNumber = async (session = null) => {
  const currentSequence = await resolveCurrentSequence(session);
  const currentNumber = formatSequence(currentSequence);
  const nextNumber = formatSequence(nextSequence(currentSequence));

  await updateSettingsSnapshot({
    nextApplicationNo: nextNumber
  }, session);

  return currentNumber;
};

export const isDuplicateApplicationNumberError = (error) => {
  if (!error || error.code !== 11000) {
    return false;
  }

  const keyPattern = error.keyPattern || {};
  return !!keyPattern.applicationId || (typeof error.message === 'string' && error.message.includes('applicationId'));
};
