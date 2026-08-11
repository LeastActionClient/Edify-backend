import { Router } from 'express';
import Teacher from '../models/Teacher.js';
import { authenticate as auth } from '../middlewares/authMiddleware.js';
import { uploadPhoto } from '../middlewares/uploadMiddleware.js';
import { isCloudinaryConfigured, uploadToCloudinary } from '../config/cloudinary.js';
import fs from 'fs';
import path from 'path';

const router = Router();

// Upload Teacher Photo
router.post('/upload-photo', auth, (req, res) => {
  uploadPhoto.single('photo')(req, res, async (err) => {
    if (err) {
      console.error('Multer error:', err);
      return res.status(400).json({ error: err.message || 'File upload failed' });
    }
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No photo uploaded.' });
      }
      let finalPhotoUrl = '';
      if (isCloudinaryConfigured()) {
        const cloudinaryResult = await uploadToCloudinary(req.file.buffer, 'teacher_photos');
        finalPhotoUrl = cloudinaryResult.secure_url;
      } else {
        const uploadsDir = path.resolve('uploads/photos');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(req.file.originalname || '.jpg').toLowerCase();
        const filename = `teacher-${uniqueSuffix}${ext}`;
        const filePath = path.join(uploadsDir, filename);
        fs.writeFileSync(filePath, req.file.buffer);
        finalPhotoUrl = `/uploads/photos/${filename}`;
      }

      if (req.body.teacherId) {
        const targetId = req.body.teacherId;
        await Teacher.findByIdAndUpdate(targetId, { photo: finalPhotoUrl });
      }

      res.json({ photoUrl: finalPhotoUrl });
    } catch (error) {
      console.error('Error uploading photo:', error);
      res.status(500).json({ error: 'Failed to upload photo.' });
    }
  });
});

// Get all teachers
router.get('/', auth, async (req, res) => {
  try {
    const teachers = await Teacher.find().sort({ createdAt: -1 });
    res.json(teachers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create teacher
router.post('/', auth, async (req, res) => {
  try {
    const teacher = new Teacher(req.body);
    await teacher.save();
    res.status(201).json(teacher);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get teacher by ID
router.get('/:id', auth, async (req, res) => {
  try {
    const teacher = await Teacher.findById(req.params.id);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });
    res.json(teacher);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update teacher
router.put('/:id', auth, async (req, res) => {
  try {
    const teacher = await Teacher.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });
    res.json(teacher);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete teacher
router.delete('/:id', auth, async (req, res) => {
  try {
    const teacher = await Teacher.findByIdAndDelete(req.params.id);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });
    res.json({ message: 'Teacher deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
