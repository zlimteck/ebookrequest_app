import React, { useEffect, useRef, useState } from 'react';
import axiosAdmin from '../axiosAdmin';
import styles from './ChatBot.module.css';

export default function ChatBot() {
  const [available, setAvailable] = useState(false);
  const [open, setOpen]           = useState(false);
  const [messages, setMessages]   = useState([]);
  const [input, setInput]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [remaining, setRemaining] = useState(null);
  const [dailyLimit, setDailyLimit] = useState(10);
  const [error, setError]         = useState('');
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    axiosAdmin.get('/api/chatbot/status')
      .then(res => {
        if (res.data.available) {
          setAvailable(true);
          setRemaining(res.data.remaining);
          if (res.data.limit) setDailyLimit(res.data.limit);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      axiosAdmin.get('/api/chatbot/status')
        .then(res => {
          if (res.data.available) {
            setRemaining(res.data.remaining);
            if (res.data.limit) setDailyLimit(res.data.limit);
          }
        })
        .catch(() => {});
    }
  }, [open]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading || remaining === 0) return;

    const userMsg = { role: 'user', content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setError('');
    setLoading(true);

    try {
      const res = await axiosAdmin.post('/api/chatbot/message', { messages: nextMessages });
      setMessages(prev => [...prev, { role: 'assistant', content: res.data.reply }]);
      setRemaining(res.data.remaining);
    } catch (err) {
      const msg = err.response?.data?.error || 'Erreur de connexion.';
      setError(msg);
      if (err.response?.status === 429) setRemaining(0);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const autoResize = (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 80) + 'px';
  };

  if (!available) return null;

  return (
    <>
      {open && (
        <div className={styles.panel}>
          <div className={styles.header}>
            <div className={styles.headerLeft}>
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="var(--color-accent)" strokeWidth="2" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <p className={styles.headerTitle}>EbookRequest AI</p>
              {remaining !== null && (
                <span className={`${styles.quota} ${remaining <= 2 ? styles.quotaLow : ''}`}>
                  {remaining}/{dailyLimit}
                </span>
              )}
            </div>
            <button className={styles.closeBtn} onClick={() => setOpen(false)} aria-label="Fermer">
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div className={styles.messages}>
            {messages.length === 0 && (
              <div className={styles.empty}>
                <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <span>Comment puis-je vous aider ?</span>
                <span style={{ fontSize: 11 }}>Demandes, bibliothèque, recherche de livres…</span>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`${styles.msgRow} ${m.role === 'user' ? styles.msgRowUser : styles.msgRowBot}`}>
                <div className={`${styles.bubble} ${m.role === 'user' ? styles.bubbleUser : styles.bubbleBot}`}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className={`${styles.msgRow} ${styles.msgRowBot}`}>
                <div className={`${styles.bubble} ${styles.bubbleBot} ${styles.typing}`}>
                  <span className={styles.dot}/><span className={styles.dot}/><span className={styles.dot}/>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {error && <p className={styles.errorMsg}>{error}</p>}

          <div className={styles.inputArea}>
            <textarea
              ref={textareaRef}
              className={styles.input}
              value={input}
              onChange={e => { setInput(e.target.value); autoResize(e); }}
              onKeyDown={handleKey}
              placeholder={remaining === 0 ? 'Limite atteinte pour aujourd\'hui' : 'Envoyer un message…'}
              rows={1}
              maxLength={500}
              disabled={remaining === 0 || loading}
            />
            <button className={styles.sendBtn} onClick={send} disabled={!input.trim() || loading || remaining === 0} aria-label="Envoyer">
              <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      <button
        className={`${styles.trigger} ${styles.triggerVisible} ${open ? styles.triggerOpen : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-label="Ouvrir l'assistant"
        title="Assistant IA"
      >
        {open ? (
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        ) : (
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        )}
      </button>
    </>
  );
}
