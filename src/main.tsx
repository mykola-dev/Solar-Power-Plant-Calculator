import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import './index.css'
import '@mantine/core/styles.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider
      forceColorScheme="dark"
      theme={{
        fontFamily: 'Manrope, Segoe UI, sans-serif',
        headings: { fontFamily: 'Space Grotesk, Manrope, sans-serif' },
        primaryColor: 'cyan',
        defaultRadius: 'md',
      }}
    >
      <App />
    </MantineProvider>
  </StrictMode>,
)
