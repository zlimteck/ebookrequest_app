import React, { useState } from 'react';
import styles from './ShelfPicker.module.css';

/**
 * Sélecteur d'étagères Calibre-Web — reprend exactement le comportement du
 * bloc qui vivait dans UserForm (multishelf + cibles additionnelles admin),
 * extrait ici pour être utilisable à la fois par le formulaire manuel et par
 * DirectSourceSearch. Gère son propre état d'ouverture/fermeture en interne.
 */
const ShelfPicker = ({
  calibreEnabled,
  calibreShelves = [],
  selectedShelves = [],
  toggleShelf,
  extraTargetCandidates = [],
  extraShelfSelections = {},
  toggleExtraShelf,
  buttonClassName,
}) => {
  const [open, setOpen] = useState(false);
  const extraShelfCount = Object.values(extraShelfSelections).reduce((n, arr) => n + arr.length, 0);

  if (!calibreEnabled && extraTargetCandidates.length === 0) return null;

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={buttonClassName || styles.trigger}
        title="Choisir les étagères Calibre-Web pour ce livre"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3v18h18" /><path d="M3 8h18" /><path d="M3 13h18" /><path d="M3 18h18" />
        </svg>
        Étagères{(selectedShelves.length + extraShelfCount) ? ` (${selectedShelves.length + extraShelfCount})` : ''}
      </button>

      {open && (
        <div className={styles.panel}>
          {calibreEnabled && (
            <>
              <div className={styles.sectionTitle}>Envoyer ce livre vers :</div>
              {calibreShelves.map(s => (
                <label key={s.name} className={styles.checkboxRow}>
                  <input type="checkbox" checked={selectedShelves.includes(s.name)} onChange={() => toggleShelf(s.name)} />
                  {s.name}
                </label>
              ))}
            </>
          )}

          {extraTargetCandidates.length > 0 && (
            <div className={calibreEnabled ? styles.extraSectionWithBorder : styles.extraSection}>
              <div className={styles.sectionTitle}>Aussi pour :</div>
              {extraTargetCandidates.map(u => (
                <div key={u._id} className={styles.userBlock}>
                  <div className={styles.username}>{u.username}</div>
                  {(u.shelves || []).length === 0 ? (
                    <div className={styles.noShelves}>Aucune étagère configurée</div>
                  ) : u.shelves.map(s => (
                    <label key={s.name} className={styles.checkboxRowIndent}>
                      <input
                        type="checkbox"
                        checked={(extraShelfSelections[u._id] || []).includes(s.name)}
                        onChange={() => toggleExtraShelf(u._id, s.name)}
                      />
                      {s.name}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}

          <button type="button" onClick={() => setOpen(false)} className={styles.closeBtn}>
            Fermer
          </button>
        </div>
      )}
    </div>
  );
};

export default ShelfPicker;
