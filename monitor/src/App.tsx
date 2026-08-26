import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Gallery } from './pages/Gallery'
import { RunDetail } from './pages/RunDetail'
import { Training } from './pages/Training'
import { StudioPlanner } from './pages/StudioPlanner'
import { EpisodePlan } from './pages/EpisodePlan'
import { Brain } from './pages/Brain'
import { Watch } from './pages/Watch'
import { StudioHome } from './pages/StudioHome'
import { Archive } from './pages/Archive'
import { projectPath, readLastProject, type StudioStage } from './lib/studio'

function HomeRedirect() {
  const last = readLastProject()
  return <Navigate to={last ? projectPath(last) : '/studio'} replace />
}

function StageRedirect({ to }: { to: StudioStage }) {
  const { projectId } = useParams()
  if (!projectId) return <Navigate to="/studio" replace />
  return <Navigate to={projectPath(projectId, to)} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomeRedirect />} />
          <Route path="studio" element={<StudioHome />} />
          <Route path="studio/:projectId" element={null} />
          <Route path="studio/:projectId/plan" element={<StudioPlanner />} />
          <Route path="studio/:projectId/make" element={<Brain />} />
          <Route path="studio/:projectId/board" element={<EpisodePlan />} />
          <Route path="studio/:projectId/watch" element={<Watch />} />
          <Route path="studio/:projectId/brain" element={<StageRedirect to="make" />} />
          <Route path="studio/:projectId/run" element={<StageRedirect to="watch" />} />
          <Route path="archive" element={<Archive />} />
          <Route path="media" element={<Gallery />} />
          <Route path="train" element={<Training />} />
          <Route path="train/runs/:id" element={<RunDetail />} />
          <Route path="settings" element={null} />
          <Route path="*" element={<HomeRedirect />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
