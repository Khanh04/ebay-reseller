import { useEffect, useState } from 'react'

function Login() {
  const [authError, setAuthError] = useState(null)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const error = params.get('authError')
    if (error) {
      setAuthError(error)
      history.replaceState(null, '', location.pathname)
    }
  }, [])

  return (
    <div className="page centered">
      <div className="card centered">
        <h1>eBay Reseller</h1>
        {authError && <p className="error-banner">{authError}</p>}
        <p>Connect your eBay account to manage automated relisting.</p>
        <a className="button" href="/auth/ebay/start">
          Sign in with eBay
        </a>
      </div>
    </div>
  )
}

export default Login
