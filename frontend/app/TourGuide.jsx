"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

const TOUR_STEPS = [
  {
    target: "[data-tour='sidebar-steps']",
    title: "Report stages",
    description: "Use this sidebar to move between project details, libraries, report sections, and Preview and Download. Completed stages are marked with a check.",
    placement: "right",
  },
  {
    target: "[data-tour='progress']",
    title: "Report completeness",
    description: "Track how much of the report has been completed. The percentage updates as you finish the required steps.",
    placement: "right",
  },
  {
    target: "[data-tour='profile']",
    title: "Your profile",
    description: "Open your profile to review or update your account details and initials.",
    placement: "bottom",
  },
  {
    target: "[data-tour='page-header']",
    title: "Current page",
    description: "This heading tells you which part of ReportGenix you are working on. On smaller screens, quick navigation links are shown here too.",
    placement: "bottom",
  },
  {
    target: "[data-tour='stage-nav']",
    title: "Stage navigation",
    description: "Use Back and Next to move through the report workflow in sequence.",
    placement: "top",
  },
  {
    target: "[data-tour='help-tabs']",
    title: "Help and FAQ",
    description: "Open the guided help or visit the FAQ page whenever you need assistance.",
    placement: "bottom",
  },
];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function findVisibleTarget(selector) {
  return Array.from(document.querySelectorAll(selector)).find((element) => {
    const bounds = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
  }) || null;
}

export default function TourGuide({ open, onClose }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const reduceMotion = useReducedMotion();
  const step = TOUR_STEPS[stepIndex];

  const measure = useCallback(() => {
    if (!open || typeof window === "undefined") return;
    const element = findVisibleTarget(step.target);
    setViewport({ width: window.innerWidth, height: window.innerHeight });

    if (!element) {
      setRect(null);
      return;
    }

    element.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "nearest",
      inline: "nearest",
    });

    // Measure after scrolling so the spotlight follows the final position.
    window.requestAnimationFrame(() => {
      const bounds = element.getBoundingClientRect();
      setRect({ top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height });
    });
  }, [open, step.target, reduceMotion]);

  useEffect(() => {
    if (!open) return;
    measure();
    const frame = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, measure, stepIndex]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
      if (event.key === "ArrowRight") setStepIndex((current) => Math.min(current + 1, TOUR_STEPS.length - 1));
      if (event.key === "ArrowLeft") setStepIndex((current) => Math.max(current - 1, 0));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) setStepIndex(0);
  }, [open]);

  const next = () => {
    if (stepIndex === TOUR_STEPS.length - 1) onClose?.();
    else setStepIndex((current) => current + 1);
  };

  const isMobile = viewport.width > 0 && viewport.width < 640;
  const cardWidth = Math.min(380, Math.max(280, viewport.width - 32));
  let cardStyle = {
    width: cardWidth,
    left: viewport.width ? (viewport.width - cardWidth) / 2 : 16,
    top: viewport.height ? Math.max(16, (viewport.height - 270) / 2) : 80,
  };

  if (isMobile) {
    // Keep the tour controls within thumb reach and away from notches/browser edges.
    cardStyle = { left: 12, right: 12, bottom: 12, width: "auto", top: "auto" };
  } else if (rect && viewport.width) {
    const gap = 16;
    let left = rect.left + rect.width / 2 - cardWidth / 2;
    let top = rect.top + rect.height + gap;

    if (step.placement === "right") {
      left = rect.left + rect.width + gap;
      top = rect.top + rect.height / 2 - 115;
      if (left + cardWidth > viewport.width - 16) left = rect.left - cardWidth - gap;
    } else if (step.placement === "top") {
      top = rect.top - 245;
    } else if (step.placement === "bottom" && top + 270 > viewport.height) {
      top = rect.top - 245;
    }

    cardStyle = {
      width: cardWidth,
      left: clamp(left, 16, Math.max(16, viewport.width - cardWidth - 16)),
      top: clamp(top, 16, Math.max(16, viewport.height - 285)),
    };
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.18 }}
          aria-modal="true"
          role="dialog"
          aria-label="ReportGenix guided tour"
        >
          <div className="absolute inset-0 bg-[#031323]/75" />

          {rect && !isMobile && (
            <motion.div
              className="pointer-events-none fixed z-[101] rounded-xl border-2 border-[#f84f63]"
              animate={{
                top: rect.top - 5,
                left: rect.left - 5,
                width: rect.width + 10,
                height: rect.height + 10,
              }}
              transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 28 }}
              style={{ boxShadow: "0 0 0 9999px rgba(3, 19, 35, 0.72), 0 0 28px rgba(248, 79, 99, 0.35)" }}
            />
          )}

          <motion.section
            key={stepIndex}
            className="fixed z-[102] max-h-[min(82dvh,560px)] overflow-y-auto overscroll-contain rounded-2xl border border-[#2f5b75] bg-[#0e3250] p-4 text-[#f3f8f7] shadow-2xl sm:p-6"
            style={cardStyle}
            initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: reduceMotion ? 0 : 0.22 }}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-[.16em] text-[#f84f63] sm:text-xs">ReportGenix tour</span>
              <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-xl leading-none text-[#a9c1ca] hover:bg-white/10 hover:text-white" aria-label="Close tour">×</button>
            </div>

            <div className="mb-4 flex items-center gap-1.5" aria-label={`Step ${stepIndex + 1} of ${TOUR_STEPS.length}`}>
              {TOUR_STEPS.map((item, index) => (
                <span key={item.target} className={`h-1.5 flex-1 rounded-full ${index <= stepIndex ? "bg-[#f84f63]" : "bg-[#31556c]"}`} />
              ))}
            </div>

            <h2 className="text-lg font-semibold text-white sm:text-xl">{step.title}</h2>
            <p className="mt-2 text-sm leading-6 text-[#c1d6dc]">{step.description}</p>

            {!rect && (
              <p className="mt-3 text-xs leading-5 text-[#8fbcc0]">This item is not visible on the current page, but you can continue the tour.</p>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 sm:mt-6">
              <span className="text-xs text-[#8fa9b5]">{stepIndex + 1} of {TOUR_STEPS.length}</span>
              <div className="flex w-full gap-2 sm:w-auto">
                <button type="button" onClick={() => setStepIndex((current) => Math.max(0, current - 1))} disabled={stepIndex === 0} className="min-h-10 flex-1 rounded-md border border-[#2f5b75] px-3 py-2 text-sm font-medium text-[#c8dfe1] transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-35 sm:flex-none">Back</button>
                <button type="button" onClick={next} className="min-h-10 flex-1 rounded-md bg-[#f84f63] px-4 py-2 text-sm font-semibold text-[#0a1f36] transition hover:bg-[#ff667a] sm:flex-none">{stepIndex === TOUR_STEPS.length - 1 ? "Finish" : "Next"}</button>
              </div>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
