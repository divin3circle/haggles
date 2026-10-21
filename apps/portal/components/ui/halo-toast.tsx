"use client";

/**
 * Global toast dispatcher and `<HaloToaster />` viewport built on {@link HaloPolishedNotification}.
 *
 * Allows any Portal component or action handler to trigger `haloToast.success(...)`,
 * `haloToast.error(...)`, or `haloToast.info(...)` without prop drilling.
 */

import { AnimatePresence } from "motion/react";
import * as React from "react";
import {
  HaloPolishedNotification,
  type RimVariant,
} from "@/components/ui/halo-notification";

/**
 * Payload for a queued Halo toast notification.
 */
export interface HaloToastItem {
  id: string;
  title: string;
  description?: string | undefined;
  rimVariant?: RimVariant | undefined;
  politeness?: "status" | "alert" | undefined;
  durationMs?: number | undefined;
}

type ToastListener = (items: ReadonlyArray<HaloToastItem>) => void;

const MAX_VISIBLE_TOASTS = 3;
const DEFAULT_TOAST_DURATION_MS = 4200;

let toastsState: HaloToastItem[] = [];
const listeners = new Set<ToastListener>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
  const snapshot = [...toastsState];
  for (const listener of listeners) {
    listener(snapshot);
  }
}

function dismissToast(id?: string): void {
  if (!id) {
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    timers.clear();
    toastsState = [];
    emit();
    return;
  }

  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  toastsState = toastsState.filter((item) => item.id !== id);
  emit();
}

function enqueueToast(input: Omit<HaloToastItem, "id"> & { id?: string }): string {
  const id = input.id ?? `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const item: HaloToastItem = {
    id,
    title: input.title,
    description: input.description,
    rimVariant: input.rimVariant ?? "default",
    politeness:
      input.politeness ?? (input.rimVariant === "destructive" ? "alert" : "status"),
    durationMs: input.durationMs ?? DEFAULT_TOAST_DURATION_MS,
  };

  toastsState = [...toastsState.filter((t) => t.id !== id), item].slice(
    -MAX_VISIBLE_TOASTS,
  );
  emit();

  const existingTimer = timers.get(id);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  if ((item.durationMs ?? DEFAULT_TOAST_DURATION_MS) > 0) {
    timers.set(
      id,
      setTimeout(() => {
        dismissToast(id);
      }, item.durationMs ?? DEFAULT_TOAST_DURATION_MS),
    );
  }

  return id;
}

/**
 * Imperative toast API for triggering {@link HaloPolishedNotification} toasts anywhere in the Portal.
 *
 * @example
 * ```ts
 * haloToast.success("Agent key created", "Copy the secret now — it won't be shown again.");
 * haloToast.error("Daily cap reached", "Raise the limit in Buy → Agent keys.");
 * ```
 */
export const haloToast = Object.assign(
  (options: Omit<HaloToastItem, "id"> & { id?: string }) => enqueueToast(options),
  {
    /**
     * Triggers an emerald `success` rim notification.
     */
    success(title: string, description?: string, durationMs?: number): string {
      return enqueueToast({
        title,
        description,
        rimVariant: "success",
        politeness: "status",
        durationMs,
      });
    },
    /**
     * Triggers a crimson `destructive` rim alert notification.
     */
    error(title: string, description?: string, durationMs?: number): string {
      return enqueueToast({
        title,
        description,
        rimVariant: "destructive",
        politeness: "alert",
        durationMs: durationMs ?? 5500,
      });
    },
    /**
     * Triggers a default spectrum rim notification.
     */
    info(title: string, description?: string, durationMs?: number): string {
      return enqueueToast({
        title,
        description,
        rimVariant: "default",
        politeness: "status",
        durationMs,
      });
    },
    /**
     * Dismisses a specific toast by `id`, or all active toasts when `id` is omitted.
     */
    dismiss(id?: string): void {
      dismissToast(id);
    },
  },
);

/**
 * Global viewport that renders active {@link HaloPolishedNotification} toasts.
 * Mount once inside `RootLayout`.
 *
 * @returns Fixed bottom-right toast stack
 *
 * @example
 * ```tsx
 * <HaloToaster />
 * ```
 */
export function HaloToaster() {
  const [items, setItems] = React.useState<ReadonlyArray<HaloToastItem>>([]);

  React.useEffect(() => {
    setItems([...toastsState]);
    const handleUpdate: ToastListener = (next) => setItems(next);
    listeners.add(handleUpdate);
    return () => {
      listeners.delete(handleUpdate);
    };
  }, []);

  return (
    <div
      aria-label="Notifications"
      className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2.5 sm:right-6 sm:bottom-6"
    >
      <AnimatePresence mode="popLayout">
        {items.map((item) => (
          <HaloPolishedNotification
            key={item.id}
            layout
            className="pointer-events-auto w-full"
            title={item.title}
            description={item.description}
            messageKey={item.id}
            rimVariant={item.rimVariant}
            politeness={item.politeness}
            slideFrom="bottom"
            onDismiss={() => dismissToast(item.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
