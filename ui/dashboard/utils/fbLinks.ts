/**
 * Facebook link helpers shared across the dashboard.
 */

/**
 * Extract the numeric Facebook user id from a profile link, if present.
 *   - https://www.facebook.com/profile.php?id=100012345678  -> 100012345678
 *   - https://www.facebook.com/100012345678                 -> 100012345678
 *   - https://www.facebook.com/some.username                -> null (no numeric id)
 */
export const fbUserIdFromLink = (authorLink?: string | null): string | null => {
  if (!authorLink) return null;
  const idParam = authorLink.match(/[?&]id=(\d{5,})/);
  if (idParam) return idParam[1];
  const trailing = authorLink.match(/facebook\.com\/(\d{5,})(?:[/?#]|$)/);
  if (trailing) return trailing[1];
  return null;
};

/**
 * Build a Messenger "open chat" link for a profile when we can resolve a
 * numeric id; otherwise return null so the caller can fall back to the plain
 * profile link. Facebook's canonical direct-message URL is
 * `https://www.facebook.com/messages/t/<userId>`.
 */
export const messengerLink = (authorLink?: string | null): string | null => {
  const id = fbUserIdFromLink(authorLink);
  return id ? `https://www.facebook.com/messages/t/${id}` : null;
};
