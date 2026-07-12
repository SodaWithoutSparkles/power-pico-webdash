import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import 'uplot/dist/uPlot.min.css'
import './index.css'
import { ErrorBoundary } from './ErrorBoundary'

ReactDOM.createRoot(document.getElementById('app')!).render(
    <React.StrictMode>
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    </React.StrictMode>,
)
