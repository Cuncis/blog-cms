import { COVER_PREFIX } from '../uploads/uploads.constants.js';

/**
 * Anonymous users may READ objects under covers/ and nothing else: no listing, no writing,
 * and nothing under tmp/ (the quarantine area). Applied automatically outside production only.
 */
export function publicReadPolicy(bucket: string) {
    return {
        Version: '2012-10-17',
        Statement: [
            {
                Sid: 'PublicReadCovers',
                Effect: 'Allow',
                Principal: { AWS: ['*'] },
                Action: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${bucket}/${COVER_PREFIX}*`],
            },
        ],
    };
}