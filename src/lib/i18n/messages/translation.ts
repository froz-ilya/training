/** Another language's half of a catalog file: the same keys as English, none missing or extra. */
export type Translation<T> = { [K in keyof T]: string };

/** Russian has more plural forms than English, so it may add `.few` and `.many` keys. */
export type RuTranslation<T> = Translation<T> & { [key: `${string}.few` | `${string}.many`]: string };
