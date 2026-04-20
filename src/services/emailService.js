import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import EmailLog from '../models/EmailLog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// ─── Provider selection ───────────────────────────────────────────────────────
const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER || 'smtp').toLowerCase();
const USE_RESEND = EMAIL_PROVIDER === 'resend';

// ─── SMTP setup ───────────────────────────────────────────────────────────────
let smtpTransporter = null;

if (!USE_RESEND) {
  const requiredSmtp = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME', 'FRONTEND_URL'];
  const missingSmtp = requiredSmtp.filter(v => !process.env[v]);
  if (missingSmtp.length > 0) {
    console.error('Variables SMTP manquantes:', missingSmtp);
  }

  smtpTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 465,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    tls: { rejectUnauthorized: false },
  });

  smtpTransporter.verify(err => {
    if (err) console.error('Erreur connexion SMTP:', err.message);
    else     console.log('SMTP prêt');
  });
}

// ─── Resend setup ─────────────────────────────────────────────────────────────
let resendClient = null;

if (USE_RESEND) {
  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY manquante — les emails ne seront pas envoyés.');
  } else {
    resendClient = new Resend(process.env.RESEND_API_KEY);
    console.log('Resend initialisé');
  }
}

const FROM = `"${process.env.EMAIL_FROM_NAME || 'EbookRequest'}" <${process.env.EMAIL_FROM_ADDRESS || 'noreply@example.com'}>`;

// ─── Core send function ───────────────────────────────────────────────────────

/**
 * Envoie un email via SMTP ou Resend et enregistre dans EmailLog.
 * @returns {Promise<EmailLog>} le document de log créé
 */
async function sendEmail({ to, subject, html, type }) {
  const log = await EmailLog.create({
    provider: USE_RESEND ? 'resend' : 'smtp',
    to,
    subject,
    type,
    status: 'sent',
    events: [{ type: 'sent', timestamp: new Date() }],
  });

  try {
    if (USE_RESEND && resendClient) {
      const { data, error } = await resendClient.emails.send({
        from: FROM,
        to,
        subject,
        html,
      });

      if (error) throw new Error(error.message || 'Resend error');

      // Stocker l'ID Resend pour le suivi webhook
      await EmailLog.updateOne({ _id: log._id }, { $set: { emailId: data.id } });
      log.emailId = data.id;

    } else if (smtpTransporter) {
      await smtpTransporter.sendMail({ from: FROM, to, subject, html });
    } else {
      throw new Error('Aucun provider email configuré.');
    }
  } catch (err) {
    console.error(`[emailService] Erreur envoi à ${to}:`, err.message);
    await EmailLog.updateOne({ _id: log._id }, {
      $set: { status: 'failed', error: err.message },
      $push: { events: { type: 'failed', timestamp: new Date(), data: { message: err.message } } },
    });
    throw err;
  }

  return log;
}

// ─── Helper ───────────────────────────────────────────────────────────────────
function escapeHtml(text) {
  if (!text) return '';
  return String(text).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const sendVerificationEmail = async (email, token, username = 'Utilisateur') => {
  const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${token}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
      <h2>Bonjour ${escapeHtml(username)},</h2>
      <p>Merci d'avoir ajouté votre adresse email. Pour finaliser cet ajout, veuillez vérifier votre adresse email en cliquant sur le bouton ci-dessous :</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${verificationUrl}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
          Vérifier mon email
        </a>
      </div>
      <p>Si le bouton ne fonctionne pas, copiez ce lien : ${verificationUrl}</p>
      <p>Ce lien expirera dans 24 heures.</p>
      <p>À bientôt,<br>L'équipe EbookRequest</p>
      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #757575;">
        <p>Cet email a été envoyé automatiquement. Merci de ne pas y répondre.</p>
      </div>
    </div>`;
  return sendEmail({ to: email, subject: 'Vérifiez votre adresse email', html, type: 'verification' });
};

export const sendPasswordResetEmail = async (email, username, token) => {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${token}`;
  const html = `
<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; border-radius: 16px; overflow: hidden; border: 1px solid #1e293b;">
  <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 2.5rem 2rem; text-align: center;">
    <img src="${process.env.FRONTEND_URL}/img/logo.png" alt="EbookRequest" style="height: 52px; margin-bottom: 1rem;" />
    <h1 style="color: white; margin: 0 0 0.5rem; font-size: 1.5rem; font-weight: 700;">Réinitialisation du mot de passe</h1>
    <p style="color: rgba(255,255,255,0.75); margin: 0; font-size: 0.9rem;">Une demande a été effectuée pour votre compte</p>
  </div>
  <div style="padding: 2rem;">
    <p style="color: #cbd5e1; font-size: 0.95rem; line-height: 1.7; margin: 0 0 1rem;">
      Bonjour <strong style="color: #e2e8f0;">${escapeHtml(username)}</strong>,
    </p>
    <p style="color: #94a3b8; font-size: 0.9rem; line-height: 1.7; margin: 0 0 1.5rem;">
      Nous avons reçu une demande de réinitialisation du mot de passe pour votre compte EbookRequest.
      Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.
    </p>
    <div style="text-align: center; margin: 2rem 0;">
      <a href="${resetUrl}" style="display: inline-block; padding: 0.9rem 2.25rem; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 1rem;">
        🔑 Réinitialiser mon mot de passe
      </a>
    </div>
    <div style="background: #1e293b; border-radius: 10px; padding: 1rem 1.25rem; margin: 1.5rem 0;">
      <p style="color: #f59e0b; font-size: 0.82rem; margin: 0 0 0.4rem; font-weight: 600;">⏱ Ce lien expire dans 1 heure</p>
      <p style="color: #64748b; font-size: 0.8rem; margin: 0; word-break: break-all;">${resetUrl}</p>
    </div>
    <p style="color: #64748b; font-size: 0.82rem; line-height: 1.6; margin: 0;">
      Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email. Votre mot de passe restera inchangé.
    </p>
  </div>
  <div style="background: #0a0f1e; padding: 1.25rem 2rem; text-align: center; border-top: 1px solid #1e293b;">
    <p style="color: #475569; font-size: 0.78rem; margin: 0; line-height: 1.6;">
      © EbookRequest • <a href="${process.env.FRONTEND_URL}" style="color: #6366f1; text-decoration: none;">Accéder au site</a><br>
      Cet email a été envoyé automatiquement, merci de ne pas y répondre.
    </p>
  </div>
</div>`;
  return sendEmail({ to: email, subject: '🔑 Réinitialisation de votre mot de passe — EbookRequest', html, type: 'password_reset' });
};

export const sendPasswordChangedEmail = async (email, username = 'Utilisateur') => {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
      <h2 style="color: #4CAF50;">Mot de passe modifié avec succès</h2>
      <p>Bonjour ${escapeHtml(username)},</p>
      <p>Votre mot de passe a été modifié avec succès le ${new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}.</p>
      <p>Si vous n'êtes pas à l'origine de cette modification, veuillez nous contacter immédiatement.</p>
      <p>Cordialement,<br>L'équipe EbookRequest</p>
      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #757575;">
        <p>Cet email a été envoyé automatiquement. Merci de ne pas y répondre.</p>
      </div>
    </div>`;
  return sendEmail({ to: email, subject: 'Votre mot de passe a été modifié', html, type: 'password_changed' });
};

export const sendBookCompletedEmail = async (user, bookRequest) => {
  if (!user.notificationPreferences?.email?.enabled || !user.notificationPreferences?.email?.bookCompleted) return;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
      <h2>Bonjour ${escapeHtml(user.username)},</h2>
      <p>Votre demande pour le livre <strong>${escapeHtml(bookRequest.title)}</strong> par ${escapeHtml(bookRequest.author)} est maintenant terminée !</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${process.env.FRONTEND_URL}/dashboard" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
          Accéder au tableau de bord
        </a>
      </div>
      <p>À bientôt,<br>L'équipe EbookRequest</p>
      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #757575;">
        <p>Cet email a été envoyé automatiquement. Merci de ne pas y répondre.</p>
      </div>
    </div>`;
  return sendEmail({ to: user.email, subject: `Votre demande de livre est prête : ${bookRequest.title}`, html, type: 'book_completed' });
};

export const sendRequestCanceledEmail = async (user, bookRequest) => {
  if (!user?.email || !bookRequest) throw new Error('Paramètres manquants');
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
      <h2 style="color: #ef4444;">Demande annulée</h2>
      <p>Bonjour ${escapeHtml(user.username || 'Utilisateur')},</p>
      <p>Nous vous informons que votre demande pour le livre <strong>${escapeHtml(bookRequest.title)}</strong> a été annulée.</p>
      ${bookRequest.cancelReason ? `
        <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 12px; margin: 16px 0; border-radius: 4px;">
          <p style="margin: 0; font-weight: 500; color: #b91c1c;">Raison :</p>
          <p style="margin: 8px 0 0 0;">${escapeHtml(bookRequest.cancelReason)}</p>
        </div>` : ''}
      <p>Cordialement,<br>L'équipe EbookRequest</p>
      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #757575;">
        <p>Cet email a été envoyé automatiquement. Merci de ne pas y répondre.</p>
      </div>
    </div>`;
  return sendEmail({ to: user.email, subject: `Votre demande pour "${bookRequest.title}" a été annulée`, html, type: 'book_canceled' });
};

export const sendAdminCommentEmail = async (user, bookRequest, comment) => {
  if (!user?.email || !user?.emailVerified) return;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
      <h2 style="color: #6366f1;">💬 Note de l'administrateur</h2>
      <p>Bonjour ${escapeHtml(user.username || 'Utilisateur')},</p>
      <p>Un administrateur a laissé une note sur votre demande pour le livre <strong>${escapeHtml(bookRequest.title)}</strong> par ${escapeHtml(bookRequest.author)}.</p>
      <div style="background-color: #eef2ff; border-left: 4px solid #6366f1; padding: 12px; margin: 16px 0; border-radius: 4px;">
        <p style="margin: 0; font-weight: 500; color: #4338ca;">Note :</p>
        <p style="margin: 8px 0 0 0; color: #1e1b4b;">${escapeHtml(comment)}</p>
      </div>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${process.env.FRONTEND_URL}/dashboard" style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
          Voir mes demandes
        </a>
      </div>
      <p>Cordialement,<br>L'équipe EbookRequest</p>
      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #757575;">
        <p>Cet email a été envoyé automatiquement. Merci de ne pas y répondre.</p>
      </div>
    </div>`;
  return sendEmail({ to: user.email, subject: `Note de l'administrateur sur votre demande : ${bookRequest.title}`, html, type: 'admin_comment' });
};

export const sendNewRequestToAdminsEmail = async (admin, bookRequest, requesterUsername) => {
  if (!admin?.email || !admin?.emailVerified) return;
  const adminPanelUrl = `${process.env.FRONTEND_URL}/admin`;
  const requestDate = new Date(bookRequest.createdAt).toLocaleString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const safeTitle = escapeHtml(bookRequest.title);
  const safeAuthor = escapeHtml(bookRequest.author);
  const safeUsername = escapeHtml(requesterUsername);
  const safeDescription = bookRequest.description ? escapeHtml(bookRequest.description.substring(0, 300)) : '';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
      <h2 style="color: #4CAF50;">📚 Nouvelle demande de livre</h2>
      <p>Bonjour ${escapeHtml(admin.username)},</p>
      <p>Une nouvelle demande de livre a été soumise par <strong>${safeUsername}</strong>.</p>
      ${bookRequest.thumbnail ? `<div style="text-align: center; margin: 20px 0;"><img src="${escapeHtml(bookRequest.thumbnail)}" alt="${safeTitle}" style="max-width: 150px; border-radius: 4px;"></div>` : ''}
      <div style="background-color: #f5f5f5; padding: 15px; border-radius: 4px; margin: 20px 0;">
        <p style="margin: 5px 0;"><strong>Titre :</strong> ${safeTitle}</p>
        <p style="margin: 5px 0;"><strong>Auteur :</strong> ${safeAuthor}</p>
        <p style="margin: 5px 0;"><strong>Demandé par :</strong> ${safeUsername}</p>
        <p style="margin: 5px 0;"><strong>Date :</strong> ${requestDate}</p>
        ${bookRequest.link ? `<p style="margin: 5px 0;"><strong>Lien :</strong> <a href="${escapeHtml(bookRequest.link)}">${escapeHtml(bookRequest.link)}</a></p>` : ''}
      </div>
      ${safeDescription ? `<p><strong>Description :</strong></p><p style="color: #666; font-size: 14px;">${safeDescription}${bookRequest.description.length > 300 ? '…' : ''}</p>` : ''}
      <div style="text-align: center; margin: 30px 0;">
        <a href="${adminPanelUrl}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
          Accéder au panneau admin
        </a>
      </div>
      <p>Cordialement,<br>Système EbookRequest</p>
      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #757575;">
        <p>Cet email a été envoyé automatiquement. Merci de ne pas y répondre.</p>
      </div>
    </div>`;
  try {
    return await sendEmail({ to: admin.email, subject: `Nouvelle demande de livre : ${safeTitle}`, html, type: 'new_request' });
  } catch {
    // Ne pas bloquer la création de demande si l'email admin échoue
  }
};

export const sendBroadcastEmail = async (to, subject, htmlContent) => {
  const html = htmlContent.replace(/\{\{FRONTEND_URL\}\}/g, process.env.FRONTEND_URL || '');
  return sendEmail({ to, subject, html, type: 'broadcast' });
};
