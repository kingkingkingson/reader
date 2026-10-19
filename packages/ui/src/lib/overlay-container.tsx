import { createContext, useContext, type RefObject } from "react";

export type OverlayContainer =
  HTMLElement | ShadowRoot | RefObject<HTMLElement | ShadowRoot | null> | null;

/** Where menus and dialogs portal, so a hidden reader tab can hide them too. */
export const OverlayContainerContext = createContext<OverlayContainer>(null);

export function useOverlayContainer() {
  return useContext(OverlayContainerContext);
}

export function useOverlayPortal() {
  const container = useOverlayContainer();
  return container ? { container } : {};
}
