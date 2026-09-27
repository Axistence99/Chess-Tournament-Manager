/** Safe HTML-template helpers and Lucide icon placeholders used by renderers. */
/** Escape untrusted text before interpolating it into an HTML template. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character]!,
  );
}

/** Build a compact two-character fallback for players without a photo. */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();
}

/** Return Lucide's declarative placeholder; createIcons hydrates it after render. */
export function icon(name: string, size = 17): string {
  return `<i data-lucide="${escapeHtml(name)}" style="width:${size}px;height:${size}px" aria-hidden="true"></i>`;
}
