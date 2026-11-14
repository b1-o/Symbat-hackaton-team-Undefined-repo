import React, { useEffect, useRef } from 'react';
import { X, Check, LoaderCircle, ArrowUpRight, Inbox } from 'lucide-react';
import { useI18n } from '../lib/i18n';

export function Badge({ children, tone = 'neutral', dot = false }) {
  return (
    <span className={`badge ${tone}`}>
      {dot && <i />}
      {children}
    </span>
  );
}
export function Button({ children, variant = 'primary', busy, className = '', disabled, ...props }) {
  return (
    <button className={`btn ${variant} ${className}`} {...props} disabled={busy || disabled}>
      {busy && <LoaderCircle size={16} className="spin" />}
      {children}
    </button>
  );
}
export function Progress({ value, label, tone = '' }) {
  const { t } = useI18n();
  label = label ?? t('Прогресс');
  return (
    <div
      className={`progress ${tone}`}
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
export function Card({ children, className = '', ...props }) {
  return (
    <section className={`card ${className}`} {...props}>
      {children}
    </section>
  );
}
export function SectionHead({ eyebrow, title, text, children }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {text && <p>{text}</p>}
      </div>
      {children}
    </div>
  );
}
export function Empty({ title, text, children }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Inbox size={26} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function Status({ submission }) {
  const { t, tf, te, lang, loc } = useI18n();
  const map = {
    pending: ['amber', t('На проверке')],
    approved: ['green', t('Подтверждён')],
    returned: ['red', t('Нужна доработка')],
  };
  const [tone, label] = map[submission?.status] || ['neutral', t('Черновик')];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}
export function Field({ label, hint, children, className = '', ...props }) {
  return (
    <label className={`field ${className}`} {...props}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Modal({ title, children, onClose, wide = false }) {
  const { t, tf, te, lang, loc } = useI18n();
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    function key(e) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const items = ref.current?.querySelectorAll(
          'button:not(:disabled), a[href], input:not(:disabled), select, textarea, [tabindex="0"]',
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? 'wide' : ''}`}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label={t('Закрыть')} onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function CheckItem({ done, children }) {
  return (
    <div className={`check-item ${done ? 'done' : ''}`}>
      <span>{done && <Check size={12} />}</span>
      {children}
    </div>
  );
}
export function External({ href, children, className = 'text-link' }) {
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <ArrowUpRight size={15} />
    </a>
  );
}
