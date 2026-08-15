#!/usr/bin/env node
/**
 * Headless screenshots of the studio surfaces.
 * Usage: node scripts/shot-ui.mjs <outdir> [round]
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
let playwrightMod
try {
  playwrightMod = await import('playwright')
} catch {
  const resolved = require.resolve('playwright', {
    paths: [
      process.env.PLAYWRIGHT_HOME,
      '/home/neo/.local/share/mise/installs/npm-playwright/1.62.1/node_modules',
    ].filter(Boolean),
  })
  playwrightMod = await import(pathToFileURL(resolved).href)
}
const { chromium } = playwrightMod
import fs from 'node:fs'
import path from 'node:path'

const out = process.argv[2] || path.resolve('shots')
const round = process.argv[3] || 'r'
const base = process.env.QORLITH_UI || 'http://127.0.0.1:5173'
const project = process.env.QORLITH_SHOT_PROJECT || 'neon_harbor_34'

fs.mkdirSync(out, { recursive: true })

const pages = [
  ['home', '/studio'],
  ['plan', `/studio/${project}/plan`],
  ['make', `/studio/${project}/make`],
  ['board', `/studio/${project}/board`],
  ['watch', `/studio/${project}/watch`],
  ['media', '/media'],
  ['train', '/train'],
]

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: 'dark',
})
const page = await context.newPage()

async function waitReady() {
  await page.waitForTimeout(1400)
}

for (const [name, url] of pages) {
  await page.goto(base + url, { waitUntil: 'domcontentloaded', timeout: 20000 })
  await waitReady()
  const dest = path.join(out, `${round}-${name}.png`)
  await page.screenshot({ path: dest, fullPage: false })
  console.log(dest)
}

// New project modal on home
await page.goto(base + '/studio', { waitUntil: 'domcontentloaded', timeout: 20000 })
await waitReady()
const plus = page.getByRole('button', { name: 'New project' }).first()
if (await plus.count()) {
  await plus.click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(out, `${round}-new-project.png`), fullPage: false })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
}

const activity = page.getByRole('button', { name: 'Activity' }).first()
if (await activity.count()) {
  await activity.click({ force: true })
  await page.getByRole('heading', { name: 'Activity' }).waitFor({ timeout: 4000 }).catch(() => {})
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(out, `${round}-activity.png`), fullPage: false })
}

await browser.close()
