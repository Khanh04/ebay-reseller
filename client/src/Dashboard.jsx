import { useEffect, useRef, useState } from 'react'

function itemLabel({ itemId, title }, env) {
  const label = title ? `${title} (${itemId})` : itemId
  if (env !== 'production') return label
  return (
    <a href={`https://www.ebay.com/itm/${itemId}`} target="_blank" rel="noreferrer">
      {label}
    </a>
  )
}

function Dashboard() {
  const [client, setClient] = useState(null)
  const [runs, setRuns] = useState([])
  const [settingsForm, setSettingsForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState(null)
  const [previewResult, setPreviewResult] = useState(null)
  const pollRef = useRef(null)

  useEffect(() => {
    fetch('/api/dashboard')
      .then((res) => res.json())
      .then((data) => {
        setClient(data.client)
        setRuns(data.runs)
        setSettingsForm({
          item_limit: data.client.item_limit,
          keywords: data.client.keywords.join(', '),
          days_left_threshold: data.client.days_left_threshold,
          max_views: data.client.max_views,
          max_sold_count: data.client.max_sold_count,
          schedule_hours: data.client.schedule_hours,
        })
        if (data.runs[0]?.status === 'running') {
          setRunning(true)
          pollRuns()
        }
      })
    return () => clearInterval(pollRef.current)
  }, [])

  function pollRuns() {
    clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const res = await fetch('/api/runs')
      const data = await res.json()
      setRuns(data.runs)
      if (data.runs[0]?.status !== 'running') {
        clearInterval(pollRef.current)
        setRunning(false)
      }
    }, 3000)
  }

  async function saveSettings(e) {
    e.preventDefault()
    setSaving(true)
    const res = await fetch('/api/dashboard/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settingsForm),
    })
    const data = await res.json()
    setClient((c) => ({ ...c, ...data.client }))
    setSettingsForm({
      item_limit: data.client.item_limit,
      keywords: data.client.keywords.join(', '),
      days_left_threshold: data.client.days_left_threshold,
      max_views: data.client.max_views,
      schedule_hours: data.client.schedule_hours,
    })
    setSaving(false)
  }

  async function runNow() {
    setRunError(null)
    setRunning(true)
    const res = await fetch('/api/dashboard/run', { method: 'POST' })
    if (res.status === 409) {
      setRunning(false)
      setRunError('A run is already in progress.')
      return
    }
    const run = await res.json()
    setRuns((prev) => [
      { id: run.runId, status: run.status, started_at: run.started_at, finished_at: null, log: '', result: { ended: [], resold: [] } },
      ...prev,
    ])
    pollRuns()
  }

  async function preview() {
    setPreviewResult({ loading: true })
    try {
      const res = await fetch('/api/dashboard/preview', { method: 'POST' })
      if (!res.ok) throw new Error('preview_failed')
      const data = await res.json()
      setPreviewResult({ loading: false, ended: data.ended, log: data.log })
    } catch {
      setPreviewResult({ loading: false, ended: [], log: '', error: 'Preview failed. Try again.' })
    }
  }

  async function disconnect() {
    if (!confirm("Permanently delete your account and all stored data? This can't be undone.")) return
    await fetch('/api/dashboard/disconnect', { method: 'POST' })
    window.location.href = '/'
  }

  async function logout() {
    await fetch('/api/logout', { method: 'POST' })
    window.location.href = '/'
  }

  if (!client) return null

  return (
    <div className="page">
      <div className="page-header">
        <h1>eBay Reseller</h1>
        <button type="button" className="link" onClick={logout}>
          Log out
        </button>
      </div>
      <p>
        Connected as <strong>{client.ebay_username}</strong> ({client.ebay_env})
      </p>

      <section className="card">
        <h2>Settings</h2>
        <form onSubmit={saveSettings}>
          <label htmlFor="item_limit">Item limit per run</label>
          <input
            type="number"
            id="item_limit"
            min="1"
            value={settingsForm.item_limit}
            onChange={(e) => setSettingsForm({ ...settingsForm, item_limit: e.target.value })}
          />

          <label htmlFor="keywords">Brand keywords (comma-separated, leave blank for all items)</label>
          <textarea
            id="keywords"
            rows="2"
            value={settingsForm.keywords}
            onChange={(e) => setSettingsForm({ ...settingsForm, keywords: e.target.value })}
          />

          <label htmlFor="days_left_threshold">End listings with fewer than this many days left</label>
          <input
            type="number"
            id="days_left_threshold"
            min="1"
            value={settingsForm.days_left_threshold}
            onChange={(e) => setSettingsForm({ ...settingsForm, days_left_threshold: e.target.value })}
          />

          <label htmlFor="max_views">End listings with this many views or fewer</label>
          <input
            type="number"
            id="max_views"
            min="0"
            value={settingsForm.max_views}
            onChange={(e) => setSettingsForm({ ...settingsForm, max_views: e.target.value })}
          />

          <label htmlFor="max_sold_count">End listings with this many sales or fewer</label>
          <input
            type="number"
            id="max_sold_count"
            min="0"
            value={settingsForm.max_sold_count}
            onChange={(e) => setSettingsForm({ ...settingsForm, max_sold_count: e.target.value })}
          />

          <label htmlFor="schedule_hours">Run automatically</label>
          <select
            id="schedule_hours"
            value={settingsForm.schedule_hours}
            onChange={(e) => setSettingsForm({ ...settingsForm, schedule_hours: e.target.value })}
          >
            <option value="0">Off</option>
            <option value="12">Every 12 hours</option>
            <option value="24">Daily</option>
            <option value="72">Every 3 days</option>
            <option value="168">Weekly</option>
          </select>
          {client.schedule_hours > 0 && client.next_run_at && (
            <p>Next scheduled run: {new Date(client.next_run_at).toLocaleString()}</p>
          )}

          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Run</h2>
        <button className="run" type="button" onClick={runNow} disabled={running}>
          {running ? 'Running…' : 'Run now'}
        </button>{' '}
        <button type="button" onClick={preview} disabled={previewResult?.loading}>
          {previewResult?.loading ? 'Checking…' : 'Preview'}
        </button>
        {runError && <p className="error-banner">{runError}</p>}
        {previewResult && !previewResult.loading && (
          <div>
            {previewResult.error ? (
              <p className="error-banner">{previewResult.error}</p>
            ) : previewResult.ended.length === 0 ? (
              <p>No listings currently match your settings.</p>
            ) : (
              <>
                <p>{previewResult.ended.length} listing(s) would be ended and relisted:</p>
                <ul>
                  {previewResult.ended.map((item) => (
                    <li key={item.itemId}>
                      {itemLabel(item, client.ebay_env)} {item.brand && `— ${item.brand}`}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {previewResult.log && (
              <details>
                <summary>Show details</summary>
                <pre className="run-log">{previewResult.log}</pre>
              </details>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Run history</h2>
        <table>
          <tr>
            <th>Started</th>
            <th>Status</th>
            <th>Details</th>
          </tr>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>{new Date(run.started_at).toLocaleString()}</td>
              <td className={`status-${run.status}`}>{run.status}</td>
              <td>
                <details>
                  <summary>
                    {run.result?.ended?.length
                      ? `Ended ${run.result.ended.length}, resold ${run.result.resold?.length ?? 0}`
                      : 'Details'}
                  </summary>
                  {run.result?.ended?.length > 0 && (
                    <>
                      <strong>Ended</strong>
                      <ul>
                        {run.result.ended.map((item) => (
                          <li key={item.itemId}>{itemLabel(item, client.ebay_env)}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {run.result?.resold?.length > 0 && (
                    <>
                      <strong>Resold</strong>
                      <ul>
                        {run.result.resold.map((item) => (
                          <li key={item.newItemId}>
                            {item.title} → {itemLabel({ itemId: item.newItemId }, client.ebay_env)}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  <details>
                    <summary>Show raw log</summary>
                    <pre className="run-log">{run.log}</pre>
                  </details>
                </details>
              </td>
            </tr>
          ))}
          {runs.length === 0 && (
            <tr>
              <td colSpan="3">No runs yet.</td>
            </tr>
          )}
        </table>
      </section>

      <section className="card">
        <h2>Disconnect</h2>
        <p>
          Disconnecting permanently deletes everything we store about you: your encrypted eBay token, your
          settings, and your run history. This can't be undone — you'd need to sign in with eBay again to
          reconnect.
        </p>
        <button className="danger" type="button" onClick={disconnect}>
          Disconnect and delete my data
        </button>
      </section>
    </div>
  )
}

export default Dashboard
