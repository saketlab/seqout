import { copyToClipboard } from "@/utils/clipboard";

/**
 * Copies a link to the current page pointing at the given hash (section id,
 * optionally with a tab suffix — see {@link buildSectionHash}) and updates the
 * address bar to match. Returns whether the copy succeeded.
 */
export async function copySectionLink(hash: string): Promise<boolean> {
  const url = new URL(window.location.href);
  url.hash = hash;
  const sectionUrl = url.toString();

  let didCopy = false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(sectionUrl);
      didCopy = true;
    } catch {
      didCopy = false;
    }
  }

  if (!didCopy) {
    didCopy = copyToClipboard(sectionUrl);
  }

  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}#${hash}`,
  );
  return didCopy;
}
