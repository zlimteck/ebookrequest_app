import React, { useState, useEffect, useRef } from 'react';
import axiosAdmin from '../axiosAdmin';
import { toast } from 'react-toastify';
import styles from './CommentThread.module.css';

const CommentThread = ({ request, currentRole, onClose, onUpdate }) => {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [comments, setComments] = useState(request.comments || []);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments]);

  useEffect(() => {
    axiosAdmin.post(`/api/requests/${request._id}/comments/seen`)
      .then(() => {
        const updated = comments.map(c =>
          currentRole === 'user' ? { ...c, seenByUser: true } : { ...c, seenByAdmin: true }
        );
        setComments(updated);
        onUpdate?.(request._id, updated);
      })
      .catch(() => {});
  }, [request._id]); // eslint-disable-line

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      const res = await axiosAdmin.post(`/api/requests/${request._id}/comments`, { text: text.trim() });
      const newComment = res.data.comment;
      const updated = [...comments, newComment];
      setComments(updated);
      onUpdate?.(request._id, updated);
      setText('');
    } catch {
      toast.error('Erreur lors de l\'envoi du message.');
    } finally {
      setSending(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const formatTime = (date) => {
    const d = new Date(date);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) + ' ' +
           d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className={styles.overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div>
            <h3 className={styles.title}>Conversation</h3>
            <p className={styles.subtitle}>{request.title}</p>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className={styles.thread}>
          {comments.length === 0 && (
            <p className={styles.empty}>Aucun message. Posez une question ou laissez une note.</p>
          )}
          {comments.map((c, i) => {
            const isMine = c.role === currentRole;
            return (
              <div key={c._id || i} className={`${styles.bubble} ${isMine ? styles.bubbleMine : styles.bubbleOther}`}>
                <div className={styles.bubbleHeader}>
                  <span className={styles.bubbleAuthor}>{c.author}</span>
                  <span className={styles.bubbleTime}>{formatTime(c.createdAt)}</span>
                </div>
                <p className={styles.bubbleText}>{c.text}</p>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div className={styles.inputRow}>
          <textarea
            className={styles.input}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Écrire un message… (Entrée pour envoyer)"
            rows={2}
            maxLength={1000}
            disabled={sending}
          />
          <button className={styles.sendBtn} onClick={send} disabled={sending || !text.trim()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default CommentThread;