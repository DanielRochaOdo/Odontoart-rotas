import { useCallback, useState, type SetStateAction } from "react";

type LocalStorageStateOptions<T> = {
  parse?: (raw: string) => T;
  serialize?: (value: T) => string;
};

const readInitialValue = <T,>(
  key: string,
  initialValue: T,
  parse?: (raw: string) => T,
) => {
  if (typeof window === "undefined") return initialValue;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return initialValue;
    return parse ? parse(raw) : (JSON.parse(raw) as T);
  } catch {
    return initialValue;
  }
};

export const useLocalStorageState = <T,>(
  key: string,
  initialValue: T,
  options: LocalStorageStateOptions<T> = {},
) => {
  const { parse, serialize } = options;
  const [value, setValue] = useState<T>(() => readInitialValue(key, initialValue, parse));

  const setValueAndPersist = useCallback(
    (next: SetStateAction<T>) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (prevState: T) => T)(prev) : next;

        if (typeof window !== "undefined") {
          try {
            const serialized = serialize ? serialize(resolved) : JSON.stringify(resolved);
            window.localStorage.setItem(key, serialized);
          } catch {
            // ignore localStorage failures
          }
        }

        return resolved;
      });
    },
    [key, serialize],
  );

  return [value, setValueAndPersist] as const;
};
