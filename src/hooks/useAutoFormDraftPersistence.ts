import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

type DraftValue =
  | { type: "text"; value: string }
  | { type: "checked"; value: boolean }
  | { type: "multi"; value: string[] };

type RouteDraft = {
  updatedAt: number;
  values: Record<string, DraftValue>;
};

type DraftStore = Record<string, RouteDraft>;

const STORAGE_KEY = "odontoartRouteFormDraftsV1";
const SAVE_DEBOUNCE_MS = 180;
const SNAPSHOT_INTERVAL_MS = 1500;
const INITIAL_RESTORE_WINDOW_MS = 1200;

type DraftField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const readStore = (): DraftStore => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DraftStore;
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
};

const writeStore = (store: DraftStore) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore storage failures
  }
};

const isEligibleField = (element: Element): element is DraftField => {
  if (
    !(element instanceof HTMLInputElement) &&
    !(element instanceof HTMLTextAreaElement) &&
    !(element instanceof HTMLSelectElement)
  ) {
    return false;
  }
  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    if (
      type === "password" ||
      type === "file" ||
      type === "hidden" ||
      type === "submit" ||
      type === "reset" ||
      type === "button"
    ) {
      return false;
    }
  }
  return true;
};

const getDraftRoot = () =>
  document.getElementById("app-content-root") ?? document.body;

const getDraftFields = (root: Element) =>
  Array.from(root.querySelectorAll("input, textarea, select")).filter(isEligibleField);

const buildFieldPath = (field: DraftField, root: Element) => {
  if (field.id) return `id:${field.id}`;

  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
    const name = field.name?.trim();
    if (name) {
      const escapedName = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(name) : name;
      const fieldsByName = getDraftFields(root).filter((item) => item.name === name);
      const index = Math.max(0, fieldsByName.findIndex((item) => item === field));
      return `name:${escapedName}:${index}`;
    }
  }

  const segments: string[] = [];
  let current: Element | null = field;
  while (current && current !== root) {
    const parentElement: HTMLElement | null = current.parentElement;
    if (!parentElement) break;
    const sameTagSiblings = Array.from(parentElement.children).filter(
      (item: Element) => item.tagName === current?.tagName,
    );
    const index = Math.max(0, sameTagSiblings.findIndex((item) => item === current)) + 1;
    segments.push(`${current.tagName.toLowerCase()}:${index}`);
    current = parentElement;
  }
  return `path:${segments.reverse().join("/")}`;
};

const serializeFieldValue = (field: DraftField): DraftValue => {
  if (field instanceof HTMLInputElement) {
    const type = field.type.toLowerCase();
    if (type === "checkbox" || type === "radio") {
      return { type: "checked", value: field.checked };
    }
    return { type: "text", value: field.value };
  }
  if (field instanceof HTMLSelectElement && field.multiple) {
    return {
      type: "multi",
      value: Array.from(field.selectedOptions).map((option) => option.value),
    };
  }
  return { type: "text", value: field.value };
};

const setInputValue = (field: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const prototype = field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor?.set) {
    descriptor.set.call(field, value);
    return;
  }
  field.value = value;
};

const setInputChecked = (field: HTMLInputElement, value: boolean) => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
  if (descriptor?.set) {
    descriptor.set.call(field, value);
    return;
  }
  field.checked = value;
};

const dispatchFieldEvents = (field: DraftField) => {
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
};

const applyDraftValue = (field: DraftField, value: DraftValue) => {
  if (document.activeElement === field) return;

  if (value.type === "checked") {
    if (!(field instanceof HTMLInputElement)) return;
    if (field.checked === value.value) return;
    setInputChecked(field, value.value);
    dispatchFieldEvents(field);
    return;
  }

  if (value.type === "multi") {
    if (!(field instanceof HTMLSelectElement) || !field.multiple) return;
    const current = Array.from(field.selectedOptions).map((option) => option.value);
    const next = value.value;
    if (current.length === next.length && current.every((item, index) => item === next[index])) {
      return;
    }
    Array.from(field.options).forEach((option) => {
      option.selected = next.includes(option.value);
    });
    dispatchFieldEvents(field);
    return;
  }

  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    if (field.value === value.value) return;
    setInputValue(field, value.value);
    dispatchFieldEvents(field);
    return;
  }

  if (field instanceof HTMLSelectElement) {
    if (field.value === value.value) return;
    field.value = value.value;
    dispatchFieldEvents(field);
  }
};

export const useAutoFormDraftPersistence = (scopeKey?: string) => {
  const location = useLocation();
  const routeKey = `${scopeKey ?? "anonymous"}:${location.pathname}`;
  const storeRef = useRef<DraftStore>({});
  const saveTimeoutRef = useRef<number | null>(null);
  const canRestoreRef = useRef(true);

  useEffect(() => {
    storeRef.current = readStore();
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = getDraftRoot();

    const getRouteDraft = () => {
      const current = storeRef.current[routeKey];
      if (current) return current;
      const created: RouteDraft = { updatedAt: Date.now(), values: {} };
      storeRef.current[routeKey] = created;
      return created;
    };

    const saveSnapshot = () => {
      const draft = getRouteDraft();
      const fields = getDraftFields(root);
      fields.forEach((field) => {
        const key = buildFieldPath(field, root);
        draft.values[key] = serializeFieldValue(field);
      });
      draft.updatedAt = Date.now();
      writeStore(storeRef.current);
    };

    const restoreSnapshot = () => {
      const draft = storeRef.current[routeKey];
      if (!draft) return;
      const fields = getDraftFields(root);
      fields.forEach((field) => {
        const key = buildFieldPath(field, root);
        const savedValue = draft.values[key];
        if (!savedValue) return;
        applyDraftValue(field, savedValue);
      });
    };

    const scheduleSave = () => {
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = window.setTimeout(() => {
        saveSnapshot();
        saveTimeoutRef.current = null;
      }, SAVE_DEBOUNCE_MS);
    };

    const handleInput = (event: Event) => {
      if (!isEligibleField(event.target as Element)) return;
      canRestoreRef.current = false;
      scheduleSave();
    };

    const handleSubmit = () => {
      canRestoreRef.current = false;
      window.setTimeout(() => {
        saveSnapshot();
      }, 0);
    };

    const handlePointerDown = () => {
      canRestoreRef.current = false;
    };

    const handlePageHide = () => {
      saveSnapshot();
    };

    root.addEventListener("input", handleInput, true);
    root.addEventListener("change", handleInput, true);
    root.addEventListener("submit", handleSubmit, true);
    root.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handlePageHide);

    restoreSnapshot();
    window.setTimeout(restoreSnapshot, 200);
    window.setTimeout(restoreSnapshot, 700);
    window.setTimeout(() => {
      canRestoreRef.current = false;
    }, INITIAL_RESTORE_WINDOW_MS);
    const intervalId = window.setInterval(saveSnapshot, SNAPSHOT_INTERVAL_MS);

    return () => {
      saveSnapshot();
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      window.clearInterval(intervalId);
      root.removeEventListener("input", handleInput, true);
      root.removeEventListener("change", handleInput, true);
      root.removeEventListener("submit", handleSubmit, true);
      root.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handlePageHide);
    };
  }, [routeKey]);
};
