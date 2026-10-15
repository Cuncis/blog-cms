import { publicReadPolicy } from './public-read-policy.js';

describe('publicReadPolicy', () => {
    const policy = publicReadPolicy('my-bucket');
    const [statement] = policy.Statement;

    it('allows anonymous reads of covers/ and nothing else', () => {
        expect(policy.Statement).toHaveLength(1);
        expect(statement?.Effect).toBe('Allow');
        expect(statement?.Principal).toEqual({ AWS: ['*'] });
        expect(statement?.Action).toEqual(['s3:GetObject']);
        expect(statement?.Resource).toEqual(['arn:aws:s3:::my-bucket/covers/*']);
    });

    it('never grants listing or writing, and never mentions the quarantine area', () => {
        const text = JSON.stringify(policy);

        expect(text).not.toContain('s3:ListBucket');
        expect(text).not.toContain('s3:PutObject');
        expect(text).not.toContain('s3:DeleteObject');
        expect(text).not.toContain('tmp/');
    });

    it('names the bucket it was given', () => {
        expect(JSON.stringify(publicReadPolicy('other-bucket'))).toContain('arn:aws:s3:::other-bucket/covers/*');
    });
});