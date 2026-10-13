import { Header } from '@nestjs/common';

/** Responses that contain drafts or other private data must never be stored by browsers or proxies. */
export const NoStore = () => Header('Cache-Control', 'no-store');