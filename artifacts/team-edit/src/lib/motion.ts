import type { Variants, Transition } from "framer-motion";

const ease = [0.25, 0.1, 0.25, 1] as const;
const easeOut = [0, 0, 0.25, 1] as const;

export const spring: Transition = { type: "spring", stiffness: 420, damping: 32 };

// Page entry — snappy fade-up
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.18, ease } },
  exit:    { opacity: 0,          transition: { duration: 0.1  } },
};

// Floating panel (notification, customization) — scale from top-right
export const panelVariants: Variants = {
  initial: { opacity: 0, scale: 0.95, y: -6 },
  animate: { opacity: 1, scale: 1,    y: 0,  transition: { duration: 0.15, ease } },
  exit:    { opacity: 0, scale: 0.97, y: -3,  transition: { duration: 0.1         } },
};

// Slide-in from left (mobile drawer)
export const drawerVariants: Variants = {
  initial: { x: "-100%" },
  animate: { x: 0,        transition: { duration: 0.22, ease: easeOut } },
  exit:    { x: "-100%",  transition: { duration: 0.18, ease         } },
};

// Stagger container
export const staggerContainer: Variants = {
  animate: { transition: { staggerChildren: 0.045, delayChildren: 0.05 } },
};

// Stagger item — fade-up
export const staggerItem: Variants = {
  initial: { opacity: 0, y: 8  },
  animate: { opacity: 1, y: 0, transition: { duration: 0.18, ease } },
};

// Stagger item — fade-right (table rows)
export const staggerRow: Variants = {
  initial: { opacity: 0, x: -6 },
  animate: { opacity: 1, x: 0,  transition: { duration: 0.16, ease } },
};

// Stagger item — fade only (kanban columns)
export const staggerFade: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.2 } },
};

// Overlay backdrop
export const backdropVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18 } },
  exit:    { opacity: 0, transition: { duration: 0.15 } },
};
