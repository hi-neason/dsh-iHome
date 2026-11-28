import expenseAccounting from '../skills/ihome-expense-accounting/SKILL.md'
import fengshuiReview from '../skills/ihome-fengshui-review/SKILL.md'
import floorplanReview from '../skills/ihome-floorplan-review/SKILL.md'
import modeling from '../skills/ihome-floorplan-modeling/SKILL.md'
import vendorResearch from '../skills/ihome-vendor-research/SKILL.md'
import quoteAnalysis from '../skills/ihome-quote-analysis/SKILL.md'
import coordination from '../skills/ihome-team-coordination/SKILL.md'
import interview from '../skills/ihome-needs-interview/SKILL.md'
import needsReview from '../skills/ihome-needs-review/SKILL.md'
import taskPlanning from '../skills/ihome-task-planning/SKILL.md'
import taskReview from '../skills/ihome-task-review/SKILL.md'

export const skillBodies: Record<string, string> = {
  'ihome-expense-accounting': expenseAccounting,
  'ihome-fengshui-review': fengshuiReview,
  'ihome-floorplan-review': floorplanReview,
  'ihome-floorplan-modeling': modeling,
  'ihome-vendor-research': vendorResearch,
  'ihome-quote-analysis': quoteAnalysis,
  'ihome-team-coordination': coordination,
  'ihome-needs-interview': interview,
  'ihome-needs-review': needsReview,
  'ihome-task-planning': taskPlanning,
  'ihome-task-review': taskReview,
}
