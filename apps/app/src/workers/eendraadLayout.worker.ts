/// <reference lib="webworker" />

import { calculateBottomUpLayout, type BottomUpLayoutResult } from '../lib/layout/bottomUpLayout'
import type { ProjectWithOptionalV2Electrical } from '../lib/projectV2/electrical'
import type { Point } from '../types/ui'

type LayoutRequest = {
  type: 'calculate'
  id: number
  project: ProjectWithOptionalV2Electrical
  overrides: Array<[string, Point]>
}

type LayoutResponse =
  | { type: 'result'; id: number; layout: BottomUpLayoutResult }
  | { type: 'error'; id: number; message: string }

const workerScope = self as unknown as DedicatedWorkerGlobalScope

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const request = event.data
  try {
    const layout = calculateBottomUpLayout(request.project, new Map(request.overrides))
    workerScope.postMessage({
      type: 'result',
      id: request.id,
      layout,
    } satisfies LayoutResponse)
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    } satisfies LayoutResponse)
  }
}

export {}
