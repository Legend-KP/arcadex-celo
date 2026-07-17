"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ARCADEX_FAQS,
  PRIVACY_POLICY_URL,
  SUPPORT_URL,
  TERMS_URL,
} from "@/lib/app-footer-links";

export default function AppFooter() {
  const [faqOpen, setFaqOpen] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!faqOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setFaqOpen(false);
    }

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [faqOpen]);

  const faqModal = faqOpen ? (
    <div
      className="app-footer-faq-backdrop"
      onClick={() => setFaqOpen(false)}
      role="presentation"
    >
      <div
        className="app-footer-faq"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-footer-faq-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="app-footer-faq__header">
          <h2 id="app-footer-faq-title" className="app-footer-faq__title">
            FAQs
          </h2>
          <button
            type="button"
            className="app-footer-faq__close"
            onClick={() => setFaqOpen(false)}
            aria-label="Close FAQs"
          >
            ×
          </button>
        </header>

        <div className="app-footer-faq__list">
          {ARCADEX_FAQS.map((item, index) => {
            const isOpen = openFaqIndex === index;
            return (
              <div
                key={item.question}
                className={`app-footer-faq__item${isOpen ? " app-footer-faq__item--open" : ""}`}
              >
                <button
                  type="button"
                  className="app-footer-faq__question"
                  aria-expanded={isOpen}
                  onClick={() =>
                    setOpenFaqIndex((prev) => (prev === index ? null : index))
                  }
                >
                  <span>{item.question}</span>
                  <span className="app-footer-faq__chevron" aria-hidden>
                    {isOpen ? "−" : "+"}
                  </span>
                </button>
                {isOpen && (
                  <p className="app-footer-faq__answer">{item.answer}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <footer className="app-footer">
        <nav className="app-footer__nav" aria-label="Legal and support">
          <a
            href={PRIVACY_POLICY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="app-footer__link"
          >
            Privacy Policy
          </a>
          <span className="app-footer__sep" aria-hidden>
            ·
          </span>
          <a
            href={TERMS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="app-footer__link"
          >
            Terms &amp; Conditions
          </a>
          <span className="app-footer__sep" aria-hidden>
            ·
          </span>
          <button
            type="button"
            className="app-footer__link app-footer__link--button"
            onClick={() => {
              setOpenFaqIndex(null);
              setFaqOpen(true);
            }}
          >
            FAQ
          </button>
          <span className="app-footer__sep" aria-hidden>
            ·
          </span>
          <a
            href={SUPPORT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="app-footer__link"
          >
            Support
          </a>
        </nav>
        <p className="app-footer__note">ArcadeX · Web3 Game Hub</p>
      </footer>

      {typeof document !== "undefined" && faqModal
        ? createPortal(faqModal, document.body)
        : faqModal}
    </>
  );
}
