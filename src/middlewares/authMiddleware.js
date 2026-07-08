import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';


export const authenticate = async (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1];
  
  if (!token) {
    res.status(401).json({ error: 'Access denied. No token provided.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'User no longer exists. Please log in again.' });
    }

    req.user = decoded;

    await User.findByIdAndUpdate(decoded.id, { lastActivity: new Date() })
      .catch(err => console.error("Error updating last activity", err));

    next();
  } catch (ex) {
    res.status(400).json({ error: 'Invalid token.' });
  }
};

export const authorizeSuperAdmin = (req, res, next) => {
  if (req.user?.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Access denied. Super Admin only.' });
    return;
  }
  next();
};
