/**
 * Qorlith Monitor API — create the app and listen.
 */
import { fileURLToPath } from 'url'
import path from 'path'
import { createApp } from './http.mjs'
import { loadStudio } from './studioConfig.mjs'
import { info as logInfo } from './log.mjs'
import { startComfyProgress } from './comfyProgress.mjs'

export const app = createApp()

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const PORT = Number(process.env.QORLITH_PORT || loadStudio().monitor?.api_port || 3921)
  app.listen(PORT, '127.0.0.1', () => {
    logInfo('listen', { url: `http://127.0.0.1:${PORT}` })
    startComfyProgress()
  })
}
