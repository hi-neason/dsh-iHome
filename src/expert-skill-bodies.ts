import modeling from '../skills/ihome-floorplan-modeling/SKILL.md'
import coordination from '../skills/ihome-team-coordination/SKILL.md'
import interview from '../skills/ihome-needs-interview/SKILL.md'
import needsReview from '../skills/ihome-needs-review/SKILL.md'
import taskPlanning from '../skills/ihome-task-planning/SKILL.md'
import taskReview from '../skills/ihome-task-review/SKILL.md'

export const skillBodies: Record<string, string> = {
  'ihome-floorplan-modeling': modeling,
  'ihome-team-coordination': coordination,
  'ihome-needs-interview': interview,
  'ihome-needs-review': needsReview,
  'ihome-task-planning': taskPlanning,
  'ihome-task-review': taskReview,
}
