/**
 * monitor/data/config.json — watch roots and local overrides.
 * Models and Comfy paths belong in qorlith.yaml.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadStudio } from './studioConfig.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '..')
export const CONFIG_PATH = process.env.QORLITH_CONFIG || path.join(ROOT, 'data', 'config.json')
export const ARCHIVE_PATH =
  process.env.QORLITH_GALLERY_ARCHIVE || path.join(ROOT, 'data', 'gallery-archive.json')

function readJsonConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const ex = path.join(ROOT, 'data', 'config.example.json')
    if (fs.existsSync(ex)) {
      fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
      fs.copyFileSync(ex, CONFIG_PATH)
    } else {
      return {}
    }
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {}
  } catch {
    return {}
  }
}

function asList(value) {
  if (!Array.isArray(value)) return []
  return value.map((v) => String(v || '').trim()).filter(Boolean)
}

function yamlLists() {
  const studio = loadStudio()
  return {
    outputRoots: asList(studio.train?.output_roots),
    logRoots: asList(studio.train?.log_roots),
    comfyOutputRoots: asList(
      studio.comfy?.gallery_roots || (studio.comfy?.output ? [studio.comfy.output] : []),
    ),
  }
}

/** Which watch fields qorlith.yaml already owns (Settings must not overwrite). */
export function yamlOwnedFields() {
  const lists = yamlLists()
  const studio = loadStudio()
  return {
    outputRoots: lists.outputRoots.length > 0,
    logRoots: lists.logRoots.length > 0,
    comfyOutputRoots: lists.comfyOutputRoots.length > 0,
    activeWindowMinutes: studio.train?.active_window_minutes != null,
  }
}

/**
 * Watch roots: yaml wins when set. Tests and leftover local paths still
 * live in config.json (QORLITH_CONFIG). Models never come from json.
 */
export function loadConfig() {
  const studio = loadStudio()
  const json = readJsonConfig()
  const lists = yamlLists()
  return {
    outputRoots: lists.outputRoots.length ? lists.outputRoots : asList(json.outputRoots),
    logRoots: lists.logRoots.length ? lists.logRoots : asList(json.logRoots),
    trainLogGlobs: asList(json.trainLogGlobs),
    comfyOutputRoots: lists.comfyOutputRoots.length
      ? lists.comfyOutputRoots
      : asList(json.comfyOutputRoots),
    pollSeconds: Number(json.pollSeconds) || 2,
    activeWindowMinutes:
      Number(studio.train?.active_window_minutes) || Number(json.activeWindowMinutes) || 15,
    yamlOwned: yamlOwnedFields(),
  }
}

/** Persist only json-owned overlay fields. Never write yaml-won roots or models. */
export function saveConfig(incoming = {}) {
  const owned = yamlOwnedFields()
  const json = readJsonConfig()
  const next = { ...json }
  if (!owned.outputRoots) next.outputRoots = asList(incoming.outputRoots)
  if (!owned.logRoots) next.logRoots = asList(incoming.logRoots)
  if (!owned.comfyOutputRoots) next.comfyOutputRoots = asList(incoming.comfyOutputRoots)
  if (!owned.activeWindowMinutes && incoming.activeWindowMinutes != null) {
    next.activeWindowMinutes = Number(incoming.activeWindowMinutes) || 15
  }
  if (incoming.pollSeconds != null) next.pollSeconds = Number(incoming.pollSeconds) || 2
  if (incoming.trainLogGlobs) next.trainLogGlobs = asList(incoming.trainLogGlobs)
  delete next.director
  delete next.producePipelines
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8')
  return loadConfig()
}
