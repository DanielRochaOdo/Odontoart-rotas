const PROFILES_UPDATED_EVENT = "profiles-updated";
const STORAGE_KEY = "profilesUpdatedAt";

export const emitProfilesUpdated = () => {
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(PROFILES_UPDATED_EVENT));
};

export const onProfilesUpdated = (handler: () => void) => {
  const storageHandler = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) handler();
  };

  window.addEventListener(PROFILES_UPDATED_EVENT, handler);
  window.addEventListener("storage", storageHandler);

  return () => {
    window.removeEventListener(PROFILES_UPDATED_EVENT, handler);
    window.removeEventListener("storage", storageHandler);
  };
};
