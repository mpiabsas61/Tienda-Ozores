import express from 'express';
import userController from '../controllers/usuarioController.js';
import { authenticateToken, isAdmin } from '../middlewares/authMiddleware.js';
const router = express.Router();

router.post('/register', userController.register);

router.post('/password-recovery/request', userController.requestPasswordReset);

router.post('/password-recovery/reset', userController.resetPassword);

router.get('/admin/usuarios', authenticateToken, isAdmin, userController.getAdminAll);

router.get('/usuarios/me', authenticateToken, userController.getMyProfile);

router.put('/usuarios/me', authenticateToken, userController.updateMyProfile);

router.put('/usuarios/:id', authenticateToken, isAdmin, userController.update);

router.get('/usuarios/:id', userController.getById);

router.delete('/usuarios/:id', userController.delete);

export default router;
