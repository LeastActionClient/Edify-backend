import Student from '../models/Student.js';
import { generateAdmissionNumber } from './admissionNumberService.js';

export const createStudentWithGeneratedAdmissionNumber = async (studentData, options = {}) => {
  const admissionNumber = await generateAdmissionNumber(options.session || null);
  const payload = { ...studentData, admissionNumber };

  const createdStudents = options.session
    ? await Student.create([payload], { session: options.session })
    : await Student.create([payload]);

  const student = Array.isArray(createdStudents) ? createdStudents[0] : createdStudents;
  return { student, admissionNumber };
};
