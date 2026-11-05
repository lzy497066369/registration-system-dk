import { createContext, useContext } from 'react'

export type ActivityItem = {
  id: number
  code: string
  name: string
  company_name?: string
  status: string
  signup_start_at?: string | null
  companion_enabled?: boolean
  companion_max?: number
  remind_hours_before?: number
  home_bg_image?: string
  page_header_image?: string
  intro_html?: string
}

export type ActivityCtx = {
  activities: ActivityItem[]
  activityId?: number
  setActivityId: (id?: number) => void
  reloadActivities: () => Promise<void>
}

export const ActivityContext = createContext<ActivityCtx>({
  activities: [],
  activityId: undefined,
  setActivityId: () => {},
  reloadActivities: async () => {},
})

export const useActivity = () => useContext(ActivityContext)
