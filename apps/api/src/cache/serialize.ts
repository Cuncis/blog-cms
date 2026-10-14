/** What a value looks like after a trip through JSON: dates become ISO strings. */
export type Serialized<T> = T extends Date
    ? string
    : T extends readonly (infer Item)[]
    ? Serialized<Item>[]
    : T extends object
    ? { [Key in keyof T]: Serialized<T[Key]> }
    : T;

/**
 * Exactly what the client would receive. Cache hits and misses both go through this,
 * so the two paths can never differ in shape.
 */
export function toJson<T extends object>(value: T): Serialized<T> {
    return JSON.parse(JSON.stringify(value)) as Serialized<T>;
}

/** Parses a cached value. Anything that isn't a JSON object or array counts as unusable. */
export function parseJson<T>(text: string): Serialized<T> | undefined {
    try {
        const parsed: unknown = JSON.parse(text);

        return typeof parsed === 'object' && parsed !== null ? (parsed as Serialized<T>) : undefined;
    } catch {
        return undefined;
    }
}