import type { Player } from "../models";
import { escapeHtml, initials } from "../utils/html";

/**
 * Render either a locally stored player photo or deterministic initials.
 * Images use an empty alt attribute because the adjacent player name already
 * provides the accessible label and duplicate announcements would be noisy.
 */
export function playerAvatar(profile: Player, large = false): string {
  const classes = `avatar ${large ? "avatar-large" : ""}`;
  if (profile.avatar) {
    return `<span class="${classes}"><img src="${escapeHtml(profile.avatar)}" alt=""></span>`;
  }
  return `<span class="${classes}">${escapeHtml(initials(profile.name))}</span>`;
}
