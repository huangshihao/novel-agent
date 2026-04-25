import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { App } from './App'
import { NovelListPage } from './pages/NovelListPage'
import { NovelDetailPage } from './pages/NovelDetailPage'
import { RewritePage } from './pages/RewritePage'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
  },
})

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <NovelListPage /> },
      { path: 'novels/:id', element: <NovelDetailPage /> },
      { path: 'novels/:id/rewrite', element: <RewritePage /> },
    ],
  },
])

const root = document.getElementById('root')
if (!root) throw new Error('root element not found')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
