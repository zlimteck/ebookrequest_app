import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function useFocusTrap(isOpen) {
  const containerRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement;

    const container = containerRef.current;
    if (!container) return;

    const focusables = Array.from(container.querySelectorAll(FOCUSABLE));
    if (focusables.length) focusables[0].focus();

    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      if (!focusables.length) { e.preventDefault(); return; }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused.current?.focus) {
        previouslyFocused.current.focus();
      }
    };
  }, [isOpen]);

  return containerRef;
}
