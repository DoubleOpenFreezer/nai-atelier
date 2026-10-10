import type { LocalGenItem, ImageEditMetadata } from '../types';
import type { ImageEditFocusedGeometry } from '../services/imageEdit';
import type { GenerationTasks } from './generationTasks.mjs';

export type GenerationJobState = 'waiting' | 'preparing' | 'generating' | 'saving' | 'paused' | 'awaiting_confirmation' | 'succeeded' | 'cancelled' | 'failed';
export interface GenerationJobDescriptor {
  payload: { model: string; action: 'generate' | 'img2img' | 'infill'; parameters: Record<string, unknown>; input?: string };
  history: Pick<LocalGenItem, 'prompt' | 'negativePrompt' | 'params'> & Partial<Pick<LocalGenItem, 'basePrompt' | 'subjectPrompt' | 'modules' | 'sourceChainId' | 'sourceChainName' | 'sourceChainType'>> & { edit?: ImageEditMetadata };
  composition?: { originalImage: string; compositeMask: string; focusedGeometry?: ImageEditFocusedGeometry };
  editMask?: string;
  randomSeed: boolean;
  stream: boolean;
  approvedCost: number;
}
export interface GenerationJobSnapshot {
  token: string; state: GenerationJobState; completedCount: number; requestedCount: number;
  historyIds: string[]; position?: number; lastSavedItem?: LocalGenItem;
  preview?: { image: string; step?: number }; cost?: number; error?: string; code?: string;
  accountingFailed?: boolean; cleanupError?: string;
}
export interface GenerationJobOutput {
  seed?: number; estimatedCost?: number; accountingFailed?: boolean; cleanupError?: string; queueTaskId?: string;
}
export type GenerationJobHistoryMetadata = Omit<LocalGenItem, 'imageUrl'>;
export interface GenerationJob<Context> {
  key: string; token: string; count: number; placement?: 'end' | 'next'; descriptor: GenerationJobDescriptor;
  context: Context; state: GenerationJobState; historyIds: string[]; approvedCost: number; cancelled: boolean;
  running: Promise<void>; lastSavedItem?: LocalGenItem; lastQueueTaskId?: string;
}
export class GenerationJobs<Context = unknown, Output extends GenerationJobOutput = GenerationJobOutput> {
  constructor(options: {
    tasks: GenerationTasks;
    generate: (job: GenerationJob<Context>, payload: GenerationJobDescriptor['payload'], onPreview: (preview: { image: string; step?: number }) => void) => Promise<Output>;
    save: (job: GenerationJob<Context>, output: Output, history: GenerationJobHistoryMetadata) => Promise<LocalGenItem>;
    estimate: (job: GenerationJob<Context>, fresh: boolean) => Promise<number>;
    validate: (descriptor: GenerationJobDescriptor) => void;
    readCleanup: (job: GenerationJob<Context>) => string | undefined;
    now?: () => number; sleep?: (milliseconds: number) => Promise<void>; terminalMs?: number; terminalLimit?: number;
  });
  jobs: Map<string, GenerationJob<Context>>;
  has(key: string, token: string): boolean;
  get(key: string, token: string): GenerationJob<Context>;
  snapshot(job: GenerationJob<Context>): GenerationJobSnapshot;
  start(key: string, token: string, count: number, placement: 'end' | 'next' | undefined, descriptor: GenerationJobDescriptor, context: Context): GenerationJobSnapshot;
  cancel(key: string, token: string): GenerationJobSnapshot;
  approve(key: string, token: string, approvedCost: number): GenerationJobSnapshot;
  close(): void;
}
