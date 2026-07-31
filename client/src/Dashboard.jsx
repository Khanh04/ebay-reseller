import { useEffect, useRef, useState } from 'react'

function Dashboard() {
  const [client, setClient] = useState(null)
  const [runs, setRuns] = useState([])
  const [settingsForm, setSettingsForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
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
        })
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
    })
    setSaving(false)
  }

  async function runNow() {
    setRunning(true)
    const res = await fetch('/api/dashboard/run', { method: 'POST' })
    const run = await res.json()
    setRuns((prev) => [
      { id: run.runId, status: run.status, started_at: run.started_at, finished_at: null, log: '' },
      ...prev,
    ])
    pollRuns()
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

          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Run</h2>
        <button className="run" type="button" onClick={runNow} disabled={running}>
          {running ? 'Running…' : 'Run now'}
        </button>
      </section>

      <section className="card">
        <h2>Run history</h2>
        <table>
          <tr>
            <th>Started</th>
            <th>Status</th>
            <th>Log</th>
          </tr>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>{new Date(run.started_at).toLocaleString()}</td>
              <td className={`status-${run.status}`}>{run.status}</td>
              <td>
                <pre className="run-log">{run.log}</pre>
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
