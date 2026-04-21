import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import axiosAdmin from '../axiosAdmin';
import styles from './TwoFactorSetup.module.css';

/**
 * TwoFactorSetup — composant de configuration 2FA autonome.
 *
 * Props:
 *   is2FAEnabled  {boolean}   — état initial (depuis le serveur)
 *   onDone        {Function}  — appelé quand la configuration change (pour synchro parent)
 */
const TwoFactorSetup = ({ is2FAEnabled = false, onDone }) => {
  // step : 'active' | 'info' | 'scan' | 'codes' | 'disabling'
  const [step, setStep] = useState(is2FAEnabled ? 'active' : 'info');
  const [secret, setSecret] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [showDisableForm, setShowDisableForm] = useState(false);

  // Synchronise le step si is2FAEnabled change après le montage (ex: chargement async)
  useEffect(() => {
    setStep(prev => {
      // Ne pas écraser un step en cours de workflow (scan, codes)
      if (prev === 'scan' || prev === 'codes') return prev;
      return is2FAEnabled ? 'active' : 'info';
    });
  }, [is2FAEnabled]);

  // ── Démarrer la configuration ──
  const handleStartSetup = async () => {
    setIsLoading(true);
    try {
      const res = await axiosAdmin.get('/api/auth/2fa/setup');
      setSecret(res.data.secret);
      setQrDataUrl(res.data.qrDataUrl);
      setVerifyCode('');
      setStep('scan');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la génération du QR code');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Vérifier le premier code TOTP ──
  const handleVerifySetup = async () => {
    if (!verifyCode || verifyCode.length !== 6) {
      toast.error('Veuillez entrer un code à 6 chiffres');
      return;
    }
    setIsLoading(true);
    try {
      const res = await axiosAdmin.post('/api/auth/2fa/verify-setup', { code: verifyCode });
      setRecoveryCodes(res.data.recoveryCodes);
      setStep('codes');
      toast.success('2FA activé avec succès !');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Code invalide');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Copier le secret ──
  const handleCopySecret = () => {
    navigator.clipboard.writeText(secret)
      .then(() => toast.success('Secret copié !'))
      .catch(() => toast.error('Impossible de copier'));
  };

  // ── Copier tous les codes de récupération ──
  const handleCopyAllCodes = () => {
    navigator.clipboard.writeText(recoveryCodes.join('\n'))
      .then(() => toast.success('Codes copiés !'))
      .catch(() => toast.error('Impossible de copier'));
  };

  // ── Codes sauvegardés → passer en vue "actif" ──
  const handleCodesSaved = () => {
    setStep('active');
    onDone && onDone(true);
  };

  // ── Désactiver le 2FA ──
  const handleDisable = async () => {
    if (!disablePassword) {
      toast.error('Veuillez entrer votre mot de passe');
      return;
    }
    setIsLoading(true);
    try {
      await axiosAdmin.post('/api/auth/2fa/disable', { password: disablePassword });
      toast.success('2FA désactivé');
      setDisablePassword('');
      setShowDisableForm(false);
      setStep('info');
      onDone && onDone(false);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la désactivation');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Vue : 2FA actif ──
  if (step === 'active') {
    return (
      <div className={styles.container}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <span className={`${styles.statusBadge} ${styles.statusEnabled}`}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <circle cx="5" cy="5" r="4"/>
            </svg>
            Actif
          </span>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            Votre compte est protégé par l'authentification à deux facteurs.
          </p>
        </div>

        <div className={styles.dangerZone}>
          <p className={styles.dangerTitle}>Zone de danger</p>
          <p className={styles.dangerDesc}>
            La désactivation du 2FA rendra votre compte moins sécurisé.
          </p>

          {!showDisableForm ? (
            <button
              type="button"
              className={styles.btnDanger}
              onClick={() => setShowDisableForm(true)}
            >
              Désactiver le 2FA
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div className={styles.fieldRow}>
                <label className={styles.fieldLabel}>Confirmer avec votre mot de passe</label>
                <input
                  type="password"
                  className={styles.fieldInput}
                  placeholder="Mot de passe actuel"
                  value={disablePassword}
                  onChange={e => setDisablePassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleDisable()}
                />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className={styles.btnDanger}
                  onClick={handleDisable}
                  disabled={isLoading}
                  style={{ flex: 1 }}
                >
                  {isLoading ? <span className={styles.spinner} /> : 'Confirmer la désactivation'}
                </button>
                <button
                  type="button"
                  className={styles.btnOutline}
                  onClick={() => { setShowDisableForm(false); setDisablePassword(''); }}
                  style={{ flex: 1 }}
                >
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Vue : Étape 1 — Info / démarrage ──
  if (step === 'info') {
    return (
      <div className={styles.container}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <span className={`${styles.statusBadge} ${styles.statusDisabled}`}>
            Inactif
          </span>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            Le 2FA n'est pas encore configuré.
          </p>
        </div>

        <div className={styles.infoBox}>
          <svg className={styles.infoIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <span>
            L'authentification à deux facteurs ajoute une couche de sécurité supplémentaire.
            En plus de votre mot de passe, vous devrez entrer un code temporaire généré
            par Google Authenticator ou l'app Mots de passe d'Apple.
          </span>
        </div>

        <button
          type="button"
          className={styles.btnPrimary}
          onClick={handleStartSetup}
          disabled={isLoading}
        >
          {isLoading ? <span className={styles.spinner} /> : 'Configurer le 2FA'}
        </button>
      </div>
    );
  }

  // ── Vue : Étape 2 — Scanner le QR ──
  if (step === 'scan') {
    return (
      <div className={styles.container}>
        <div className={styles.qrWrap}>
          {qrDataUrl && (
            <img src={qrDataUrl} alt="QR Code 2FA" className={styles.qrImage} />
          )}
          <p className={styles.qrInstructions}>
            Scannez ce QR code avec <strong>Google Authenticator</strong> ou
            l'app <strong>Mots de passe d'Apple</strong>
          </p>
          <div style={{ width: '100%' }}>
            <p className={styles.secretLabel}>Clé manuelle</p>
            <div className={styles.secretBox}>
              <span className={styles.secretKey}>{secret}</span>
              <button type="button" className={styles.copyBtn} onClick={handleCopySecret}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                Copier
              </button>
            </div>
          </div>
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Code de vérification (6 chiffres)</label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            className={styles.codeInput}
            placeholder="000000"
            value={verifyCode}
            onChange={e => setVerifyCode(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => e.key === 'Enter' && handleVerifySetup()}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            className={styles.btnOutline}
            onClick={() => setStep('info')}
            style={{ flex: 1 }}
          >
            Annuler
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={handleVerifySetup}
            disabled={isLoading || verifyCode.length !== 6}
            style={{ flex: 2 }}
          >
            {isLoading ? <span className={styles.spinner} /> : 'Vérifier et activer'}
          </button>
        </div>
      </div>
    );
  }

  // ── Vue : Étape 3 — Codes de récupération ──
  if (step === 'codes') {
    return (
      <div className={styles.container}>
        <div className={styles.recoveryWarning}>
          <svg className={styles.recoveryWarningIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>
            <strong>Conservez ces codes en lieu sûr.</strong> Ils ne seront plus affichés.
            Chaque code ne peut être utilisé qu'une seule fois si vous perdez l'accès à votre application d'authentification.
          </span>
        </div>

        <div className={styles.recoveryGrid}>
          {recoveryCodes.map((code, i) => (
            <div key={i} className={styles.recoveryCode}>{code}</div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className={styles.btnOutline} onClick={handleCopyAllCodes} style={{ flex: 1 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Tout copier
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={handleCodesSaved}
            style={{ flex: 2 }}
          >
            J'ai sauvegardé mes codes
          </button>
        </div>
      </div>
    );
  }

  return null;
};

export default TwoFactorSetup;