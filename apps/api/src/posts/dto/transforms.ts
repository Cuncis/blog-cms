export const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Trims, and turns an empty string into null ("no value"). */
export const trimToNull = ({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;

    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
};