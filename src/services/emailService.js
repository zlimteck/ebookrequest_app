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

// ─── Template helper ──────────────────────────────────────────────────────────
const FRONTEND = () => process.env.FRONTEND_URL || '';
const LOGO = () => `<img src="${FRONTEND()}/img/logo.png" alt="EbookRequest" style="height:48px;margin-bottom:0.75rem;" />`;
const FOOTER = () => `
  <div style="background:#0a0f1e;padding:1.25rem 2rem;text-align:center;border-top:1px solid #1e293b;">
    <p style="color:#475569;font-size:0.78rem;margin:0;line-height:1.6;">
      © EbookRequest • <a href="${FRONTEND()}" style="color:#6366f1;text-decoration:none;">Accéder au site</a><br>
      Cet email a été envoyé automatiquement, merci de ne pas y répondre.
    </p>
  </div>`;

function darkEmail({ gradient, title, subtitle, body }) {
  return `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;border:1px solid #1e293b;">
  <div style="background:${gradient};padding:2.5rem 2rem;text-align:center;">
    ${LOGO()}
    <h1 style="color:white;margin:0 0 0.5rem;font-size:1.4rem;font-weight:700;">${title}</h1>
    ${subtitle ? `<p style="color:rgba(255,255,255,0.75);margin:0;font-size:0.9rem;">${subtitle}</p>` : ''}
  </div>
  <div style="padding:2rem;">${body}</div>
  ${FOOTER()}
</div>`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const sendVerificationEmail = async (email, token, username = 'Utilisateur') => {
  const verificationUrl = `${FRONTEND()}/verify-email/${token}`;
  const html = darkEmail({
    gradient: 'linear-gradient(135deg,#059669 0%,#0891b2 100%)',
    title: 'Vérification de votre adresse email',
    subtitle: 'Finalisez l\'ajout de votre email',
    body: `
      <p style="color:#cbd5e1;font-size:0.95rem;line-height:1.7;margin:0 0 1rem;">Bonjour <strong style="color:#e2e8f0;">${escapeHtml(username)}</strong>,</p>
      <p style="color:#94a3b8;font-size:0.9rem;line-height:1.7;margin:0 0 1.5rem;">Merci d'avoir ajouté votre adresse email. Cliquez sur le bouton ci-dessous pour la vérifier.</p>
      <div style="text-align:center;margin:2rem 0;">
        <a href="${verificationUrl}" style="display:inline-block;padding:0.9rem 2.25rem;background:linear-gradient(135deg,#059669,#0891b2);color:white;text-decoration:none;border-radius:10px;font-weight:700;font-size:1rem;">
          ✉️ Vérifier mon email
        </a>
      </div>
      <div style="background:#1e293b;border-radius:10px;padding:1rem 1.25rem;margin:1.5rem 0;">
        <p style="color:#f59e0b;font-size:0.82rem;margin:0 0 0.4rem;font-weight:600;">⏱ Ce lien expire dans 24 heures</p>
        <p style="color:#64748b;font-size:0.8rem;margin:0;word-break:break-all;">${verificationUrl}</p>
      </div>`,
  });
  return sendEmail({ to: email, subject: 'Vérifiez votre adresse email — EbookRequest', html, type: 'verification' });
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
  const html = darkEmail({
    gradient: 'linear-gradient(135deg,#059669 0%,#10b981 100%)',
    title: 'Mot de passe modifié',
    subtitle: 'Votre mot de passe a été mis à jour',
    body: `
      <p style="color:#cbd5e1;font-size:0.95rem;line-height:1.7;margin:0 0 1rem;">Bonjour <strong style="color:#e2e8f0;">${escapeHtml(username)}</strong>,</p>
      <p style="color:#94a3b8;font-size:0.9rem;line-height:1.7;margin:0 0 1.5rem;">
        Votre mot de passe a été modifié avec succès le ${new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}.
      </p>
      <div style="background:rgba(239,68,68,0.08);border-left:3px solid #ef4444;border-radius:6px;padding:1rem 1.25rem;margin:1.5rem 0;">
        <p style="color:#ef4444;font-size:0.82rem;font-weight:600;margin:0 0 0.35rem;">Vous n'êtes pas à l'origine de cette action ?</p>
        <p style="color:#94a3b8;font-size:0.82rem;margin:0;line-height:1.6;">Contactez l'administrateur immédiatement.</p>
      </div>`,
  });
  return sendEmail({ to: email, subject: 'Votre mot de passe a été modifié — EbookRequest', html, type: 'password_changed' });
};

export const sendBookCompletedEmail = async (user, bookRequest) => {
  if (!user.notificationPreferences?.email?.enabled || !user.notificationPreferences?.email?.bookCompleted) return;
  const html = darkEmail({
    gradient: 'linear-gradient(135deg,#059669 0%,#0891b2 100%)',
    title: '📚 Votre livre est disponible !',
    subtitle: 'Votre demande a été traitée',
    body: `
      <p style="color:#cbd5e1;font-size:0.95rem;line-height:1.7;margin:0 0 1rem;">Bonjour <strong style="color:#e2e8f0;">${escapeHtml(user.username)}</strong>,</p>
      <p style="color:#94a3b8;font-size:0.9rem;line-height:1.7;margin:0 0 1.5rem;">Votre demande pour le livre ci-dessous est maintenant disponible au téléchargement.</p>
      <div style="background:#1e293b;border-radius:10px;padding:1.25rem 1.5rem;margin:1.5rem 0;">
        <p style="color:#e2e8f0;font-size:1rem;font-weight:700;margin:0 0 0.25rem;">${escapeHtml(bookRequest.title)}</p>
        <p style="color:#94a3b8;font-size:0.87rem;margin:0;">par ${escapeHtml(bookRequest.author)}</p>
      </div>
      <div style="text-align:center;margin:2rem 0;">
        <a href="${FRONTEND()}/dashboard" style="display:inline-block;padding:0.9rem 2.25rem;background:linear-gradient(135deg,#059669,#0891b2);color:white;text-decoration:none;border-radius:10px;font-weight:700;font-size:1rem;">
          Télécharger mon livre
        </a>
      </div>`,
  });
  return sendEmail({ to: user.email, subject: `📚 Votre livre est disponible : ${bookRequest.title}`, html, type: 'book_completed' });
};

export const sendRequestCanceledEmail = async (user, bookRequest) => {
  if (!user?.email || !bookRequest) throw new Error('Paramètres manquants');
  const html = darkEmail({
    gradient: 'linear-gradient(135deg,#dc2626 0%,#9f1239 100%)',
    title: 'Demande annulée',
    subtitle: 'Votre demande n\'a pas pu être traitée',
    body: `
      <p style="color:#cbd5e1;font-size:0.95rem;line-height:1.7;margin:0 0 1rem;">Bonjour <strong style="color:#e2e8f0;">${escapeHtml(user.username || 'Utilisateur')}</strong>,</p>
      <p style="color:#94a3b8;font-size:0.9rem;line-height:1.7;margin:0 0 1.5rem;">Nous vous informons que votre demande a été annulée.</p>
      <div style="background:#1e293b;border-radius:10px;padding:1.25rem 1.5rem;margin:1.5rem 0;">
        <p style="color:#e2e8f0;font-size:1rem;font-weight:700;margin:0 0 0.25rem;">${escapeHtml(bookRequest.title)}</p>
        <p style="color:#94a3b8;font-size:0.87rem;margin:0;">par ${escapeHtml(bookRequest.author)}</p>
      </div>
      ${bookRequest.cancelReason ? `
      <div style="background:rgba(239,68,68,0.08);border-left:3px solid #ef4444;border-radius:6px;padding:1rem 1.25rem;margin:1.5rem 0;">
        <p style="color:#ef4444;font-size:0.82rem;font-weight:600;margin:0 0 0.35rem;">Motif</p>
        <p style="color:#94a3b8;font-size:0.87rem;margin:0;line-height:1.6;">${escapeHtml(bookRequest.cancelReason)}</p>
      </div>` : ''}
      <p style="color:#64748b;font-size:0.82rem;line-height:1.6;margin:1.5rem 0 0;">Vous pouvez soumettre une nouvelle demande depuis votre tableau de bord si vous le souhaitez.</p>`,
  });
  return sendEmail({ to: user.email, subject: `Demande annulée : ${bookRequest.title}`, html, type: 'book_canceled' });
};

export const sendAdminCommentEmail = async (user, bookRequest, comment) => {
  if (!user?.email || !user?.emailVerified) return;
  const html = darkEmail({
    gradient: 'linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%)',
    title: '💬 Note de l\'administrateur',
    subtitle: `Concernant votre demande`,
    body: `
      <p style="color:#cbd5e1;font-size:0.95rem;line-height:1.7;margin:0 0 1rem;">Bonjour <strong style="color:#e2e8f0;">${escapeHtml(user.username || 'Utilisateur')}</strong>,</p>
      <p style="color:#94a3b8;font-size:0.9rem;line-height:1.7;margin:0 0 1.5rem;">Un administrateur a laissé une note sur votre demande.</p>
      <div style="background:#1e293b;border-radius:10px;padding:1.25rem 1.5rem;margin:0 0 1.25rem;">
        <p style="color:#e2e8f0;font-size:1rem;font-weight:700;margin:0 0 0.25rem;">${escapeHtml(bookRequest.title)}</p>
        <p style="color:#94a3b8;font-size:0.87rem;margin:0;">par ${escapeHtml(bookRequest.author)}</p>
      </div>
      <div style="background:rgba(99,102,241,0.08);border-left:3px solid #6366f1;border-radius:6px;padding:1rem 1.25rem;margin:1.5rem 0;">
        <p style="color:#6366f1;font-size:0.82rem;font-weight:600;margin:0 0 0.35rem;">Note</p>
        <p style="color:#cbd5e1;font-size:0.9rem;margin:0;line-height:1.6;">${escapeHtml(comment)}</p>
      </div>
      <div style="text-align:center;margin:2rem 0;">
        <a href="${FRONTEND()}/dashboard" style="display:inline-block;padding:0.9rem 2.25rem;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;text-decoration:none;border-radius:10px;font-weight:700;font-size:1rem;">
          Voir mes demandes
        </a>
      </div>`,
  });
  return sendEmail({ to: user.email, subject: `Note admin sur votre demande : ${bookRequest.title}`, html, type: 'admin_comment' });
};

export const sendNewRequestToAdminsEmail = async (admin, bookRequest, requesterUsername) => {
  if (!admin?.email || !admin?.emailVerified) return;
  const safeTitle       = escapeHtml(bookRequest.title);
  const safeAuthor      = escapeHtml(bookRequest.author);
  const safeUsername    = escapeHtml(requesterUsername);
  const safeDescription = bookRequest.description ? escapeHtml(bookRequest.description.substring(0, 300)) : '';
  const requestDate     = new Date(bookRequest.createdAt).toLocaleString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const html = darkEmail({
    gradient: 'linear-gradient(135deg,#4f46e5 0%,#059669 100%)',
    title: '📚 Nouvelle demande de livre',
    subtitle: `Soumise par ${safeUsername}`,
    body: `
      <p style="color:#cbd5e1;font-size:0.95rem;line-height:1.7;margin:0 0 1.5rem;">Bonjour <strong style="color:#e2e8f0;">${escapeHtml(admin.username)}</strong>,</p>
      <div style="display:flex;gap:1rem;align-items:flex-start;background:#1e293b;border-radius:10px;padding:1.25rem 1.5rem;margin:0 0 1.25rem;">
        ${bookRequest.thumbnail ? `<img src="${escapeHtml(bookRequest.thumbnail)}" alt="${safeTitle}" style="width:64px;height:90px;object-fit:cover;border-radius:6px;flex-shrink:0;">` : ''}
        <div>
          <p style="color:#e2e8f0;font-size:1rem;font-weight:700;margin:0 0 0.25rem;">${safeTitle}</p>
          <p style="color:#94a3b8;font-size:0.87rem;margin:0 0 0.75rem;">par ${safeAuthor}</p>
          <p style="color:#64748b;font-size:0.78rem;margin:0;">Demandé par <strong style="color:#94a3b8;">${safeUsername}</strong> · ${requestDate}</p>
          ${bookRequest.link ? `<a href="${escapeHtml(bookRequest.link)}" style="color:#6366f1;font-size:0.78rem;text-decoration:none;">Voir le lien →</a>` : ''}
        </div>
      </div>
      ${safeDescription ? `<p style="color:#64748b;font-size:0.82rem;line-height:1.6;margin:0 0 1.5rem;">${safeDescription}${bookRequest.description.length > 300 ? '…' : ''}</p>` : ''}
      <div style="text-align:center;margin:2rem 0;">
        <a href="${FRONTEND()}/admin" style="display:inline-block;padding:0.9rem 2.25rem;background:linear-gradient(135deg,#4f46e5,#059669);color:white;text-decoration:none;border-radius:10px;font-weight:700;font-size:1rem;">
          Gérer les demandes
        </a>
      </div>`,
  });
  try {
    return await sendEmail({ to: admin.email, subject: `📚 Nouvelle demande : ${safeTitle}`, html, type: 'new_request' });
  } catch {
    // Ne pas bloquer la création de demande si l'email admin échoue
  }
};

export const sendBroadcastEmail = async (to, subject, htmlContent) => {
  const html = htmlContent.replace(/\{\{FRONTEND_URL\}\}/g, process.env.FRONTEND_URL || '');
  return sendEmail({ to, subject, html, type: 'broadcast' });
};