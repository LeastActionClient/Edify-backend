import AdmissionSequence from '../models/AdmissionSequence.js';
import Student from '../models/Student.js';

const SEQUENCE_ID = 'student-admission-number';
const DEFAULT_PREFIX = 'ADM';
const DEFAULT_PADDING = 4;

const parseAdmissionNumber = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(.*?)(\d+)$/);
  if (!match) {
    return null;
  }

  const prefix = match[1];
  const numericPart = match[2];
  const parsedValue = Number.parseInt(numericPart, 10);

  if (!Number.isFinite(parsedValue)) {
    return null;
  }

  return {
    prefix,
    padding: numericPart.length,
    value: parsedValue
  };
};

const getSeedFromLatestStudent = async (session) => {
  let query = Student.findOne({
    admissionNumber: { $exists: true, $type: 'string', $ne: '' }
  })
    .sort({ admissionNumber: -1, createdAt: -1, _id: -1 })
    .select('admissionNumber');

  if (session) {
    query = query.session(session);
  }

  const latestStudent = await query.lean();

  const parsed = parseAdmissionNumber(latestStudent?.admissionNumber);

  return {
    prefix: parsed ? parsed.prefix : DEFAULT_PREFIX,
    padding: parsed ? parsed.padding : DEFAULT_PADDING,
    value: parsed ? parsed.value : 0,
    sourceAdmissionNumber: latestStudent?.admissionNumber || ''
  };
};

export const generateAdmissionNumber = async (session = null) => {
  const seed = await getSeedFromLatestStudent(session);

  let sequence = await AdmissionSequence.findOneAndUpdate(
    { _id: SEQUENCE_ID },
    {
      $setOnInsert: {
        prefix: seed.prefix,
        padding: seed.padding,
        value: seed.value,
        sourceAdmissionNumber: ''
      }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true, session: session || undefined }
  ).select('prefix padding value');

  if (sequence && sequence.value < seed.value) {
    sequence = await AdmissionSequence.findOneAndUpdate(
      { _id: SEQUENCE_ID, value: { $lt: seed.value } },
      {
        $set: {
          prefix: seed.prefix,
          padding: seed.padding,
          value: seed.value
        }
      },
      { new: true, session: session || undefined }
    ).select('prefix padding value');
  }

  sequence = await AdmissionSequence.findOneAndUpdate(
    { _id: SEQUENCE_ID },
    { $inc: { value: 1 } },
    { new: true, session: session || undefined }
  ).select('prefix padding value');

  const prefix = sequence?.prefix ?? DEFAULT_PREFIX;
  const padding = Number(sequence?.padding ?? DEFAULT_PADDING);
  const value = Number(sequence?.value ?? 0);

  return `${prefix}${String(value).padStart(padding, '0')}`;
};

export const peekNextAdmissionNumber = async () => {
  const seed = await getSeedFromLatestStudent();
  const sequence = await AdmissionSequence.findOne({ _id: SEQUENCE_ID });

  let prefix = seed.prefix || DEFAULT_PREFIX;
  let padding = Number(seed.padding || DEFAULT_PADDING);
  let value = Number(seed.value);

  if (sequence) {
    prefix = sequence.prefix || prefix;
    padding = Number(sequence.padding || padding);
    value = Math.max(value, Number(sequence.value));
  }

  const nextValue = value + 1;
  return `${prefix}${String(nextValue).padStart(padding, '0')}`;
};


export const isDuplicateAdmissionNumberError = (error) => {
  if (!error || error.code !== 11000) {
    return false;
  }

  const keyPattern = error.keyPattern || {};
  if (keyPattern.admissionNumber) {
    return true;
  }

  return typeof error.message === 'string' && error.message.includes('admissionNumber');
};
