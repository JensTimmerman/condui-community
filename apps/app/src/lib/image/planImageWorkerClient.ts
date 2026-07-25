/** Max pixels processed off main thread; larger images fall back to synchronous path. */
const MAX_WORKER_PIXELS = 32_000_000

let workerRef: Worker | null = null
let nextId = 1

export function planImageWorkerSupported(): boolean {
  return typeof Worker !== 'undefined' && typeof createImageBitmap === 'function'
}

function getWorker(): Worker | null {
  if (!planImageWorkerSupported()) return null
  if (!workerRef) {
    try {
      workerRef = new Worker(new URL('../../workers/planImagePixels.worker.ts', import.meta.url), {
        type: 'module',
      })
    } catch {
      workerRef = null
    }
  }
  return workerRef
}

function rasterBufferToPngDataUrl(buffer: ArrayBuffer, width: number, height: number): string {
  const data = new Uint8ClampedArray(buffer)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return ''
  ctx.putImageData(new ImageData(data, width, height), 0, 0)
  return canvas.toDataURL('image/png')
}

function waitForWorkerResponse<T>(
  worker: Worker,
  id: number,
  parse: (d: Record<string, unknown>) => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const onMessage = (ev: MessageEvent) => {
      const d = ev.data as Record<string, unknown>
      if (d?.id !== id) return
      worker.removeEventListener('message', onMessage)
      if (d.type === 'error') {
        reject(new Error(typeof d.message === 'string' ? d.message : 'worker error'))
        return
      }
      try {
        resolve(parse(d))
      } catch (e) {
        reject(e)
      }
    }
    worker.addEventListener('message', onMessage)
  })
}

export async function detectWhiteBackgroundInWorker(
  image: HTMLImageElement,
  threshold: number = 240,
): Promise<boolean> {
  const worker = getWorker()
  if (!worker) {
    return Promise.reject(new Error('no worker'))
  }
  const w = image.naturalWidth || image.width
  const h = image.naturalHeight || image.height
  if (w * h > MAX_WORKER_PIXELS) {
    return Promise.reject(new Error('image too large for worker'))
  }
  const bitmap = await createImageBitmap(image)
  const id = nextId++
  const resultPromise = waitForWorkerResponse(worker, id, (d) => {
    if (d.type !== 'detect' || typeof d.result !== 'boolean') {
      throw new Error('bad worker response')
    }
    return d.result
  })
  worker.postMessage({ type: 'detect', id, bitmap, threshold }, [bitmap])
  return resultPromise
}

export async function removeWhiteBackgroundInWorker(
  image: HTMLImageElement,
  threshold: number = 240,
  tolerance: number = 20,
): Promise<string> {
  const worker = getWorker()
  if (!worker) {
    return Promise.reject(new Error('no worker'))
  }
  const w = image.naturalWidth || image.width
  const h = image.naturalHeight || image.height
  if (w * h > MAX_WORKER_PIXELS) {
    return Promise.reject(new Error('image too large for worker'))
  }
  const bitmap = await createImageBitmap(image)
  const id = nextId++
  const resultPromise = waitForWorkerResponse(worker, id, (d) => {
    if (d.type !== 'raster' || !(d.buffer instanceof ArrayBuffer)) {
      throw new Error('bad worker response')
    }
    const width = d.width as number
    const height = d.height as number
    return rasterBufferToPngDataUrl(d.buffer, width, height)
  })
  worker.postMessage({ type: 'removeWhite', id, bitmap, threshold, tolerance }, [bitmap])
  return resultPromise
}

export async function invertImageColorsInWorker(image: HTMLImageElement): Promise<string> {
  const worker = getWorker()
  if (!worker) {
    return Promise.reject(new Error('no worker'))
  }
  const w = image.naturalWidth || image.width
  const h = image.naturalHeight || image.height
  if (w * h > MAX_WORKER_PIXELS) {
    return Promise.reject(new Error('image too large for worker'))
  }
  const bitmap = await createImageBitmap(image)
  const id = nextId++
  const resultPromise = waitForWorkerResponse(worker, id, (d) => {
    if (d.type !== 'raster' || !(d.buffer instanceof ArrayBuffer)) {
      throw new Error('bad worker response')
    }
    const width = d.width as number
    const height = d.height as number
    return rasterBufferToPngDataUrl(d.buffer, width, height)
  })
  worker.postMessage({ type: 'invert', id, bitmap }, [bitmap])
  return resultPromise
}
