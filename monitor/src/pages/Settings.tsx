import { useEffect, useState } from 'react'
import { api, errorMessage, type Config } from '../lib/api'
import { FailNote } from '../components/FailNote'

function listField(
  label: string,
  value: string[],
  onChange: (v: string[]) => void,
  locked: boolean,
) {
  return (
    <label className="block space-y-2">
      <span className="text-[13px] text-ghost">
        {label}
        {locked ? ' · locked in qorlith.yaml' : ''}
      </span>
      <textarea
        className="field min-h-[88px] text-[13px] font-mono"
        value={value.join('\n')}
        disabled={locked}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
      />
    </label>
  )
}

export function Settings() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)

  useEffect(() => {
    api
      .config()
      .then(setCfg)
      .catch((e) => setErr(e))
  }, [])

  const save = async () => {
    if (!cfg) return
    try {
      const next = await api.saveConfig(cfg)
      setCfg(next)
      setMsg('Config saved')
      setErr(null)
      setTimeout(() => setMsg(null), 2000)
    } catch (e) {
      setErr(e)
    }
  }

  if (!cfg) {
    return <div className="text-sm text-ghost">{err ? errorMessage(err) : 'Loading config…'}</div>
  }

  return (
    <div className="space-y-6">
      <p className="page-lead">
        Folders to watch. Anything already set in qorlith.yaml is locked — edit that file.
        Model names always live in the yaml.
      </p>

      <div className="space-y-4">
        {listField(
          'Output roots (LoRA checkpoints)',
          cfg.outputRoots,
          (outputRoots) => setCfg({ ...cfg, outputRoots }),
          Boolean(cfg.yamlOwned?.outputRoots),
        )}
        {listField(
          'Log roots',
          cfg.logRoots,
          (logRoots) => setCfg({ ...cfg, logRoots }),
          Boolean(cfg.yamlOwned?.logRoots),
        )}
        {listField(
          'ComfyUI output roots',
          cfg.comfyOutputRoots,
          (comfyOutputRoots) => setCfg({ ...cfg, comfyOutputRoots }),
          Boolean(cfg.yamlOwned?.comfyOutputRoots),
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-2">
            <span className="text-[13px] text-ghost">Active window (minutes)</span>
            <input
              type="number"
              className="field"
              value={cfg.activeWindowMinutes}
              disabled={Boolean(cfg.yamlOwned?.activeWindowMinutes)}
              onChange={(e) =>
                setCfg({ ...cfg, activeWindowMinutes: Number(e.target.value) || 15 })
              }
            />
          </label>
          <label className="block space-y-2">
            <span className="text-[13px] text-ghost">Poll seconds</span>
            <input
              type="number"
              className="field"
              value={cfg.pollSeconds}
              onChange={(e) => setCfg({ ...cfg, pollSeconds: Number(e.target.value) || 2 })}
            />
          </label>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button type="button" onClick={save} className="btn btn-primary">
            Save
          </button>
          {msg ? <span className="text-xs text-cyan">{msg}</span> : null}
          <FailNote error={err} />
        </div>
      </div>
    </div>
  )
}
