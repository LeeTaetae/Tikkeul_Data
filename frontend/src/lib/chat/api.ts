import { createApiClient, type RequestOptions } from '../api/client';
import { API_BASE_URL } from '../config';
import type { ChatTurn } from './conversation';

const client = createApiClient({ baseUrl: API_BASE_URL });

export const chatApi = {
  send: (body: { message: string; history: ChatTurn[]; lat?: number; lon?: number; language: string }, options?: RequestOptions) =>
    client.post<{ reply: string }>('/api/chat', body, options),
};
