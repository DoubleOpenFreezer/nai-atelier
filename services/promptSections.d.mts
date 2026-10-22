import type { PromptSections } from '../types';
export type PromptSectionKey = 'appearance' | 'wardrobe' | 'pose' | 'scene' | 'camera' | 'extra';
export const PROMPT_SECTION_FIELDS: { key: PromptSectionKey; label: string }[];
export const PROMPT_SECTION_KEYS: PromptSectionKey[];
export const PERSON_SECTION_KEYS: ('appearance' | 'wardrobe' | 'pose')[];
export const CHARACTER_SECTION_FIELDS: { key: 'appearance' | 'wardrobe' | 'pose' | 'expression'; label: string }[];
export function mergePromptSectionText(sections?: Partial<PromptSections> | null): string;
export function resolvePromptSectionText(sections: Partial<PromptSections> | null | undefined, subject?: string): Record<PromptSectionKey, string>;
export function writePromptSections(sections: Partial<PromptSections> | null | undefined, subject: string, patch: Partial<Record<PromptSectionKey, string>>): { sections: PromptSections; subject: string; written: PromptSectionKey[] };
