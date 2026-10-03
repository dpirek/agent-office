export const MAX_CHAT_IMAGES = 4;
export const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_CHAT_BODY_BYTES = Math.ceil(MAX_CHAT_IMAGE_BYTES * 4 / 3) * MAX_CHAT_IMAGES + 700_000;
export const CHAT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
