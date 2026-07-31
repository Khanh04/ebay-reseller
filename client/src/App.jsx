import { useEffect, useState } from 'react'
import Login from './Login.jsx'
import Dashboard from './Dashboard.jsx'

function App() {
  const [authenticated, setAuthenticated] = useState(null)

  useEffect(() => {
    fetch('/api/session')
      .then((res) => res.json())
      .then((data) => setAuthenticated(data.authenticated))
      .catch(() => setAuthenticated(false))
  }, [])

  if (authenticated === null) return null
  return authenticated ? <Dashboard /> : <Login />
}

export default App
