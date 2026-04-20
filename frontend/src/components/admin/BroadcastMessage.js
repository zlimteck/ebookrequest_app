import React, { useState } from 'react';
import axiosAdmin from '../../axiosAdmin';
import { toast } from 'react-toastify';
import styles from './BroadcastMessage.module.css';

const DEFAULT_HTML = `<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; border-radius: 12px; overflow: hidden;">
  <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 2rem; text-align: center;">
    <img src="{{FRONTEND_URL}}/img/logo.png" alt="EbookRequest" style="height: 48px; margin-bottom: 0.75rem;" />
    <h1 style="color: white; margin: 0; font-size: 1.5rem;">📢 Message de l'équipe</h1>
  </div>
  <div style="padding: 2rem; color: #e2e8f0;">
    <p style="font-size: 1rem; line-height: 1.7; color: #cbd5e1;">
      Bonjour,
    </p>
    <p style="font-size: 1rem; line-height: 1.7; color: #cbd5e1;">
      Votre message ici...
    </p>
  </div>
  <div style="background: #1e293b; padding: 1.25rem; text-align: center; border-top: 1px solid #2d3748;">
    <p style="color: #64748b; font-size: 0.8rem; margin: 0;">© EbookRequest — <a href="{{FRONTEND_URL}}" style="color: #6366f1;">Accéder au site</a></p>
  </div>
</div>`;

export default function BroadcastMessage() {
  const [channels, setChannels] = useState({ email: true, push: false });
  const [subject, setSubject] = useState('');
  const [htmlContent, setHtmlContent] = useState(DEFAULT_HTML);
  const [pushTitle, setPushTitle] = useState('');
  const [pushBody, setPushBody] = useState('');
  const [preview, setPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(null);
  const [targetEmail, setTargetEmail] = useState('');

  const toggleChannel = (ch) => setChannels(prev => ({ ...prev, [ch]: !prev[ch] }));

  const handleSend = async () => {
    if (!channels.email && !channels.push) {
      toast.error('Sélectionnez au moins un canal');
      return;
    }
    if (channels.email && !subject.trim()) {
      toast.error('Objet du mail requis');
      return;
    }
    if (channels.email && !htmlContent.trim()) {
      toast.error('Contenu HTML requis');
      return;
    }
    if (channels.push && !pushTitle.trim()) {
      toast.error('Titre de la notification requis');
      return;
    }
    const target = targetEmail.trim();
    const confirmMsg = target
      ? `Envoyer ce message uniquement à ${target} ?`
      : `Envoyer ce message à tous les utilisateurs actifs ?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      setSending(true);
      const res = await axiosAdmin.post('/api/admin/broadcast', {
        channels,
        subject: subject.trim(),
        htmlContent,
        pushTitle: pushTitle.trim(),
        pushBody: pushBody.trim(),
        targetEmail: target || undefined,
      });
      setSent(res.data);
      toast.success('Message envoyé !');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de l\'envoi');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>Message de diffusion</h2>
        <p className={styles.subtitle}>Envoie un message à tous les utilisateurs actifs</p>
      </div>

      {/* Canaux */}
      <div className={styles.section}>
        <label className={styles.sectionLabel}>Canaux d'envoi</label>
        <div className={styles.channelRow}>
          <button
            className={`${styles.channelBtn} ${channels.email ? styles.channelBtnActive : ''}`}
            onClick={() => toggleChannel('email')}
          >
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
            Email
            {channels.email && <span className={styles.channelCheck}>✓</span>}
          </button>
          <button
            className={`${styles.channelBtn} ${channels.push ? styles.channelBtnActive : ''}`}
            onClick={() => toggleChannel('push')}
          >
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            Notification push
            {channels.push && <span className={styles.channelCheck}>✓</span>}
          </button>
        </div>
      </div>

      {/* Destinataire spécifique */}
      {channels.email && (
        <div className={styles.section}>
          <label className={styles.sectionLabel}>Destinataire spécifique <span style={{ color: '#64748b', fontWeight: 400 }}>(optionnel — laisser vide pour envoyer à tous)</span></label>
          <input
            className={styles.input}
            placeholder="email@exemple.com"
            type="email"
            value={targetEmail}
            onChange={e => setTargetEmail(e.target.value)}
          />
        </div>
      )}

      {/* Champs email */}
      {channels.email && (
        <div className={styles.section}>
          <label className={styles.sectionLabel}>Email</label>
          <input
            className={styles.input}
            placeholder="Objet du mail..."
            value={subject}
            onChange={e => setSubject(e.target.value)}
          />
          <div className={styles.editorHeader}>
            <span className={styles.editorLabel}>Contenu HTML</span>
            <button
              className={`${styles.previewToggle} ${preview ? styles.previewToggleActive : ''}`}
              onClick={() => setPreview(p => !p)}
            >
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              {preview ? 'Éditer' : 'Aperçu'}
            </button>
          </div>
          {preview ? (
            <div className={styles.previewFrame}>
              <iframe
                srcDoc={htmlContent}
                title="Aperçu email"
                className={styles.iframe}
                sandbox="allow-same-origin"
              />
            </div>
          ) : (
            <textarea
              className={styles.textarea}
              value={htmlContent}
              onChange={e => setHtmlContent(e.target.value)}
              rows={18}
              spellCheck={false}
              placeholder="Code HTML du mail..."
            />
          )}
        </div>
      )}

      {/* Champs push */}
      {channels.push && (
        <div className={styles.section}>
          <label className={styles.sectionLabel}>Notification push</label>
          <input
            className={styles.input}
            placeholder="Titre de la notification..."
            value={pushTitle}
            onChange={e => setPushTitle(e.target.value)}
          />
          <textarea
            className={styles.textarea}
            placeholder="Corps de la notification..."
            value={pushBody}
            onChange={e => setPushBody(e.target.value)}
            rows={3}
          />
        </div>
      )}

      {/* Résultat dernier envoi */}
      {sent && (
        <div className={styles.sentResult}>
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
          {sent.emailSent !== undefined && <span>Emails : {sent.emailSent} envoyés</span>}
          {sent.pushSent !== undefined && <span>Push : {sent.pushSent} envoyés</span>}
          {sent.errors > 0 && <span style={{ color: '#ef4444' }}>{sent.errors} erreur(s)</span>}
        </div>
      )}

      {/* Bouton envoi */}
      <div className={styles.footer}>
        <button
          className={styles.sendBtn}
          onClick={handleSend}
          disabled={sending}
        >
          {sending ? (
            <span className={styles.spinner} />
          ) : (
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          )}
          {sending ? 'Envoi en cours...' : targetEmail.trim() ? `Envoyer à ${targetEmail.trim()}` : 'Envoyer à tous les utilisateurs'}
        </button>
      </div>
    </div>
  );
}