import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Obtenir le chemin du répertoire actuel
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Chemin vers le fichier .env dans le répertoire backend
const envPath = path.resolve(__dirname, '../../.env');

// Vérifier si le fichier .env existe
if (fs.existsSync(envPath)) {
  console.log(`Chargement des variables d'environnement depuis: ${envPath}`);
  dotenv.config({ path: envPath });
} else {
  console.error(`Fichier .env introuvable à l'emplacement: ${envPath}`);
  console.log('Utilisation des variables d\'environnement système');
}

// Vérification des variables d'environnement requises
const requiredEnvVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME', 'FRONTEND_URL'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('Variables d\'environnement manquantes pour le service email:', missingVars);
  console.log('Valeurs actuelles:', Object.fromEntries(
    requiredEnvVars.map(varName => [varName, process.env[varName] ? 'définie' : 'manquante'])
  ));
}

// Configuration du transporteur SMTP
const smtpConfig = {
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT, 10) || 465,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  },
  tls: {
    rejectUnauthorized: false
  }
};

console.log('Configuration SMTP:', {
  ...smtpConfig,
  auth: { ...smtpConfig.auth, pass: '***' }
});

const transporter = nodemailer.createTransport(smtpConfig);

// Vérification de la connexion SMTP au démarrage
transporter.verify(function(error, success) {
  if (error) {
    console.error('Erreur de connexion SMTP:', error);
  } else {
    console.log('Serveur SMTP est prêt à envoyer des emails');
  }
});

// Envoie un email de notification de changement de mot de passe
export const sendPasswordChangedEmail = async (email, username = 'Utilisateur') => {
  if (!email || !username) {
    console.error('Paramètres manquants pour l\'envoi d\'email de changement de mot de passe:', { email, username });
    throw new Error('Paramètres manquants pour l\'envoi d\'email');
  }

  const mailOptions = {
    from: `"${process.env.EMAIL_FROM_NAME || 'EbookRequest'}" <${process.env.EMAIL_FROM_ADDRESS || 'noreply@votresite.com'}>`,
    to: email,
    subject: 'Votre mot de passe a été modifié',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #4CAF50;">Mot de passe modifié avec succès</h2>
        <p>Bonjour ${username},</p>
        <p>Votre mot de passe a été modifié avec succès le ${new Date().toLocaleDateString('fr-FR', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })}.</p>
        
        <p>Si vous n'êtes pas à l'origine de cette modification, veuillez nous contacter immédiatement.</p>
        
        <p>Cordialement,<br>L'équipe de support EbookRequest</p>
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #757575;">
          <p>Cet email a été envoyé automatiquement. Merci de ne pas y répondre.</p>
        </div>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Email de notification de changement de mot de passe envoyé à ${email}`);
  } catch (error) {
    console.error('Erreur lors de l\'envoi de l\'email de notification de changement de mot de passe:', error);
    throw error;
  }
};

export const sendVerificationEmail = async (email, token, username = 'Utilisateur') => {
  if (!email || !token || !username) {
    console.error('Paramètres manquants pour l\'envoi d\'email:', { email, token: token ? '***' : 'manquant', username });
    throw new Error('Paramètres manquants pour l\'envoi d\'email');
  }
  const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${token}`;
  
  const mailOptions = {
    from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM_ADDRESS}>`,
    to: email,
    subject: 'Vérifiez votre adresse email',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2>Bonjour ${username},</h2>
        <p>Merci d'avoir ajouter votre adresse email. Pour finaliser cette ajout, veuillez vérifier votre adresse email en cliquant sur le bouton ci-dessous :</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
            Vérifier mon email
          </a>
        </div>
        <p>Si le bouton ne fonctionne pas, vous pouvez copier et coller le lien suivant dans votre navigateur :</p>
        <p>${verificationUrl}</p>
        <p>Ce lien expirera dans 24 heures.</p>
        <p>A bientôt,<br>L'équipe de support EbookRequest</p>
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #757575;">
          <p>Cet email a été envoyé automatiquement. Merci de ne pas y répondre.</p>
        </div>
      </div>
    `
  };

  console.log('Envoi de l\'email de vérification à:', email);
  console.log('Options SMTP:', {
    ...mailOptions,
    from: mailOptions.from,
    to: mailOptions.to,
    subject: mailOptions.subject,
    html: mailOptions.html ? '***' : 'manquant'
  });

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email envoyé avec succès:', info.messageId);
    return info;
  } catch (error) {
    console.error('Erreur lors de l\'envoi de l\'email de vérification:', {
      message: error.message,
      code: error.code,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    
    // Si l'erreur est liée à l'authentification, cela peut aider à diagnostiquer
    if (error.code === 'EAUTH') {
      console.error('Erreur d\'authentification SMTP. Vérifiez vos identifiants SMTP.');
    }
    
    throw new Error(`Impossible d'envoyer l'email de vérification: ${error.message}`);
  }
};

// Envoie une notification d'annulation de demande
export const sendRequestCanceledEmail = async (user, bookRequest) => {
  if (!user?.email || !bookRequest) {
    console.error('Paramètres manquants pour l\'envoi d\'email d\'annulation:', { user, bookRequest });
    throw new Error('Paramètres manquants pour l\'envoi d\'email d\'annulation');
  }

  const mailOptions = {
    from: `"${process.env.EMAIL_FROM_NAME || 'EbookRequest'}" <${process.env.EMAIL_FROM_ADDRESS || 'noreply@votresite.com'}>`,
    to: user.email,
    subject: `Votre demande pour "${bookRequest.title}" a été annulée`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #ef4444;">Demande annulée</h2>
        <p>Bonjour ${user.username || 'Utilisateur'},</p>
        <p>Nous vous informons que votre demande pour le livre <strong>${bookRequest.title}</strong> a été annulée.</p>
        
        ${bookRequest.cancelReason ? `
          <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 12px; margin: 16px 0; border-radius: 4px;">
            <p style="margin: 0; font-weight: 500; color: #b91c1c;">Raison :</p>
            <p style="margin: 8px 0 0 0;">${bookRequest.cancelReason}</p>
          </div>
        ` : ''}
        
        <p>Si vous pensez qu'il s'agit d'une erreur ou si vous avez des questions, n'hésitez pas à nous contacter.</p>
        
        <p>Cordialement,<br>L'équipe de support EbookRequest</p>
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #757575;">
          <p>Cet email a été envoyé automatiquement. Merci de ne pas y répondre.</p>
        </div>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Email de notification d'annulation envoyé à ${user.email}`);
  } catch (error) {
    console.error(`Erreur lors de l'envoi de l'email d'annulation à ${user.email}:`, error);
    throw error;
  }
};

// Envoie une notification de demande terminée
export const sendBookCompletedEmail = async (user, bookRequest) => {
  if (!user.notificationPreferences?.email?.enabled || !user.notificationPreferences?.email?.bookCompleted) {
    return; // Ne pas envoyer si les notifications par email sont désactivées
  }

  const mailOptions = {
    from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM_ADDRESS}>`,
    to: user.email,
    subject: `Votre demande de livre est prête : ${bookRequest.title}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2>Bonjour ${user.username},</h2>
        <p>Votre demande pour le livre <strong>${bookRequest.title}</strong> par ${bookRequest.author} est maintenant terminée !</p>
        <div style="text-align: center; margin: 30px 0;">
          <p>Vous pouvez accéder à votre livre depuis votre tableau de bord</a>.</p>
          <a href="${process.env.FRONTEND_URL}/dashboard" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">
            Accéder au tableau de bord
          </a>
        </div>
        <p>A bientôt,<br>L'équipe de support de EbookRequest</p>
        <p>*Si ce mail atteint votre spam, veuillez le marquer comme non spam et ajouter l'adresse <a href="mailto:${process.env.EMAIL_FROM_ADDRESS}">${process.env.EMAIL_FROM_ADDRESS}</a> à votre liste d'adresses de confiance.</p>
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #757575;">
          <p>Cet email a été envoyé automatiquement. Merci de ne pas y répondre.</p>
        </div>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error('Erreur lors de l\'envoi de la notification de livre terminé:', error);
    throw error;
  }
};

// Envoie une notification quand un admin ajoute/modifie un commentaire
export const sendAdminCommentEmail = async (user, bookRequest, comment) => {
  if (!user?.email || !user?.emailVerified) return;

  const mailOptions = {
    from: `"${process.env.EMAIL_FROM_NAME || 'EbookRequest'}" <${process.env.EMAIL_FROM_ADDRESS}>`,
    to: user.email,
    subject: `Note de l'administrateur sur votre demande : ${bookRequest.title}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #6366f1;">💬 Note de l'administrateur</h2>
        <p>Bonjour ${user.username || 'Utilisateur'},</p>
        <p>Un administrateur a laissé une note sur votre demande pour le livre <strong>${bookRequest.title}</strong> par ${bookRequest.author}.</p>

        <div style="background-color: #eef2ff; border-left: 4px solid #6366f1; padding: 12px; margin: 16px 0; border-radius: 4px;">
          <p style="margin: 0; font-weight: 500; color: #4338ca;">Note :</p>
          <p style="margin: 8px 0 0 0; color: #1e1b4b;">${comment}</p>
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
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Email de commentaire admin envoyé à ${user.email}`);
  } catch (error) {
    console.error(`Erreur lors de l'envoi de l'email de commentaire admin:`, error);
  }
};

// Helper function to escape HTML for security
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

// Envoie une notification aux admins pour une nouvelle requête de livre
export const sendNewRequestToAdminsEmail = async (admin, bookRequest, requesterUsername) => {
  if (!admin?.email || !admin?.emailVerified) {
    return; // Skip if admin doesn't have verified email
  }

  const adminPanelUrl = `${process.env.FRONTEND_URL}/admin`;
  const requestDate = new Date(bookRequest.createdAt).toLocaleString('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  // Escape user-provided content for security
  const safeTitle = escapeHtml(bookRequest.title);
  const safeAuthor = escapeHtml(bookRequest.author);
  const safeUsername = escapeHtml(requesterUsername);
  const safeDescription = bookRequest.description ? escapeHtml(bookRequest.description.substring(0, 300)) : '';

  const mailOptions = {
    from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM_ADDRESS}>`,
    to: admin.email,
    subject: `Nouvelle demande de livre: ${safeTitle}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #4CAF50;">📚 Nouvelle demande de livre</h2>
        <p>Bonjour ${escapeHtml(admin.username)},</p>
        <p>Une nouvelle demande de livre a été soumise par <strong>${safeUsername}</strong>.</p>

        ${bookRequest.thumbnail ? `
          <div style="text-align: center; margin: 20px 0;">
            <img src="${escapeHtml(bookRequest.thumbnail)}" alt="${safeTitle}" style="max-width: 150px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          </div>
        ` : ''}

        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 4px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Titre:</strong> ${safeTitle}</p>
          <p style="margin: 5px 0;"><strong>Auteur:</strong> ${safeAuthor}</p>
          <p style="margin: 5px 0;"><strong>Demandé par:</strong> ${safeUsername}</p>
          <p style="margin: 5px 0;"><strong>Date:</strong> ${requestDate}</p>
          ${bookRequest.link ? `<p style="margin: 5px 0;"><strong>Lien:</strong> <a href="${escapeHtml(bookRequest.link)}" style="color: #4CAF50;">${escapeHtml(bookRequest.link)}</a></p>` : ''}
        </div>

        ${safeDescription ? `
          <div style="margin: 20px 0;">
            <p><strong>Description:</strong></p>
            <p style="color: #666; font-size: 14px;">${safeDescription}${bookRequest.description.length > 300 ? '...' : ''}</p>
          </div>
        ` : ''}

        <div style="text-align: center; margin: 30px 0;">
          <a href="${adminPanelUrl}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
            Accéder au panneau admin
          </a>
        </div>

        <p>Cordialement,<br>Système EbookRequest</p>

        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #757575;">
          <p>Cet email a été envoyé automatiquement. Merci de ne pas y répondre.</p>
        </div>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Email de nouvelle requête envoyé à l'admin ${admin.email}`);
  } catch (error) {
    console.error(`Erreur lors de l'envoi de l'email à l'admin ${admin.email}:`, error);
    // Don't throw - email failure shouldn't block request creation
  }
};

// Réinitialisation du mot de passe
export const sendPasswordResetEmail = async (email, username, token) => {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${token}`;
  const mailOptions = {
    from: `"${process.env.EMAIL_FROM_NAME || 'EbookRequest'}" <${process.env.EMAIL_FROM_ADDRESS || 'noreply@votresite.com'}>`,
    to: email,
    subject: '🔑 Réinitialisation de votre mot de passe — EbookRequest',
    html: `
<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; border-radius: 16px; overflow: hidden; border: 1px solid #1e293b;">

  <!-- Header -->
  <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 2.5rem 2rem; text-align: center;">
    <img src="${process.env.FRONTEND_URL}/img/logo.png" alt="EbookRequest" style="height: 52px; margin-bottom: 1rem;" />
    <h1 style="color: white; margin: 0 0 0.5rem; font-size: 1.5rem; font-weight: 700;">
      Réinitialisation du mot de passe
    </h1>
    <p style="color: rgba(255,255,255,0.75); margin: 0; font-size: 0.9rem;">
      Une demande a été effectuée pour votre compte
    </p>
  </div>

  <!-- Body -->
  <div style="padding: 2rem;">
    <p style="color: #cbd5e1; font-size: 0.95rem; line-height: 1.7; margin: 0 0 1rem;">
      Bonjour <strong style="color: #e2e8f0;">${username}</strong>,
    </p>
    <p style="color: #94a3b8; font-size: 0.9rem; line-height: 1.7; margin: 0 0 1.5rem;">
      Nous avons reçu une demande de réinitialisation du mot de passe pour votre compte EbookRequest.
      Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.
    </p>

    <!-- CTA -->
    <div style="text-align: center; margin: 2rem 0;">
      <a href="${resetUrl}"
        style="display: inline-block; padding: 0.9rem 2.25rem;
               background: linear-gradient(135deg, #6366f1, #8b5cf6);
               color: white; text-decoration: none; border-radius: 10px;
               font-weight: 700; font-size: 1rem; letter-spacing: 0.01em;">
        🔑 Réinitialiser mon mot de passe
      </a>
    </div>

    <!-- Info expiration -->
    <div style="background: #1e293b; border-radius: 10px; padding: 1rem 1.25rem; margin: 1.5rem 0;">
      <p style="color: #f59e0b; font-size: 0.82rem; margin: 0 0 0.4rem; font-weight: 600;">
        ⏱ Ce lien expire dans 1 heure
      </p>
      <p style="color: #64748b; font-size: 0.8rem; margin: 0; word-break: break-all;">
        ${resetUrl}
      </p>
    </div>

    <p style="color: #64748b; font-size: 0.82rem; line-height: 1.6; margin: 0;">
      Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.
      Votre mot de passe restera inchangé.
    </p>
  </div>

  <!-- Footer -->
  <div style="background: #0a0f1e; padding: 1.25rem 2rem; text-align: center; border-top: 1px solid #1e293b;">
    <p style="color: #475569; font-size: 0.78rem; margin: 0; line-height: 1.6;">
      © EbookRequest •
      <a href="${process.env.FRONTEND_URL}" style="color: #6366f1; text-decoration: none;">Accéder au site</a>
      <br>Cet email a été envoyé automatiquement, merci de ne pas y répondre.
    </p>
  </div>
</div>`
  };
  await transporter.sendMail(mailOptions);
};

// Envoi d'un email de diffusion (broadcast) à un utilisateur
export const sendBroadcastEmail = async (to, subject, htmlContent) => {
  const mailOptions = {
    from: `"${process.env.EMAIL_FROM_NAME || 'EbookRequest'}" <${process.env.EMAIL_FROM_ADDRESS || 'noreply@votresite.com'}>`,
    to,
    subject,
    html: htmlContent.replace(/\{\{FRONTEND_URL\}\}/g, process.env.FRONTEND_URL || ''),
  };
  await transporter.sendMail(mailOptions);
};