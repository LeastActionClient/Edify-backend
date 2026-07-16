import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Settings from '../models/Settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEGACY_SETTINGS_PATH = path.resolve(__dirname, '../../settings.json');
const SETTINGS_ID = 'global';

const normalizeSettings = (input = {}) => ({
  nextApplicationNo: typeof input.nextApplicationNo === 'string' ? input.nextApplicationNo.trim() : '',
  applicationFeeAmount: input.applicationFeeAmount === undefined || input.applicationFeeAmount === null
    ? ''
    : String(input.applicationFeeAmount).trim()
});

const readLegacySettings = () => {
  try {
    if (!fs.existsSync(LEGACY_SETTINGS_PATH)) {
      return {};
    }

    const raw = fs.readFileSync(LEGACY_SETTINGS_PATH, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('Error reading legacy settings.json', error);
    return {};
  }
};

const hasUsefulSettings = (value) => Boolean(value?.nextApplicationNo || value?.applicationFeeAmount);

export const getSettingsDocument = async (session = null, { migrateLegacy = true } = {}) => {
  let query = Settings.findById(SETTINGS_ID);
  if (session) {
    query = query.session(session);
  }

  let settings = await query;
  if (settings) {
    return settings;
  }

  if (migrateLegacy) {
    const legacySettings = normalizeSettings(readLegacySettings());
    if (hasUsefulSettings(legacySettings)) {
      return await Settings.findOneAndUpdate(
        { _id: SETTINGS_ID },
        { $setOnInsert: legacySettings },
        { new: true, upsert: true, setDefaultsOnInsert: true, session: session || undefined }
      );
    }
  }

  return null;
};

export const getSettingsSnapshot = async (session = null) => {
  const settings = await getSettingsDocument(session);
  if (!settings) {
    return { _id: SETTINGS_ID, nextApplicationNo: '', applicationFeeAmount: '' };
  }

  return {
    _id: settings._id || SETTINGS_ID,
    nextApplicationNo: settings.nextApplicationNo || '',
    applicationFeeAmount: settings.applicationFeeAmount || ''
  };
};

export const updateSettingsSnapshot = async (payload, session = null) => {
  const current = await getSettingsDocument(session, { migrateLegacy: true });
  const nextValue = normalizeSettings({
    ...(current ? current.toObject ? current.toObject() : current : {}),
    ...payload
  });

  const updated = await Settings.findOneAndUpdate(
    { _id: SETTINGS_ID },
    { $set: nextValue, $setOnInsert: { _id: SETTINGS_ID } },
    { new: true, upsert: true, setDefaultsOnInsert: true, session: session || undefined }
  );

  return {
    _id: updated._id || SETTINGS_ID,
    nextApplicationNo: updated.nextApplicationNo || '',
    applicationFeeAmount: updated.applicationFeeAmount || ''
  };
};

export const getApplicationFeeAmount = async (session = null) => {
  const settings = await getSettingsSnapshot(session);
  const amount = Number(settings.applicationFeeAmount);
  return Number.isFinite(amount) ? amount : 0;
};
