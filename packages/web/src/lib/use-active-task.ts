import { useQuery } from '@tanstack/react-query'
import type { ActiveTask } from '@novel-agent/shared'
import { agentApi } from './agent-api.js'

export function useActiveTask(novelId: string) {
  return useQuery<ActiveTask | null>({
    queryKey: ['agent-active', novelId],
    queryFn: () => agentApi.getActive(novelId),
    refetchInterval: 3_000,
  })
}
