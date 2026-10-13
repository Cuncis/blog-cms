export const TITLE_MAX = 200;
export const EXCERPT_MAX = 300;
export const CONTENT_MAX = 200_000; // characters

// Lowercase words joined by single hyphens, at most 200 characters (the column size)
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 200;

// Shared by the controller and the body-size rule in setup-app.ts, so they can't drift apart
export const MANAGE_POSTS_PATH = 'manage/posts';