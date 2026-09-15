import type { DocumentFile } from '@workbench/core';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...init?.headers,
    },
  });
  const body = await response.json();
  if (!response.ok)
    throw new ApiError(body.error || "请求失败", response.status, body);
  return body as T;
}

export interface SampleProperty {
  id: string;
  object_id: string;
  property_id: string;
  object_name: string;
  property_name: string;
  value_text: string;
  block_id: string;
  source_line: number;
}

export interface SampleRow {
  document?: Pick<DocumentFile, "head">;
  id: string;
  code: string;
  title: string;
  contentVersion: number;
  extractionStatus: string;
  createdAt: string;
  properties: SampleProperty[];
}
