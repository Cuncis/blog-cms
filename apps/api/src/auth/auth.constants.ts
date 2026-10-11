// One message for every way a session can be invalid (unknown, expired, revoked, reused),
// so a client can never learn which of those it was.
export const INVALID_SESSION_MESSAGE = 'Invalid or expired session.';

// One message for every way an access token can be unacceptable
// (missing, malformed, wrong signature, expired, tampered).
export const AUTH_REQUIRED_MESSAGE = 'Authentication required.';