import {
  ChapterAutomation,
  ChapterAutomationRunSummary,
  ChapterAutomationSource,
  ChapterAutomationTestResult,
  ChapterAutomationValidation,
} from '@/lib/types';
import { invokeAuthenticatedFunction } from '@/lib/supabase';

interface ChapterAutomationResponse {
  success?: boolean;
  message?: string;
  automation?: ChapterAutomation;
  automations?: ChapterAutomation[];
  validation?: ChapterAutomationValidation;
  recentRuns?: ChapterAutomationRunSummary[];
  testResults?: ChapterAutomationTestResult[];
}

export interface ChapterAutomationUpsertInput {
  mangaId: string;
  source: ChapterAutomationSource;
  sourceUrl: string;
  checkTimes: string[];
  isActive: boolean;
}

const ensureSuccess = (response: ChapterAutomationResponse | null | undefined, fallbackMessage: string) => {
  if (!response?.success) {
    throw new Error(response?.message || fallbackMessage);
  }
};

export const listChapterAutomations = async () => {
  const response = await invokeAuthenticatedFunction<ChapterAutomationResponse>('admin-chapter-automation', {
    action: 'list',
  });

  ensureSuccess(response, 'CHAPTER_AUTOMATIONS_LIST_FAILED');

  return {
    automations: Array.isArray(response?.automations) ? response.automations : [],
    recentRuns: Array.isArray(response?.recentRuns) ? response.recentRuns : [],
  };
};

export const validateChapterAutomation = async (source: ChapterAutomationSource, sourceUrl: string) => {
  const response = await invokeAuthenticatedFunction<ChapterAutomationResponse>('admin-chapter-automation', {
    action: 'validate',
    source,
    sourceUrl,
  });

  ensureSuccess(response, 'CHAPTER_AUTOMATION_VALIDATE_FAILED');
  return response.validation as ChapterAutomationValidation;
};

export const testChapterAutomations = async (automationIds?: string[]) => {
  const response = await invokeAuthenticatedFunction<ChapterAutomationResponse>('admin-chapter-automation', {
    action: 'test',
    automationIds: automationIds || [],
  });

  ensureSuccess(response, 'CHAPTER_AUTOMATION_TEST_FAILED');

  return {
    automations: Array.isArray(response?.automations) ? response.automations : [],
    testResults: Array.isArray(response?.testResults) ? response.testResults : [],
  };
};

export const createChapterAutomation = async (payload: ChapterAutomationUpsertInput) => {
  const response = await invokeAuthenticatedFunction<ChapterAutomationResponse>('admin-chapter-automation', {
    action: 'create',
    payload,
  });

  ensureSuccess(response, 'CHAPTER_AUTOMATION_CREATE_FAILED');
  return response.automation as ChapterAutomation;
};

export const updateChapterAutomation = async (automationId: string, payload: ChapterAutomationUpsertInput) => {
  const response = await invokeAuthenticatedFunction<ChapterAutomationResponse>('admin-chapter-automation', {
    action: 'update',
    automationId,
    payload,
  });

  ensureSuccess(response, 'CHAPTER_AUTOMATION_UPDATE_FAILED');
  return response.automation as ChapterAutomation;
};

export const deleteChapterAutomation = async (automationId: string) => {
  const response = await invokeAuthenticatedFunction<ChapterAutomationResponse>('admin-chapter-automation', {
    action: 'delete',
    automationId,
  });

  ensureSuccess(response, 'CHAPTER_AUTOMATION_DELETE_FAILED');
};

export const setChapterAutomationActive = async (automationId: string, isActive: boolean) => {
  const response = await invokeAuthenticatedFunction<ChapterAutomationResponse>('admin-chapter-automation', {
    action: 'set-active',
    automationId,
    isActive,
  });

  ensureSuccess(response, 'CHAPTER_AUTOMATION_STATUS_FAILED');
  return response.automation as ChapterAutomation;
};
