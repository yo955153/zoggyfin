/**
 * Questions an extension action asks before it runs: a confirm, a text
 * field, or a choice list. One host at the root shows them
 * (`ExtensionPromptHost`); the action waits for the answer.
 */
import { create } from 'zustand';

export interface ChoiceOption {
  value: string;
  label: string;
}

export type Prompt = { id: number } & (
  | { kind: 'confirm'; title: string; message?: string; action: string; destructive?: boolean; resolve: (ok: boolean) => void }
  | { kind: 'text'; title: string; message?: string; placeholder?: string; initial?: string; resolve: (v: string | null) => void }
  | {
      kind: 'choice';
      title: string;
      message?: string;
      initial?: string;
      load: () => Promise<ChoiceOption[]>;
      resolve: (v: string | null) => void;
    }
);

interface PromptState {
  current: Prompt | null;
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export const usePrompt = create<PromptState>(() => ({ current: null }));

let seq = 0;

function ask<T>(make: (resolve: (v: T) => void) => DistributiveOmit<Prompt, 'id'>): Promise<T> {
  // A new question cancels one that is still open.
  const old = usePrompt.getState().current;
  if (old) (old.resolve as (v: unknown) => void)(old.kind === 'confirm' ? false : null);
  return new Promise<T>((resolve) => {
    let done = false;
    const once = (v: T) => {
      if (done) return;
      done = true;
      usePrompt.setState({ current: null });
      resolve(v);
    };
    usePrompt.setState({ current: { ...make(once), id: ++seq } as Prompt });
  });
}

export function askConfirm(p: { title: string; message?: string; action: string; destructive?: boolean }): Promise<boolean> {
  return ask<boolean>((resolve) => ({ kind: 'confirm', ...p, resolve }));
}

export function askText(p: { title: string; message?: string; placeholder?: string; initial?: string }): Promise<string | null> {
  return ask<string | null>((resolve) => ({ kind: 'text', ...p, resolve }));
}

export function askChoice(p: { title: string; message?: string; initial?: string; load: () => Promise<ChoiceOption[]> }): Promise<string | null> {
  return ask<string | null>((resolve) => ({ kind: 'choice', ...p, resolve }));
}
