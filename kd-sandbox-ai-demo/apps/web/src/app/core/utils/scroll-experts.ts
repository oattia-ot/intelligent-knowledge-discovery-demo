export const EXPERTS_ANCHOR_ID = 'experts-side-heading';

/** Scroll the left-panel Experts block into view (sidebar, not the window). */
export function scrollExpertsIntoView(): boolean {
  const el = document.getElementById(EXPERTS_ANCHOR_ID);
  if (!el) {
    return false;
  }
  const panel = el.closest('.filters-panel') as HTMLElement | null;
  if (panel) {
    const y =
      el.getBoundingClientRect().top -
      panel.getBoundingClientRect().top +
      panel.scrollTop -
      8;
    panel.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  } else {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  return true;
}
