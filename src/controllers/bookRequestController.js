import BookRequest from '../models/BookRequest.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import AdminLog from '../models/AdminLog.js';
import ReadingList from '../models/ReadingList.js';
import { sendPushToUser } from '../services/webPushService.js';
import { downloadWithFallback } from '../services/connectorOrchestrator.js';

const logAdminAction = async (adminId, adminUsername, action, request, details = '') => {
  try {
    await AdminLog.create({
      admin: adminId,
      adminUsername,
      action,
      requestId: request?._id,
      requestTitle: request?.title,
      targetUser: request?.username,
      details
    });
  } catch (e) {
    console.error('Erreur log admin:', e.message);
  }
};
import { sendBookCompletedEmail, sendRequestCanceledEmail, sendNewRequestToAdminsEmail, sendAdminCommentEmail } from '../services/emailService.js';
import appriseService from '../services/appriseService.js';
import { runPostCompletionHooks } from '../services/postCompletionHooks.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Création d'une nouvelle demande de livre
export const createBookRequest = async (req, res) => {
  try {
    const { author, title, link, thumbnail, description, pageCount, format, category, targetUserId } = req.body;
    
    // Validation des champs obligatoires
    if (!author || !title) {
      return res.status(400).json({ error: 'Les champs auteur et titre sont obligatoires.' });
    }
    
    // Vérification du lien côté backend
    try {
      const url = new URL(link);
      if (!/^https?:/.test(url.protocol)) {
        return res.status(400).json({ error: 'Le lien doit commencer par http:// ou https://.' });
      }
    } catch {
      return res.status(400).json({ error: "Le lien fourni n'est pas une URL valide." });
    }
    
    // Récupérer l'utilisateur complet depuis la base de données
    const adminUser = await User.findById(req.user.id);
    if (!adminUser) {
      return res.status(404).json({ error: 'Utilisateur non trouvé.' });
    }

    // Si admin soumet pour un autre user, charger le user cible
    let user = adminUser;
    let submittedByAdmin = null;
    if (adminUser.role === 'admin' && targetUserId && targetUserId !== adminUser._id.toString()) {
      const targetUser = await User.findById(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ error: 'Utilisateur cible introuvable.' });
      }
      user = targetUser;
      submittedByAdmin = adminUser._id;
      console.log(`[Admin] ${adminUser.username} soumet une demande pour ${targetUser.username} : "${title}"`);
    }

    // Vérification du quota de demandes (jours glissants configurables)
    if (user.role !== 'admin') {
      const days = user.requestLimitDays ?? 30;
      const windowStart = new Date();
      windowStart.setDate(windowStart.getDate() - days);
      const recentCount = await BookRequest.countDocuments({
        user: user._id,
        createdAt: { $gte: windowStart }
      });
      const limit = user.requestLimit ?? 10;
      if (recentCount >= limit) {
        return res.status(429).json({
          error: `Vous avez atteint votre limite de ${limit} demande(s) sur les ${days} derniers jours.`
        });
      }
    }

    // ── Auto-complétion si le livre est déjà disponible ──────────────────────
    const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const completedVersion = await BookRequest.findOne({
      title: { $regex: `^${escRe(title.trim())}$`, $options: 'i' },
      author: { $regex: `^${escRe(author.trim())}$`, $options: 'i' },
      status: 'completed',
      $or: [
        { downloadLink: { $exists: true, $ne: '' } },
        { filePath: { $exists: true, $ne: '' } }
      ]
    }).lean();

    const isAutoCompleted = !!completedVersion;

    const newRequest = new BookRequest({
      user: user._id,
      username: user.username,
      ...(submittedByAdmin && { submittedByAdmin }),
      author,
      title,
      link: link || '',
      thumbnail: thumbnail || '',
      description: description || '',
      pageCount: pageCount || 0,
      format: format || '',
      category: ['ebook', 'comic', 'manga'].includes(category) ? category : 'ebook',
      status: isAutoCompleted ? 'completed' : 'pending',
      ...(isAutoCompleted && {
        downloadLink: completedVersion.downloadLink || '',
        filePath: completedVersion.filePath || '',
        completedAt: new Date(),
        statusHistory: [
          { status: 'pending', changedBy: user.username, note: 'Demande créée' },
          { status: 'completed', changedBy: 'système', note: 'Livre déjà disponible — complété automatiquement' }
        ]
      }),
      ...(!isAutoCompleted && {
        statusHistory: [{ status: 'pending', changedBy: user.username, note: 'Demande créée' }]
      })
    });

    await newRequest.save();

    // Auto-ajouter à la liste de lecture de l'utilisateur
    try {
      await ReadingList.create({
        userId: req.user.id,
        title: newRequest.title,
        author: newRequest.author,
        thumbnail: newRequest.thumbnail || '',
        source: 'request',
        requestId: newRequest._id,
        status: 'unread',
      });
    } catch (readingErr) {
      // Ne pas bloquer la création si l'ajout à la liste échoue
      console.error('Erreur ajout liste de lecture:', readingErr.message);
    }

    // ── Si auto-complété : notifier l'utilisateur, pas les admins ────────────
    if (isAutoCompleted) {
      try {
        if (user.emailVerified && user.email) {
          await sendBookCompletedEmail(user, newRequest);
        }
      } catch (e) {
        console.error('Erreur email auto-completion:', e.message);
      }
      try {
        await sendPushToUser(user._id, {
          title: '📖 Livre disponible !',
          body: `"${title}" de ${author} est déjà disponible. Vous pouvez le télécharger maintenant.`,
          url: '/dashboard'
        });
      } catch (e) {
        console.error('Erreur push auto-completion:', e.message);
      }
      try {
        await Notification.create({
          user: user._id,
          type: 'request_completed',
          title: newRequest.title,
          author: newRequest.author,
          message: `"${title}" est déjà disponible et a été ajouté à vos téléchargements automatiquement.`
        });
      } catch (e) {
        console.error('Erreur notification auto-completion:', e.message);
      }
      // Apprise admin global + Apprise personnel user
      appriseService.notifyBookCompleted(newRequest).catch(() => {});
      appriseService.notifyUserBookCompleted(user, newRequest).catch(() => {});
      return res.status(201).json(newRequest);
    }

    // Tentative de téléchargement automatique — Valentine puis Anna's Archive (non bloquant)
    downloadWithFallback(title, author, newRequest._id.toString(), newRequest.category);

    // Envoyer une notification Apprise pour la nouvelle demande
    appriseService.notifyNewBookRequest({ title, author, link }, user).catch(() => {});

    // Envoyer des emails + push web aux admins
    try {
      const admins = await User.find({ role: 'admin' }).select('email username emailVerified _id');

      if (admins.length > 0) {
        // Emails aux admins avec email vérifié
        const adminsWithEmail = admins.filter(a => a.emailVerified && a.email);
        if (adminsWithEmail.length > 0) {
          await Promise.allSettled(
            adminsWithEmail.map(admin =>
              sendNewRequestToAdminsEmail(admin, newRequest, user.username)
            )
          );
        }

        // Web push à tous les admins
        await Promise.allSettled(
          admins.map(admin =>
            sendPushToUser(admin._id, {
              title: '📚 Nouvelle demande',
              body: `${user.username} demande "${title}" de ${author}.`,
              url: '/admin'
            })
          )
        );

        // Notification site pour chaque admin
        await Promise.allSettled(
          admins.map(admin =>
            Notification.create({
              user: admin._id,
              type: 'new_request',
              title: newRequest.title,
              author: newRequest.author,
              message: `${user.username} a demandé "${title}" de ${author}.`
            })
          )
        );
      } else {
        console.log('Aucun admin trouvé, notifications ignorées');
      }
    } catch (emailError) {
      console.error('Erreur lors de l\'envoi des notifications aux admins:', emailError);
    }

    res.status(201).json(newRequest);
  } catch (error) {
    console.error('Erreur lors de la création de la demande:', error);
    res.status(500).json({ error: 'Erreur lors de la création de la demande' });
  }
};

// Récupération des demandes de l'utilisateur connecté
export const getUserRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const query = { user: req.user.id };
    
    if (status) {
      query.status = status;
    }
    
    const requests = await BookRequest.find(query).sort({ createdAt: -1 });
    res.json(requests);
  } catch (error) {
    console.error('Erreur lors de la récupération des demandes:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des demandes' });
  }
};

// Récupération de toutes les demandes (admin uniquement)
export const getAllRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const query = {};
    
    // Ne pas filtrer par statut si 'all' est sélectionné
    if (status && status !== 'all') {
      query.status = status;
    }
    
    const requests = await BookRequest.find(query).sort({ createdAt: -1 });
    res.json(requests);
  } catch (error) {
    console.error('Erreur lors de la récupération des demandes:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des demandes' });
  }
};

// Mise à jour du statut d'une demande
export const updateRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    if (!['pending', 'completed', 'canceled', 'reported'].includes(status)) {
      return res.status(400).json({ error: 'Statut invalide' });
    }

    // Récupérer la demande courante pour connaître son statut précédent
    const currentRequest = await BookRequest.findById(id);
    if (!currentRequest) {
      return res.status(404).json({ error: 'Demande non trouvée' });
    }
    const previousStatus = currentRequest.status;

    const updateFields = { status };
    if (status === 'canceled') {
      updateFields['notifications.canceled.seen'] = false;
      if (reason) {
        updateFields.cancelReason = reason;
        updateFields.canceledAt = new Date();
        try {
          const requestWithUser = await BookRequest.findById(id).populate('user', 'email username notificationPreferences');
          if (requestWithUser?.user?.email) {
            await sendRequestCanceledEmail(requestWithUser.user, {
              ...requestWithUser.toObject(),
              cancelReason: reason
            });
          }
        } catch (emailError) {
          console.error('Erreur lors de l\'envoi de l\'email d\'annulation:', emailError);
        }
      }
      // Push notification annulation
      sendPushToUser(currentRequest.user, {
        title: '❌ Demande annulée',
        body: `Votre demande "${currentRequest.title}" a été annulée.`,
        url: '/dashboard'
      }).catch(() => {});
      appriseService.notifyBookCanceled(currentRequest, reason).catch(() => {});
      // Notif Apprise personnelle de l'user
      User.findById(currentRequest.user).select('username notificationPreferences').then(u => {
        if (u) appriseService.notifyUserBookCanceled(u, currentRequest, reason).catch(() => {});
      }).catch(() => {});
    } else {
      updateFields.cancelReason = undefined;
    }
    if (status === 'completed') {
      updateFields.completedAt = new Date();
      if (previousStatus === 'reported') {
        // Signalement résolu : notif standalone au lieu de re-notifier "disponible"
        try {
          await Notification.create({
            user: currentRequest.user,
            type: 'resolved',
            title: currentRequest.title,
            author: currentRequest.author,
            message: `Votre signalement sur "${currentRequest.title}" a été examiné et résolu.`
          });
        } catch (notifError) {
          console.error('Erreur lors de la création de la notification de résolution:', notifError);
        }
        // Push notification résolution signalement
        sendPushToUser(currentRequest.user, {
          title: '✔️ Signalement résolu',
          body: `Votre signalement sur "${currentRequest.title}" a été examiné et résolu.`,
          url: '/dashboard'
        }).catch(() => {});
      } else {
        updateFields['notifications.completed.seen'] = false;
        // Push notification livre disponible
        sendPushToUser(currentRequest.user, {
          title: '✅ Livre disponible !',
          body: `"${currentRequest.title}" est prêt au téléchargement.`,
          url: '/dashboard'
        }).catch(() => {});
        appriseService.notifyBookCompleted(currentRequest).catch(() => {});
        // Notif Apprise personnelle de l'user
        User.findById(currentRequest.user).select('username notificationPreferences').then(u => {
          if (u) appriseService.notifyUserBookCompleted(u, currentRequest).catch(() => {});
        }).catch(() => {});
      }
    }

    const adminUser = await User.findById(req.user.id).select('username');
    updateFields.$push = {
      statusHistory: {
        status,
        changedBy: adminUser?.username || 'admin',
        note: reason || ''
      }
    };

    const request = await BookRequest.findByIdAndUpdate(
      id,
      updateFields,
      { new: true }
    );

    if (!request) {
      return res.status(404).json({ error: 'Demande non trouvée' });
    }

    // Log admin
    const actionMap = {
      canceled: 'cancel',
      completed: previousStatus === 'reported' ? 'resolve_report' : 'complete',
    };
    const logAction = actionMap[status] || 'status_change';
    await logAdminAction(req.user.id, adminUser?.username || 'admin', logAction, request,
      reason ? `Raison : ${reason}` : status);

    res.json(request);
  } catch (error) {
    console.error('Erreur lors de la mise à jour du statut:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du statut' });
  }
};

export const downloadEbook = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await BookRequest.findById(id);
    
    if (!request) {
      return res.status(404).json({ error: 'Demande non trouvée' });
    }
    
    // Vérifier si c'est un fichier local ou un lien externe
    if (request.filePath) {
      // Téléchargement d'un fichier local
      const filePath = path.join(__dirname, '../../uploads', request.filePath);
      
      // Vérifier que le fichier existe
      if (!fs.existsSync(filePath)) {
        console.error(`Fichier introuvable: ${filePath}`);
        return res.status(404).json({ 
          error: 'Fichier introuvable sur le serveur',
          details: `Le fichier ${request.filePath} n'existe pas dans le répertoire de téléchargement`
        });
      }
      
      // Mettre à jour la date de téléchargement
      request.downloadedAt = new Date();
      await request.save();
      
      // Définir les en-têtes pour le téléchargement
      const fileName = path.basename(filePath);
      res.download(filePath, fileName, (err) => {
        if (err) {
          console.error('Erreur lors de l\'envoi du fichier:', err);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Erreur lors de l\'envoi du fichier' });
          }
        }
      });
      
    } else if (request.downloadLink) {
      // Redirection vers un lien externe
      request.downloadedAt = new Date();
      await request.save();
      return res.redirect(request.downloadLink);
      
    } else {
      return res.status(404).json({ 
        error: 'Aucun contenu de téléchargement disponible pour cette demande' 
      });
    }
    
  } catch (error) {
    console.error('Erreur lors du téléchargement du fichier:', error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Erreur lors du téléchargement du fichier',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
};

// Ajout d'un lien de téléchargement ou d'un fichier à une demande
export const addDownloadLink = async (req, res) => {
  try {
    const { id } = req.params;
    const { downloadLink, existingFilePath } = req.body;
    const file = req.file; // Fichier téléversé via multer

    const updateData = {
      status: 'completed',
      completedAt: new Date()
    };

    // Si un fichier a été téléversé
    if (file) {
      updateData.filePath = `books/${file.filename}`;
      updateData.downloadLink = ''; // Effacer l'ancien lien s'il existe
      console.log(`Fichier téléversé: ${file.filename}`);
    }
    // Si un fichier existant a été sélectionné
    else if (existingFilePath) {
      const safePath = path.basename(existingFilePath);
      updateData.filePath = `books/${safePath}`;
      updateData.downloadLink = '';
      console.log(`Fichier existant sélectionné: ${safePath}`);
    }
    // Sinon, vérifier le lien
    else if (downloadLink) {
      try {
        const url = new URL(downloadLink);
        if (!/^https?:/.test(url.protocol)) {
          return res.status(400).json({ error: 'Le lien doit commencer par http:// ou https://' });
        }
        updateData.downloadLink = downloadLink;
        updateData.filePath = ''; // Effacer l'ancien fichier s'il existe
        console.log(`Lien de téléchargement ajouté: ${downloadLink}`);
      } catch (error) {
        return res.status(400).json({ error: "Le lien fourni n'est pas une URL valide" });
      }
    } else {
      return res.status(400).json({ error: "Un lien de téléchargement ou un fichier est requis" });
    }
    
    const adminUser = await User.findById(req.user.id).select('username');
    updateData.$push = {
      statusHistory: { status: 'completed', changedBy: adminUser?.username || 'admin', note: 'Livre disponible' }
    };

    const request = await BookRequest.findByIdAndUpdate(id, updateData, { new: true });

    if (!request) {
      return res.status(404).json({ error: 'Demande non trouvée' });
    }

    // Récupérer l'utilisateur pour l'email
    const user = await User.findById(request.user);
    if (user) {
      try {
        // Construire l'URL de téléchargement
        let downloadUrl = '';

        if (updateData.filePath) {
          downloadUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/api/requests/download/${request._id}`;
        } else if (updateData.downloadLink) {
          downloadUrl = updateData.downloadLink;
        }

        // Envoyer l'email de notification
        await sendBookCompletedEmail(user, {
          ...request.toObject(),
          downloadLink: downloadUrl
        });
      } catch (emailError) {
        console.error('Erreur lors de l\'envoi de l\'email de notification:', emailError);
      }

      // Web push — livre disponible
      sendPushToUser(request.user, {
        title: '✅ Livre disponible !',
        body: `"${request.title}" est prêt au téléchargement.`,
        url: '/dashboard'
      }).catch(() => {});

      // Apprise personnel de l'user
      appriseService.notifyUserBookCompleted(user, request).catch(() => {});
    }

    // Apprise admin global (indépendant de l'existence de l'user)
    appriseService.notifyBookCompleted(request).catch(() => {});

    // Post-completion hooks (non-blocking) — only if file is present
    if (request.filePath) {
      runPostCompletionHooks(request, request.user).catch(e => console.error('[Calibre]', e.message));
    }

    res.json(request);
  } catch (error) {
    console.error('Erreur lors de l\'ajout du lien de téléchargement:', error);
    res.status(500).json({ 
      error: 'Erreur lors de l\'ajout du lien de téléchargement',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Suppression d'une demande
export const deleteRequest = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Vérifier d'abord si la demande existe et si l'utilisateur a les droits
    const request = await BookRequest.findById(id);
    if (!request) {
      return res.status(404).json({ error: 'Demande non trouvée.' });
    }

    // Vérifier que l'utilisateur est le propriétaire de la demande ou un administrateur
    if (request.user.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Non autorisé.' });
    }

    // Un utilisateur non-admin ne peut supprimer que ses demandes en attente ou annulées
    if (req.user.role !== 'admin' && !['pending', 'canceled'].includes(request.status)) {
      return res.status(403).json({ error: 'Vous ne pouvez supprimer que vos demandes en attente ou annulées.' });
    }

    // Créer une notification pour l'utilisateur avant suppression
    if (req.user.role === 'admin' && request.user.toString() !== req.user.id.toString()) {
      try {
        await Notification.create({
          user: request.user,
          type: 'deleted',
          title: request.title,
          author: request.author,
          message: `Votre demande pour "${request.title}" a été supprimée par un administrateur.`
        });
      } catch (notifError) {
        console.error('Erreur lors de la création de la notification de suppression:', notifError);
      }
      // Push notification suppression
      sendPushToUser(request.user, {
        title: '🗑️ Demande supprimée',
        body: `Votre demande "${request.title}" a été supprimée par un administrateur.`,
        url: '/dashboard'
      }).catch(() => {});
    }

    // Log avant suppression
    const adminUser = await User.findById(req.user.id).select('username');
    await logAdminAction(req.user.id, adminUser?.username || 'admin', 'delete', request);

    // Supprimer la demande
    await BookRequest.findByIdAndDelete(id);

    res.json({ message: 'Demande supprimée avec succès.' });
  } catch (error) {
    console.error('Erreur lors de la suppression de la demande:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la suppression de la demande.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Marquer une demande comme téléchargée
export const markAsDownloaded = async (req, res) => {
  try {
    const request = await BookRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({ error: 'Demande non trouvée.' });
    }

    // Vérifier que l'utilisateur est le propriétaire de la demande ou un administrateur
    if (request.user.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Non autorisé.' });
    }

    // Mettre à jour la date de téléchargement
    request.downloadedAt = new Date();
    await request.save();

    res.json({
      success: true,
      downloadedAt: request.downloadedAt,
      message: 'Téléchargement enregistré avec succès.'
    });
  } catch (error) {
    console.error('Erreur lors du marquage comme téléchargé:', error);
    res.status(500).json({ error: 'Erreur lors du marquage comme téléchargé.' });
  }
};

// Commentaire admin sur une demande
export const updateAdminComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = req.body;

    const updateData = { adminComment: comment ?? '' };
    if (comment?.trim()) {
      updateData['notifications.adminComment.seen'] = false;
      updateData['notifications.adminComment.seenAt'] = null;
    }

    const request = await BookRequest.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );

    if (!request) {
      return res.status(404).json({ error: 'Demande non trouvée.' });
    }

    // Push notification commentaire admin
    if (comment?.trim()) {
      sendPushToUser(request.user, {
        title: '💬 Nouveau commentaire',
        body: `Un admin a commenté votre demande "${request.title}".`,
        url: '/dashboard'
      }).catch(() => {});
    }

    // Notifier l'utilisateur par email + Apprise si un commentaire est défini
    if (comment?.trim()) {
      try {
        const user = await User.findById(request.user);
        if (user) {
          await sendAdminCommentEmail(user, request, comment);
          appriseService.notifyUserAdminComment(user, request, comment).catch(() => {});
        }
      } catch (emailError) {
        console.error('Erreur lors de l\'envoi de l\'email de commentaire:', emailError);
      }
    }

    // Log admin
    if (comment?.trim()) {
      const adminUser = await User.findById(req.user.id).select('username');
      await logAdminAction(req.user.id, adminUser?.username || 'admin', 'comment', request,
        comment.substring(0, 100));
    }

    res.json(request);
  } catch (error) {
    console.error('Erreur lors de la mise à jour du commentaire:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du commentaire.' });
  }
};

// Commentaire utilisateur sur sa propre demande
export const updateUserComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = req.body;

    const request = await BookRequest.findOne({ _id: id, user: req.user.id });
    if (!request) return res.status(404).json({ error: 'Demande non trouvée.' });

    request.userComment = comment ?? '';
    await request.save();

    if (comment?.trim()) {
      appriseService.notifyUserComment(request, comment).catch(() => {});
    }

    res.json({ success: true, userComment: request.userComment });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la mise à jour du commentaire.' });
  }
};

// Modifier une demande par son propriétaire (seulement si en attente)
export const editUserRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, author, format, link, description, thumbnail, pageCount } = req.body;

    if (!title?.trim() || !author?.trim()) {
      return res.status(400).json({ error: 'Le titre et l\'auteur sont obligatoires.' });
    }

    const request = await BookRequest.findOne({ _id: id, user: req.user.id });
    if (!request) return res.status(404).json({ error: 'Demande non trouvée.' });

    if (request.status !== 'pending') {
      return res.status(403).json({ error: 'Seules les demandes en attente peuvent être modifiées.' });
    }

    const updates = { title: title.trim(), author: author.trim() };
    if (format !== undefined) updates.format = format;
    // link est required dans le schema — ne l'écraser que si une valeur non vide est fournie
    if (link?.trim()) updates.link = link.trim();
    if (description !== undefined) updates.description = description;
    if (thumbnail !== undefined) updates.thumbnail = thumbnail;
    if (pageCount !== undefined) updates.pageCount = pageCount;

    const updated = await BookRequest.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    res.json({ success: true, request: updated });
  } catch (error) {
    console.error('editUserRequest error:', error.message);
    res.status(500).json({ error: 'Erreur lors de la modification de la demande.', details: error.message });
  }
};

// Quota de demandes de l'utilisateur connecté
export const getRequestQuota = async (req, res) => {
  try {
    const requester = await User.findById(req.user.id);
    if (!requester) {
      return res.status(404).json({ error: 'Utilisateur non trouvé.' });
    }

    // Admin peut consulter le quota d'un autre user
    let user = requester;
    if (requester.role === 'admin' && req.query.userId && req.query.userId !== requester._id.toString()) {
      const target = await User.findById(req.query.userId);
      if (!target) return res.status(404).json({ error: 'Utilisateur cible introuvable.' });
      user = target;
    }

    const days = user.requestLimitDays ?? 30;
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - days);
    const used = await BookRequest.countDocuments({
      user: user._id,
      createdAt: { $gte: windowStart }
    });

    const limit = user.requestLimit ?? 10;
    res.json({ limit, used, remaining: Math.max(0, limit - used), days });
  } catch (error) {
    console.error('Erreur lors de la récupération du quota:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération du quota.' });
  }
};

// Signaler un problème sur une demande complétée
export const reportRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ error: 'Une raison de signalement est requise.' });
    }

    const request = await BookRequest.findById(id);

    if (!request) {
      return res.status(404).json({ error: 'Demande non trouvée.' });
    }

    // Vérifier que l'utilisateur est le propriétaire de la demande
    if (request.user.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Vous ne pouvez signaler que vos propres demandes.' });
    }

    // Vérifier que la demande est complétée
    if (request.status !== 'completed') {
      return res.status(400).json({ error: 'Seules les demandes complétées peuvent être signalées.' });
    }

    // Mettre à jour le statut et ajouter la raison
    request.status = 'reported';
    request.reportedAt = new Date();
    request.reportReason = reason;
    request.reportSeenByAdmin = false;

    await request.save();

    appriseService.notifyReport(request, reason).catch(() => {});

    res.json({
      success: true,
      message: 'Signalement envoyé avec succès. Un administrateur va examiner le problème.',
      request
    });
  } catch (error) {
    console.error('Erreur lors du signalement:', error);
    res.status(500).json({ error: 'Erreur lors du signalement de la demande.' });
  }
};