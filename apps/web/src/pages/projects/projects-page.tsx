import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  Edit3,
  FolderKanban,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  Shield,
  UserCheck,
  UserPlus,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { BRAND } from '@/shared/config/brand'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useProjects, type Project } from '@/features/projects/api'
import { useWorkspaceTeams, type Team } from '@/features/teams/api'

type ManageTab = 'projects' | 'teams' | 'users'
type ProjectStatus = 'Active' | 'Archived'
type TeamStatus = 'Active' | 'Deactive'
type UserStatus = 'Active' | 'Invited' | 'Deactive'
type Role = 'Workspace Admin' | 'Project Manager' | 'Product Owner' | 'Developer' | 'Tester' | 'Viewer'

type Owner = {
  name: string
  initials: string
  color: string
}

type ProjectRecord = {
  id: string
  key: string
  name: string
  description: string
  owner: Owner
  status: ProjectStatus
  teams: string[]
  members: number
  startDate: string
  updatedAt: string
}

type TeamRecord = {
  id: string
  key: string
  name: string
  description: string
  projectKey: string
  projectName: string
  lead: Owner
  status: TeamStatus
  members: string[]
  updatedAt: string
}

type UserRecord = {
  id: string
  name: string
  email: string
  owner: Owner
  workspaceRole: Role
  status: UserStatus
  projectAccess: string[]
  teams: string[]
  lastLogin: string
}

type ProjectDraft = {
  name: string
  key: string
  description: string
  ownerName: string
  startDate: string
  teamNames: string[]
}

type TeamDraft = {
  projectKey: string
  name: string
  key: string
  description: string
  leadName: string
  status: TeamStatus
  members: string[]
}

type UserDraft = {
  name: string
  email: string
  workspaceRole: Role
  status: UserStatus
  teams: string[]
}

const ROLES: Role[] = ['Workspace Admin', 'Project Manager', 'Product Owner', 'Developer', 'Tester', 'Viewer']

const Mockup_OWNERS: Owner[] = [
  { name: 'Mockup_Ana Nguyen', initials: 'AN', color: '#1d3f73' },
  { name: 'Mockup_Bao Tran', initials: 'BT', color: '#4a7c6e' },
  { name: 'Mockup_Chi Le', initials: 'CL', color: '#7c4a6e' },
  { name: 'Mockup_Duc Pham', initials: 'DP', color: '#8a5808' },
]

const Mockup_START_DATES = ['Jan 06, 2025', 'Feb 03, 2025', 'Mar 10, 2025', 'Apr 01, 2025']
const Mockup_UPDATED_AT = ['2 hours ago', 'Yesterday', 'Jun 18, 2026', 'Jun 16, 2026']
const Mockup_DEFAULT_TEAM_NAMES = [
  'Mockup_Core Platform',
  'Mockup_Identity Access',
  'Mockup_Product Delivery',
  'Mockup_Quality Guild',
]
const EMPTY_PROJECTS: Project[] = []
const EMPTY_TEAMS: Team[] = []

function toKey(value: string) {
  const cleaned = value.replace(/^Mockup_/i, '')
  const initials = cleaned
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 5)
    .toUpperCase()
  return initials.length >= 2 ? initials : cleaned.trim().slice(0, 3).toUpperCase()
}

function makeOwnerFromName(name: string): Owner {
  const safeName = name.trim() || 'Mockup_New User'
  const words = safeName.split(/\s+/).filter(Boolean)
  const initials = (
    words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : words[0]?.slice(0, 2) || 'MU'
  ).toUpperCase()
  return { name: safeName, initials, color: '#4a7c6e' }
}

function ownerForName(name: string) {
  return Mockup_OWNERS.find((owner) => owner.name === name) ?? makeOwnerFromName(name)
}

function statusFromProject(project: Project): ProjectStatus {
  return project.status === 'archived' ? 'Archived' : 'Active'
}

function dateLabel(value: string | null | undefined, fallback: string) {
  if (!value) return fallback
  try {
    return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return fallback
  }
}

function buildProjectRecords(projects: Project[], teams: Team[], currentUserName: string): ProjectRecord[] {
  const teamNames = teams.length > 0 ? teams.map((team) => team.name) : Mockup_DEFAULT_TEAM_NAMES
  const records = projects.map((project, index) => {
    const owner = project.leadName
      ? makeOwnerFromName(project.leadName)
      : index === 0
        ? makeOwnerFromName(currentUserName)
        : Mockup_OWNERS[index % Mockup_OWNERS.length]
    const linkedTeams =
      project.teamCount > 0
        ? teamNames.slice(0, Math.min(project.teamCount, teamNames.length))
        : teamNames
            .slice(index % 2, Math.min(teamNames.length, (index % 2) + 2))
            .map((name) => (name.startsWith('Mockup_') ? name : `Mockup_${name}`))
    return {
      id: project.id,
      key: project.key,
      name: project.name,
      description: project.description ?? `Mockup_${project.name} delivery workspace for business flow review.`,
      owner,
      status: statusFromProject(project),
      teams: linkedTeams.length > 0 ? linkedTeams : ['Mockup_Unassigned Team'],
      members: project.memberCount || [24, 12, 9, 15][index] || 8,
      startDate: Mockup_START_DATES[index % Mockup_START_DATES.length],
      updatedAt: dateLabel(project.updatedAt, Mockup_UPDATED_AT[index % Mockup_UPDATED_AT.length]),
    }
  })
  if (records.length === 0) {
    return [
      {
        id: 'Mockup_project-nxp',
        key: 'NXP',
        name: 'Mockup_NX Platform',
        description: 'Mockup_Core product platform and shared enterprise capabilities.',
        owner: Mockup_OWNERS[0],
        status: 'Active',
        teams: Mockup_DEFAULT_TEAM_NAMES.slice(0, 2),
        members: 24,
        startDate: 'Jan 06, 2025',
        updatedAt: '2 hours ago',
      },
    ]
  }
  return [
    ...records,
    {
      id: 'Mockup_project-legacy',
      key: 'MLEG',
      name: 'Mockup_Legacy Billing Migration',
      description: 'Mockup_Completed migration retained for audit and delivery history.',
      owner: Mockup_OWNERS[2],
      status: 'Archived',
      teams: ['Mockup_Core Platform'],
      members: 7,
      startDate: 'Aug 12, 2024',
      updatedAt: 'May 20, 2026',
    },
  ]
}

function buildTeamRecords(projects: ProjectRecord[], apiTeams: Team[]): TeamRecord[] {
  const activeProjects = projects.filter((project) => project.status === 'Active')
  const baseTeams =
    apiTeams.length > 0
      ? apiTeams.map((team) => ({ key: team.key ?? toKey(team.name), name: team.name, description: team.description ?? null }))
      : Mockup_DEFAULT_TEAM_NAMES.map((name) => ({ key: toKey(name), name, description: null }))

  const records = baseTeams.map((team, index) => {
    const project = activeProjects[index % Math.max(activeProjects.length, 1)] ?? projects[0]
    return {
      id: apiTeams[index]?.id ?? `Mockup_team-${index + 1}`,
      key: team.key,
      name: team.name.startsWith('Mockup_') ? team.name : team.name,
      description: team.description ?? `Mockup_${team.name} delivery team for ${project?.name ?? 'workspace'}.`,
      projectKey: project?.key ?? 'MOCK',
      projectName: project?.name ?? 'Mockup_Project',
      lead: Mockup_OWNERS[index % Mockup_OWNERS.length],
      status: 'Active' as const,
      members: Mockup_OWNERS.slice(0, Math.max(2, 4 - (index % 3))).map((owner) => owner.name),
      updatedAt: Mockup_UPDATED_AT[index % Mockup_UPDATED_AT.length],
    }
  })

  return [
    ...records,
    {
      id: 'Mockup_team-deactive',
      key: 'MQA',
      name: 'Mockup_QA Automation',
      description: 'Mockup_Deactivated QA automation team kept for history.',
      projectKey: activeProjects[0]?.key ?? 'MOCK',
      projectName: activeProjects[0]?.name ?? 'Mockup_Project',
      lead: Mockup_OWNERS[3],
      status: 'Deactive',
      members: [Mockup_OWNERS[1].name, Mockup_OWNERS[3].name],
      updatedAt: 'Jun 12, 2026',
    },
  ]
}

function buildUserRecords(currentUser: { id?: string; displayName?: string | null; email?: string | null } | null, teams: TeamRecord[]): UserRecord[] {
  const adminName = currentUser?.displayName ?? 'Admin User'
  const adminEmail = currentUser?.email ?? 'admin@acme.dev'
  return [
    {
      id: currentUser?.id ?? 'current-user',
      name: adminName,
      email: adminEmail,
      owner: makeOwnerFromName(adminName),
      workspaceRole: 'Workspace Admin',
      status: 'Active',
      projectAccess: Array.from(new Set(teams.slice(0, 2).map((team) => team.projectKey))),
      teams: teams.slice(0, 2).map((team) => team.name),
      lastLogin: 'Just now',
    },
    {
      id: 'Mockup_user-1',
      name: 'Mockup_Linh Product',
      email: 'mockup_linh.product@example.com',
      owner: Mockup_OWNERS[0],
      workspaceRole: 'Product Owner',
      status: 'Active',
      projectAccess: Array.from(new Set(teams.slice(0, 2).map((team) => team.projectKey))),
      teams: teams.slice(0, 2).map((team) => team.name),
      lastLogin: 'Today',
    },
    {
      id: 'Mockup_user-2',
      name: 'Mockup_Minh Tester',
      email: 'mockup_minh.tester@example.com',
      owner: Mockup_OWNERS[1],
      workspaceRole: 'Tester',
      status: 'Invited',
      projectAccess: teams[1] ? [teams[1].projectKey] : [],
      teams: teams[1] ? [teams[1].name] : [],
      lastLogin: '-',
    },
    {
      id: 'Mockup_user-3',
      name: 'Mockup_Quang Viewer',
      email: 'mockup_quang.viewer@example.com',
      owner: Mockup_OWNERS[2],
      workspaceRole: 'Viewer',
      status: 'Deactive',
      projectAccess: teams[0] ? [teams[0].projectKey] : [],
      teams: teams[0] ? [teams[0].name] : [],
      lastLogin: 'Jun 11, 2026',
    },
  ]
}

function emptyProjectDraft(ownerName: string): ProjectDraft {
  return {
    name: '',
    key: '',
    description: '',
    ownerName,
    startDate: '2026-07-01',
    teamNames: [],
  }
}

function emptyTeamDraft(projectKey: string, leadName: string, members: string[]): TeamDraft {
  return {
    projectKey,
    name: '',
    key: '',
    description: '',
    leadName,
    status: 'Active',
    members: members.slice(0, 2),
  }
}

function emptyUserDraft(firstTeamName: string): UserDraft {
  return {
    name: '',
    email: '',
    workspaceRole: 'Developer',
    status: 'Invited',
    teams: firstTeamName ? [firstTeamName] : [],
  }
}

export function ProjectsPage() {
  const { workspace } = useAppContext()
  const workspaceId = workspace?.workspaceId
  const { user, hasPermission } = useAuthStore()
  const { data: apiProjectsData } = useProjects(workspaceId)
  const { data: apiTeamsData } = useWorkspaceTeams(workspaceId)
  const apiProjects = apiProjectsData ?? EMPTY_PROJECTS
  const apiTeams = apiTeamsData ?? EMPTY_TEAMS

  const [activeTab, setActiveTab] = useState<ManageTab>('projects')
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [teams, setTeams] = useState<TeamRecord[]>([])
  const [users, setUsers] = useState<UserRecord[]>([])
  const [editingProject, setEditingProject] = useState<ProjectRecord | null | undefined>(undefined)
  const [editingTeam, setEditingTeam] = useState<TeamRecord | null | undefined>(undefined)
  const [editingUser, setEditingUser] = useState<UserRecord | null | undefined>(undefined)
  const [archiveProjectTarget, setArchiveProjectTarget] = useState<ProjectRecord | null>(null)
  const [archiveTeamTarget, setArchiveTeamTarget] = useState<TeamRecord | null>(null)

  useEffect(() => {
    const nextProjects = buildProjectRecords(apiProjects, apiTeams, user?.displayName ?? 'Admin User')
    const nextTeams = buildTeamRecords(nextProjects, apiTeams)
    setProjects(nextProjects)
    setTeams(nextTeams)
    setUsers(buildUserRecords(user, nextTeams))
  }, [apiProjects, apiTeams, user?.id, user?.displayName, user?.email])

  const allTeamNames = useMemo(() => Array.from(new Set(teams.map((team) => team.name))).sort(), [teams])
  const ownerNames = useMemo(
    () => Array.from(new Set([...Mockup_OWNERS.map((owner) => owner.name), ...users.map((item) => item.name)])),
    [users],
  )
  const canManageProjects = hasPermission('project:manage') || hasPermission('project:edit')
  const canManageUsers = hasPermission('tenant:manage_users') || hasPermission('user:manage')

  function saveProject(draft: ProjectDraft) {
    if (editingProject) {
      setProjects((previous) =>
        previous.map((project) =>
          project.id === editingProject.id
            ? {
                ...project,
                key: draft.key,
                name: draft.name,
                description: draft.description,
                owner: ownerForName(draft.ownerName),
                teams: draft.teamNames,
                startDate: draft.startDate,
                updatedAt: 'Just now',
              }
            : project,
        ),
      )
    } else {
      setProjects((previous) => [
        {
          id: `Mockup_project-${Date.now()}`,
          key: draft.key,
          name: draft.name.startsWith('Mockup_') ? draft.name : `Mockup_${draft.name}`,
          description: draft.description || 'Mockup_New project created from FE mockup.',
          owner: ownerForName(draft.ownerName),
          status: 'Active',
          teams: draft.teamNames,
          members: 1,
          startDate: draft.startDate,
          updatedAt: 'Just now',
        },
        ...previous,
      ])
    }
    setEditingProject(undefined)
  }

  function saveTeam(draft: TeamDraft) {
    const project = projects.find((item) => item.key === draft.projectKey) ?? projects[0]
    const teamName = draft.name.startsWith('Mockup_') ? draft.name : `Mockup_${draft.name}`
    if (editingTeam) {
      setTeams((previous) =>
        previous.map((team) =>
          team.id === editingTeam.id
            ? {
                ...team,
                key: draft.key,
                name: draft.name,
                description: draft.description,
                projectKey: draft.projectKey,
                projectName: project?.name ?? 'Mockup_Project',
                lead: ownerForName(draft.leadName),
                status: draft.status,
                members: draft.members,
                updatedAt: 'Just now',
              }
            : team,
        ),
      )
    } else {
      setTeams((previous) => [
        {
          id: `Mockup_team-${Date.now()}`,
          key: draft.key,
          name: teamName,
          description: draft.description || 'Mockup_New team created from FE mockup.',
          projectKey: draft.projectKey,
          projectName: project?.name ?? 'Mockup_Project',
          lead: ownerForName(draft.leadName),
          status: draft.status,
          members: draft.members,
          updatedAt: 'Just now',
        },
        ...previous,
      ])
      setProjects((previous) =>
        previous.map((item) =>
          item.key === draft.projectKey && !item.teams.includes(teamName)
            ? { ...item, teams: [...item.teams, teamName], updatedAt: 'Just now' }
            : item,
        ),
      )
    }
    setEditingTeam(undefined)
  }

  function projectAccessFromTeams(teamNames: string[]) {
    return Array.from(new Set(teams.filter((team) => teamNames.includes(team.name)).map((team) => team.projectKey)))
  }

  function saveUser(draft: UserDraft) {
    const derivedProjectAccess = projectAccessFromTeams(draft.teams)
    if (editingUser) {
      setUsers((previous) =>
        previous.map((item) =>
          item.id === editingUser.id
            ? {
                ...item,
                ...draft,
                owner: makeOwnerFromName(draft.name),
                projectAccess: derivedProjectAccess,
                lastLogin: draft.status === 'Invited' ? '-' : item.lastLogin,
              }
            : item,
        ),
      )
    } else {
      const name = draft.name.startsWith('Mockup_') ? draft.name : `Mockup_${draft.name}`
      setUsers((previous) => [
        {
          id: `Mockup_user-${Date.now()}`,
          name,
          email: draft.email.startsWith('mockup_') ? draft.email : `mockup_${draft.email}`,
          owner: makeOwnerFromName(name),
          workspaceRole: draft.workspaceRole,
          status: draft.status,
          projectAccess: derivedProjectAccess,
          teams: draft.teams,
          lastLogin: draft.status === 'Invited' ? '-' : 'Just now',
        },
        ...previous,
      ])
    }
    setEditingUser(undefined)
  }

  function archiveProject(project: ProjectRecord) {
    setProjects((previous) =>
      previous.map((item) => (item.id === project.id ? { ...item, status: 'Archived', updatedAt: 'Just now' } : item)),
    )
    setArchiveProjectTarget(null)
  }

  function restoreProject(project: ProjectRecord) {
    setProjects((previous) =>
      previous.map((item) => (item.id === project.id ? { ...item, status: 'Active', updatedAt: 'Just now' } : item)),
    )
  }

  function archiveTeam(team: TeamRecord) {
    setTeams((previous) =>
      previous.map((item) => (item.id === team.id ? { ...item, status: 'Deactive', updatedAt: 'Just now' } : item)),
    )
    setArchiveTeamTarget(null)
  }

  function restoreTeam(team: TeamRecord) {
    setTeams((previous) =>
      previous.map((item) => (item.id === team.id ? { ...item, status: 'Active', updatedAt: 'Just now' } : item)),
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-white">
      <style>{`.form-input{width:100%;padding:0.5rem 0.75rem;border:1px solid #d9dee7;border-radius:4px;font-size:12px;color:#1a2234;outline:none}.form-input:focus{border-color:rgba(29,63,115,.45);box-shadow:0 0 0 2px rgba(29,63,115,.08)}.primary-button{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:4px;font-size:11px;font-weight:600;color:white;background-color:#1d3f73}`}</style>
      <div className="flex shrink-0 items-center gap-4 px-4 py-3" style={{ borderBottom: '1px solid #e2e6eb' }}>
        <div>
          <h2 className="text-[14px] font-semibold" style={{ color: '#1a2234' }}>
            Manage
          </h2>
          <p className="mt-0.5 text-[10px]" style={{ color: '#8c94a6' }}>
            Projects, teams and users for {workspace?.workspaceName ?? 'Rally workspace'}.
          </p>
        </div>
        <Tabs activeTab={activeTab} onChange={setActiveTab} />
        <div className="flex-1" />
        {activeTab === 'projects' && canManageProjects && (
          <button onClick={() => setEditingProject(null)} className="primary-button">
            <Plus size={12} /> Create Project
          </button>
        )}
        {activeTab === 'teams' && canManageProjects && (
          <button onClick={() => setEditingTeam(null)} className="primary-button">
            <Plus size={12} /> Create Team
          </button>
        )}
        {activeTab === 'users' && canManageUsers && (
          <button onClick={() => setEditingUser(null)} className="primary-button">
            <UserPlus size={12} /> Invite User
          </button>
        )}
      </div>

      {activeTab === 'projects' && (
        <ProjectsTab
          projects={projects}
          canManage={canManageProjects}
          onEdit={setEditingProject}
          onArchive={setArchiveProjectTarget}
          onRestore={restoreProject}
        />
      )}
      {activeTab === 'teams' && (
        <TeamsTab
          teams={teams}
          projects={projects}
          onEdit={setEditingTeam}
          onArchive={setArchiveTeamTarget}
          onRestore={restoreTeam}
          canManage={canManageProjects}
        />
      )}
      {activeTab === 'users' && <UsersTab users={users} onEdit={setEditingUser} />}

      {editingProject !== undefined && (
        <ProjectModal
          project={editingProject}
          existingKeys={projects.filter((project) => project.id !== editingProject?.id).map((project) => project.key)}
          allTeamNames={allTeamNames}
          ownerNames={ownerNames}
          defaultOwnerName={Mockup_OWNERS[0].name}
          onClose={() => setEditingProject(undefined)}
          onSave={saveProject}
        />
      )}
      {editingTeam !== undefined && (
        <TeamModal
          team={editingTeam}
          projects={projects}
          existingKeys={teams.filter((team) => team.id !== editingTeam?.id).map((team) => team.key)}
          ownerNames={ownerNames}
          onClose={() => setEditingTeam(undefined)}
          onSave={saveTeam}
        />
      )}
      {editingUser !== undefined && (
        <UserModal
          user={editingUser}
          teams={teams}
          existingEmails={users.filter((item) => item.id !== editingUser?.id).map((item) => item.email.toLowerCase())}
          onClose={() => setEditingUser(undefined)}
          onSave={saveUser}
        />
      )}
      {archiveProjectTarget && (
        <ConfirmArchive
          title={`Archive ${archiveProjectTarget.name}?`}
          body="The project becomes read-only and is hidden from active selectors. Teams and delivery history are preserved."
          actionLabel="Archive Project"
          onCancel={() => setArchiveProjectTarget(null)}
          onConfirm={() => archiveProject(archiveProjectTarget)}
        />
      )}
      {archiveTeamTarget && (
        <ConfirmArchive
          title={`Deactivate ${archiveTeamTarget.name}?`}
          body="The team becomes unavailable in new project/team selectors. Existing history is preserved."
          actionLabel="Deactivate Team"
          onCancel={() => setArchiveTeamTarget(null)}
          onConfirm={() => archiveTeam(archiveTeamTarget)}
        />
      )}
    </div>
  )
}

function Tabs({ activeTab, onChange }: { activeTab: ManageTab; onChange: (tab: ManageTab) => void }) {
  const tabs: { key: ManageTab; label: string; icon: LucideIcon }[] = [
    { key: 'projects', label: 'Projects', icon: FolderKanban },
    { key: 'teams', label: 'Teams', icon: Users },
    { key: 'users', label: 'Users', icon: UserCheck },
  ]
  return (
    <div className="flex items-center gap-1 rounded p-1" style={{ backgroundColor: '#edf0f4' }}>
      {tabs.map((tab) => {
        const Icon = tab.icon
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-[11px] font-semibold"
            style={{
              color: activeTab === tab.key ? '#1d3f73' : '#5c6478',
              backgroundColor: activeTab === tab.key ? '#fff' : 'transparent',
              boxShadow: activeTab === tab.key ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
            }}
          >
            <Icon size={12} />
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

function ProjectsTab({
  projects,
  canManage,
  onEdit,
  onArchive,
  onRestore,
}: {
  projects: ProjectRecord[]
  canManage: boolean
  onEdit: (project: ProjectRecord) => void
  onArchive: (project: ProjectRecord) => void
  onRestore: (project: ProjectRecord) => void
}) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'All' | ProjectStatus>('Active')
  const filtered = useMemo(
    () =>
      projects.filter(
        (project) =>
          (status === 'All' || project.status === status) &&
          `${project.key} ${project.name} ${project.owner.name}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [projects, search, status],
  )

  return (
    <>
      <div className="grid shrink-0 grid-cols-4 gap-3 px-4 py-3" style={{ backgroundColor: '#f7f8fa', borderBottom: '1px solid #e2e6eb' }}>
        <MetricCard label="Total Projects" value={projects.length} icon={FolderKanban} />
        <MetricCard label="Active" value={projects.filter((item) => item.status === 'Active').length} icon={Check} />
        <MetricCard label="Archived" value={projects.filter((item) => item.status === 'Archived').length} icon={Archive} />
        <MetricCard label="Linked Teams" value={new Set(projects.flatMap((item) => item.teams)).size} icon={Users} />
      </div>
      <Toolbar count={`${filtered.length} projects`}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search projects..." />
        <Segmented value={status} values={['All', 'Active', 'Archived'] as const} onChange={setStatus} />
      </Toolbar>
      <div className="flex-1 overflow-auto">
        <div className="min-w-[1120px]">
          <Header columns={[['w-20', 'Key'], ['flex-1', 'Project'], ['w-24', 'Status'], ['w-36', 'Owner'], ['w-44', 'Teams'], ['w-20', 'Members'], ['w-28', 'Start Date'], ['w-24', 'Updated'], ['w-20 text-right', 'Actions']]} />
          {filtered.map((project) => (
            <div key={project.id} className="row cursor-pointer hover:bg-[#f7f8fa]" onClick={() => onEdit(project)}>
              <div className="w-20 shrink-0 font-mono text-[10px] font-semibold" style={{ color: '#2558a6' }}>
                {project.key}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold" style={{ color: '#1a2234' }}>
                  {project.name}
                </p>
                <p className="mt-0.5 truncate text-[9px]" style={{ color: '#8c94a6' }}>
                  {project.description || 'No description'}
                </p>
              </div>
              <div className="w-24 shrink-0">
                <StatusDot status={project.status} />
              </div>
              <div className="flex w-36 shrink-0 items-center gap-1.5">
                <Avatar owner={project.owner} size="xs" />
                <span className="truncate text-[10px]" style={{ color: '#5c6478' }}>
                  {project.owner.name}
                </span>
              </div>
              <div className="flex w-44 shrink-0 items-center -space-x-1">
                {project.teams.slice(0, 2).map((team) => (
                  <span key={team} className="max-w-24 truncate rounded-sm px-1.5 py-0.5 text-[9px]" style={{ color: '#475569', backgroundColor: '#f1f5f9', border: '1px solid white' }}>
                    {team}
                  </span>
                ))}
                {project.teams.length > 2 && <span className="ml-1.5 text-[9px]" style={{ color: '#8c94a6' }}>+{project.teams.length - 2}</span>}
                {project.teams.length === 0 && <span className="text-[9px]" style={{ color: '#b0b8c8' }}>No teams</span>}
              </div>
              <div className="w-20 shrink-0 text-[10px]" style={{ color: '#5c6478' }}>{project.members}</div>
              <div className="w-28 shrink-0 text-[10px]" style={{ color: '#5c6478' }}>{project.startDate}</div>
              <div className="w-24 shrink-0 text-[10px]" style={{ color: '#8c94a6' }}>{project.updatedAt}</div>
              <RowActions canManage={canManage} active={project.status === 'Active'} onEdit={() => onEdit(project)} onArchive={() => onArchive(project)} onRestore={() => onRestore(project)} restoreLabel="Restore" />
            </div>
          ))}
          {filtered.length === 0 && <EmptyTable icon={FolderKanban} title="No projects found" />}
        </div>
      </div>
      <Footer count={filtered.length} />
      <TableStyles />
    </>
  )
}

function TeamsTab({
  teams,
  projects,
  onEdit,
  onArchive,
  onRestore,
  canManage,
}: {
  teams: TeamRecord[]
  projects: ProjectRecord[]
  onEdit: (team: TeamRecord) => void
  onArchive: (team: TeamRecord) => void
  onRestore: (team: TeamRecord) => void
  canManage: boolean
}) {
  const [search, setSearch] = useState('')
  const [project, setProject] = useState('All')
  const [status, setStatus] = useState<'All' | TeamStatus>('Active')
  const filtered = useMemo(
    () =>
      teams.filter(
        (team) =>
          (project === 'All' || team.projectKey === project) &&
          (status === 'All' || team.status === status) &&
          `${team.key} ${team.name} ${team.projectName} ${team.lead.name}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [teams, project, search, status],
  )
  const activeTeams = teams.filter((team) => team.status === 'Active')

  return (
    <>
      <div className="grid shrink-0 grid-cols-3 gap-3 px-4 py-3" style={{ backgroundColor: '#f7f8fa', borderBottom: '1px solid #e2e6eb' }}>
        <MetricCard label="Total Teams" value={teams.length} icon={Users} />
        <MetricCard label="Active" value={activeTeams.length} icon={Check} />
        <MetricCard label="Deactive" value={teams.filter((team) => team.status === 'Deactive').length} icon={Archive} />
      </div>
      <Toolbar count={`${filtered.length} teams`}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search teams..." />
        <select value={project} onChange={(event) => setProject(event.target.value)} className="rounded bg-white px-2.5 py-1.5 text-[11px]" style={{ border: '1px solid #d9dee7', color: '#1a2234' }}>
          <option value="All">All projects</option>
          {projects.filter((item) => item.status === 'Active').map((item) => (
            <option key={item.key} value={item.key}>{item.key} / {item.name}</option>
          ))}
        </select>
        <Segmented value={status} values={['All', 'Active', 'Deactive'] as const} onChange={setStatus} />
      </Toolbar>
      <div className="flex-1 overflow-auto">
        <div className="min-w-[1080px]">
          <Header columns={[['w-20', 'Key'], ['flex-1', 'Team'], ['w-52', 'Project'], ['w-24', 'Status'], ['w-40', 'Lead'], ['w-28', 'Updated'], ['w-20 text-right', 'Actions']]} />
          {filtered.map((team) => (
            <div key={team.id} className="row cursor-pointer hover:bg-[#f7f8fa]" onClick={() => onEdit(team)}>
              <div className="w-20 shrink-0 font-mono text-[10px] font-semibold" style={{ color: '#2558a6' }}>{team.key}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold" style={{ color: '#1a2234' }}>{team.name}</p>
                <p className="mt-0.5 truncate text-[9px]" style={{ color: '#8c94a6' }}>{team.description}</p>
              </div>
              <div className="w-52 shrink-0 truncate text-[10px]" style={{ color: '#5c6478' }}>{team.projectKey} / {team.projectName}</div>
              <div className="w-24 shrink-0"><StatusDot status={team.status} /></div>
              <div className="flex w-40 shrink-0 items-center gap-1.5">
                <Avatar owner={team.lead} size="xs" />
                <span className="truncate text-[10px]" style={{ color: '#5c6478' }}>{team.lead.name}</span>
              </div>
              <div className="w-28 shrink-0 text-[10px]" style={{ color: '#8c94a6' }}>{team.updatedAt}</div>
              <RowActions canManage={canManage} active={team.status === 'Active'} onEdit={() => onEdit(team)} onArchive={() => onArchive(team)} onRestore={() => onRestore(team)} restoreLabel="Restore" />
            </div>
          ))}
          {filtered.length === 0 && <EmptyTable icon={Users} title="No teams found" />}
        </div>
      </div>
      <Footer count={filtered.length} />
      <TableStyles />
    </>
  )
}

function UsersTab({ users, onEdit }: { users: UserRecord[]; onEdit: (user: UserRecord) => void }) {
  const [search, setSearch] = useState('')
  const [role, setRole] = useState<'All' | Role>('All')
  const [status, setStatus] = useState<'All' | UserStatus>('All')
  const filtered = useMemo(
    () =>
      users.filter(
        (user) =>
          (role === 'All' || user.workspaceRole === role) &&
          (status === 'All' || user.status === status) &&
          `${user.name} ${user.email} ${user.workspaceRole}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [users, role, search, status],
  )

  return (
    <>
      <div className="grid shrink-0 grid-cols-3 gap-3 px-4 py-3" style={{ backgroundColor: '#f7f8fa', borderBottom: '1px solid #e2e6eb' }}>
        <MetricCard label="Total Users" value={users.length} icon={Users} />
        <MetricCard label="Active" value={users.filter((user) => user.status === 'Active').length} icon={UserCheck} />
        <MetricCard label="Admins" value={users.filter((user) => user.workspaceRole === 'Workspace Admin').length} icon={Shield} />
      </div>
      <Toolbar count={`${filtered.length} users`}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search users..." />
        <select value={role} onChange={(event) => setRole(event.target.value as 'All' | Role)} className="rounded bg-white px-2.5 py-1.5 text-[11px]" style={{ border: '1px solid #d9dee7', color: '#1a2234' }}>
          <option value="All">All roles</option>
          {ROLES.map((item) => <option key={item}>{item}</option>)}
        </select>
        <Segmented value={status} values={['All', 'Active', 'Invited', 'Deactive'] as const} onChange={setStatus} />
      </Toolbar>
      <div className="flex-1 overflow-auto">
        <div className="min-w-[1080px]">
          <Header columns={[['w-52', 'User'], ['w-56', 'Email'], ['w-36', 'Workspace Role'], ['w-24', 'Status'], ['flex-1', 'Teams'], ['w-36', 'Last Login']]} />
          {filtered.map((user) => (
            <div key={user.id} className="row cursor-pointer hover:bg-[#f7f8fa]" onClick={() => onEdit(user)}>
              <div className="flex w-52 shrink-0 items-center gap-2">
                <Avatar owner={user.owner} size="sm" />
                <span className="truncate text-[11px] font-semibold" style={{ color: '#1a2234' }}>{user.name}</span>
              </div>
              <div className="w-56 shrink-0 truncate text-[10px]" style={{ color: '#5c6478' }}>{user.email}</div>
              <div className="w-36 shrink-0"><RoleBadge role={user.workspaceRole} /></div>
              <div className="w-24 shrink-0"><StatusDot status={user.status} /></div>
              <div className="min-w-0 flex-1 truncate text-[10px]" style={{ color: '#5c6478' }}>{user.teams.join(', ')}</div>
              <div className="w-36 shrink-0 text-[10px]" style={{ color: '#8c94a6' }}>{user.lastLogin}</div>
            </div>
          ))}
          {filtered.length === 0 && <EmptyTable icon={Users} title="No users found" />}
        </div>
      </div>
      <Footer count={filtered.length} />
      <TableStyles />
    </>
  )
}

function ProjectModal({
  project,
  existingKeys,
  allTeamNames,
  ownerNames,
  defaultOwnerName,
  onClose,
  onSave,
}: {
  project: ProjectRecord | null
  existingKeys: string[]
  allTeamNames: string[]
  ownerNames: string[]
  defaultOwnerName: string
  onClose: () => void
  onSave: (draft: ProjectDraft) => void
}) {
  const [draft, setDraft] = useState<ProjectDraft>(
    project
      ? {
          name: project.name,
          key: project.key,
          description: project.description,
          ownerName: project.owner.name,
          startDate: project.startDate,
          teamNames: project.teams,
        }
      : emptyProjectDraft(defaultOwnerName),
  )
  const [error, setError] = useState('')
  const editing = Boolean(project)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const key = draft.key.trim().toUpperCase()
    if (!draft.name.trim() || !key) return setError('Project name and key are required.')
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) return setError('Key must be 2-10 uppercase letters or numbers and start with a letter.')
    if (!editing && existingKeys.includes(key)) return setError('Project key already exists.')
    onSave({ ...draft, key, name: draft.name.trim() })
  }

  function toggleTeam(team: string) {
    setDraft((previous) => ({
      ...previous,
      teamNames: previous.teamNames.includes(team)
        ? previous.teamNames.filter((item) => item !== team)
        : [...previous.teamNames, team],
    }))
  }

  return (
    <ModalShell title={editing ? 'Edit Project' : 'Create Project'} subtitle="Manage / Projects" onClose={onClose} width={620}>
      <form onSubmit={submit}>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
          {error && <ErrorMessage text={error} />}
          <div className="grid grid-cols-[1fr_150px] gap-4">
            <Field label="Project name *"><input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. Customer Portal" className="form-input" /></Field>
            <Field label="Project key *"><input value={draft.key} disabled={editing} onChange={(event) => setDraft({ ...draft, key: event.target.value.toUpperCase() })} placeholder="CP" maxLength={10} className="form-input font-mono uppercase disabled:bg-[#f1f3f6]" /></Field>
          </div>
          <Field label="Description"><textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={3} placeholder="Describe the project scope and delivery outcome..." className="form-input resize-none" /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Project owner"><select value={draft.ownerName} onChange={(event) => setDraft({ ...draft, ownerName: event.target.value })} className="form-input bg-white">{ownerNames.map((owner) => <option key={owner}>{owner}</option>)}</select></Field>
            <Field label="Start date"><input value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} className="form-input" /></Field>
          </div>
          <Picker title="Teams" caption="A team can be linked to multiple projects." count={draft.teamNames.length}>
            {allTeamNames.map((team) => <CheckButton key={team} selected={draft.teamNames.includes(team)} onClick={() => toggleTeam(team)} icon={<Users size={11} />} label={team} />)}
          </Picker>
        </div>
        <ModalFooter primaryLabel={editing ? 'Save Changes' : 'Create Project'} onClose={onClose} />
      </form>
    </ModalShell>
  )
}

function TeamModal({
  team,
  projects,
  existingKeys,
  ownerNames,
  onClose,
  onSave,
}: {
  team: TeamRecord | null
  projects: ProjectRecord[]
  existingKeys: string[]
  ownerNames: string[]
  onClose: () => void
  onSave: (draft: TeamDraft) => void
}) {
  const [draft, setDraft] = useState<TeamDraft>(
    team
      ? {
          projectKey: team.projectKey,
          name: team.name,
          key: team.key,
          description: team.description,
          leadName: team.lead.name,
          status: team.status,
          members: team.members,
        }
      : emptyTeamDraft(projects.find((project) => project.status === 'Active')?.key ?? projects[0]?.key ?? 'MOCK', ownerNames[0] ?? Mockup_OWNERS[0].name, ownerNames),
  )
  const [error, setError] = useState('')
  const [activeSection, setActiveSection] = useState<'info' | 'members'>('info')
  const [memberSearch, setMemberSearch] = useState('')
  const editing = Boolean(team)
  const filteredMembers = ownerNames.filter((owner) => owner.toLowerCase().includes(memberSearch.toLowerCase()))

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const key = draft.key.trim().toUpperCase()
    if (!draft.name.trim() || !key || !draft.projectKey) return setError('Project, team name and team key are required.')
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) return setError('Team key must be 2-10 uppercase letters or numbers.')
    if (!editing && existingKeys.includes(key)) return setError('Team key already exists.')
    onSave({ ...draft, key, name: draft.name.trim() })
  }

  function updateName(name: string) {
    setDraft((previous) => ({ ...previous, name, key: editing || previous.key ? previous.key : toKey(name) }))
  }

  function toggleMember(member: string) {
    setDraft((previous) => ({
      ...previous,
      members: previous.members.includes(member)
        ? previous.members.filter((item) => item !== member)
        : [...previous.members, member],
    }))
  }

  return (
    <ModalShell title={editing ? 'Edit Team' : 'Create Team'} subtitle="Manage / Teams" onClose={onClose} width={680} height={600}>
      <form onSubmit={submit} className="flex h-full flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {error && <ErrorMessage text={error} />}
          <div className="flex items-center gap-1 rounded p-1" style={{ backgroundColor: '#edf0f4' }}>
            <ModalTab active={activeSection === 'info'} onClick={() => setActiveSection('info')} label="Team Info" />
            <ModalTab active={activeSection === 'members'} onClick={() => setActiveSection('members')} label={`Members (${draft.members.length})`} />
          </div>
          {activeSection === 'info' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Project *"><select value={draft.projectKey} onChange={(event) => setDraft({ ...draft, projectKey: event.target.value })} className="form-input bg-white">{projects.filter((project) => project.status === 'Active').map((project) => <option key={project.key} value={project.key}>{project.key} / {project.name}</option>)}</select></Field>
                <Field label="Team lead"><select value={draft.leadName} onChange={(event) => setDraft({ ...draft, leadName: event.target.value })} className="form-input bg-white">{ownerNames.map((owner) => <option key={owner}>{owner}</option>)}</select></Field>
              </div>
              <div className="grid grid-cols-[1fr_140px] gap-4">
                <Field label="Team name *"><input autoFocus value={draft.name} onChange={(event) => updateName(event.target.value)} placeholder="e.g. Platform Services" className="form-input" /></Field>
                <Field label="Team key *"><input value={draft.key} onChange={(event) => setDraft({ ...draft, key: event.target.value.toUpperCase() })} maxLength={10} placeholder="PS" className="form-input font-mono uppercase" /></Field>
              </div>
              <Field label="Description"><textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={3} placeholder="Describe ownership, product area, or delivery responsibility..." className="form-input resize-none" /></Field>
              <div className="max-w-[220px]"><Field label="Status"><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as TeamStatus })} className="form-input bg-white"><option>Active</option><option>Deactive</option></select></Field></div>
            </div>
          )}
          {activeSection === 'members' && (
            <Picker title="Members" caption="Choose workspace users assigned to this team." count={draft.members.length} layout="list" searchValue={memberSearch} onSearch={setMemberSearch} searchPlaceholder="Search members...">
              {filteredMembers.map((owner) => <CheckButton key={owner} selected={draft.members.includes(owner)} onClick={() => toggleMember(owner)} icon={<Avatar owner={ownerForName(owner)} size="xs" />} label={owner} />)}
              {filteredMembers.length === 0 && <PickerEmpty text="No members found" />}
            </Picker>
          )}
        </div>
        <ModalFooter primaryLabel={editing ? 'Save Changes' : 'Create Team'} onClose={onClose} />
      </form>
    </ModalShell>
  )
}

function UserModal({
  user,
  teams,
  existingEmails,
  onClose,
  onSave,
}: {
  user: UserRecord | null
  teams: TeamRecord[]
  existingEmails: string[]
  onClose: () => void
  onSave: (draft: UserDraft) => void
}) {
  const [draft, setDraft] = useState<UserDraft>(
    user ? { name: user.name, email: user.email, workspaceRole: user.workspaceRole, status: user.status, teams: user.teams } : emptyUserDraft(teams[0]?.name ?? ''),
  )
  const [error, setError] = useState('')
  const [activeSection, setActiveSection] = useState<'info' | 'teams'>('info')
  const [teamSearch, setTeamSearch] = useState('')
  const editing = Boolean(user)
  const filteredTeams = teams.filter((team) => team.status === 'Active' && `${team.name} ${team.key} ${team.projectName}`.toLowerCase().includes(teamSearch.toLowerCase()))

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = draft.email.trim().toLowerCase()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('A valid email is required.')
    if (!editing && existingEmails.includes(email)) return setError('This user already exists.')
    onSave({ ...draft, email, name: draft.name.trim() || email.split('@')[0] })
  }

  function toggleTeam(teamName: string) {
    setDraft((previous) => ({
      ...previous,
      teams: previous.teams.includes(teamName)
        ? previous.teams.filter((item) => item !== teamName)
        : [...previous.teams, teamName],
    }))
  }

  return (
    <ModalShell title={editing ? 'Edit User' : 'Invite User'} subtitle="Manage / Users" onClose={onClose} width={680} height={600}>
      <form onSubmit={submit} className="flex h-full flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {error && <ErrorMessage text={error} />}
          <div className="flex items-center gap-1 rounded p-1" style={{ backgroundColor: '#edf0f4' }}>
            <ModalTab active={activeSection === 'info'} onClick={() => setActiveSection('info')} label="Info" />
            <ModalTab active={activeSection === 'teams'} onClick={() => setActiveSection('teams')} label={`Teams (${draft.teams.length})`} />
          </div>
          {activeSection === 'info' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Full name"><input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Mockup_New User" className="form-input" /></Field>
                <Field label="Email *"><input value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="mockup_user@example.com" className="form-input" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Workspace role"><select value={draft.workspaceRole} onChange={(event) => setDraft({ ...draft, workspaceRole: event.target.value as Role })} className="form-input bg-white">{ROLES.map((role) => <option key={role}>{role}</option>)}</select></Field>
                <Field label="Status"><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as UserStatus })} className="form-input bg-white"><option>Active</option><option>Invited</option><option>Deactive</option></select></Field>
              </div>
            </div>
          )}
          {activeSection === 'teams' && (
            <Picker title="Teams" caption="Team selection drives project access in this BA mockup." count={draft.teams.length} layout="list" searchValue={teamSearch} onSearch={setTeamSearch} searchPlaceholder="Search teams...">
              {filteredTeams.map((team) => <CheckButton key={team.id} selected={draft.teams.includes(team.name)} onClick={() => toggleTeam(team.name)} icon={<Users size={11} />} label={`${team.name} - ${team.projectKey}`} />)}
              {filteredTeams.length === 0 && <PickerEmpty text="No teams found" />}
            </Picker>
          )}
        </div>
        <ModalFooter primaryLabel={editing ? 'Save Changes' : 'Invite User'} onClose={onClose} />
      </form>
    </ModalShell>
  )
}

function StatusDot({ status }: { status: ProjectStatus | TeamStatus | UserStatus }) {
  const cfg =
    status === 'Active'
      ? { color: '#1e6930', bg: '#eaf5ed', border: '#c7e4ce', dot: '#2a8c3f' }
      : status === 'Invited'
        ? { color: '#8a5808', bg: '#fef5e4', border: '#f5d899', dot: '#e59f0c' }
        : status === 'Deactive'
          ? { color: '#b91c1c', bg: '#fef2f2', border: '#f0c7c1', dot: '#dc2626' }
          : { color: '#64748b', bg: '#f1f5f9', border: '#d9dee7', dot: '#94a3b8' }
  return (
    <span className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: cfg.color, backgroundColor: cfg.bg, border: `1px solid ${cfg.border}` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: cfg.dot }} />
      {status}
    </span>
  )
}

function MetricCard({ label, value, icon: Icon }: { label: string; value: number | string; icon: LucideIcon }) {
  return (
    <div className="flex items-center gap-3 rounded bg-white px-3 py-2.5" style={{ border: '1px solid #e2e6eb' }}>
      <div className="flex h-7 w-7 items-center justify-center rounded" style={{ backgroundColor: '#edf2fb', color: '#1d3f73' }}>
        <Icon size={13} />
      </div>
      <div>
        <p className="text-[9px] font-semibold tracking-widest uppercase" style={{ color: '#8c94a6' }}>{label}</p>
        <p className="text-[17px] font-semibold" style={{ color: '#1a2234' }}>{value}</p>
      </div>
    </div>
  )
}

function Toolbar({ count, children }: { count: string; children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2 px-4 py-2" style={{ borderBottom: '1px solid #e2e6eb' }}>
      {children}
      <div className="flex-1" />
      <span className="text-[10px]" style={{ color: '#8c94a6' }}>{count}</span>
    </div>
  )
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search size={12} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2" style={{ color: '#8c94a6' }} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="rounded py-1.5 pr-3 pl-7 text-[11px] outline-none" style={{ width: 210, border: '1px solid #d9dee7', color: '#1a2234' }} />
    </div>
  )
}

function Segmented<T extends string>({ value, values, onChange }: { value: T; values: readonly T[]; onChange: (value: T) => void }) {
  return (
    <div className="flex items-center gap-1 rounded p-0.5" style={{ backgroundColor: '#edf0f4' }}>
      {values.map((item) => (
        <button key={item} onClick={() => onChange(item)} className="rounded px-2.5 py-1 text-[11px] font-medium" style={{ color: value === item ? '#1d3f73' : '#5c6478', backgroundColor: value === item ? '#fff' : 'transparent' }}>
          {item}
        </button>
      ))}
    </div>
  )
}

function Header({ columns }: { columns: [string, string][] }) {
  return (
    <div className="sticky top-0 z-10 flex h-8 items-center gap-3 px-4" style={{ backgroundColor: '#f7f8fa', borderBottom: '1px solid #e2e6eb' }}>
      {columns.map(([width, label]) => (
        <div key={label} className={`${width} shrink-0 text-[9px] font-semibold tracking-wider uppercase`} style={{ color: '#8c94a6' }}>
          {label}
        </div>
      ))}
    </div>
  )
}

function RowActions({
  canManage,
  active,
  onEdit,
  onArchive,
  onRestore,
  restoreLabel,
}: {
  canManage: boolean
  active: boolean
  onEdit: () => void
  onArchive: () => void
  onRestore: () => void
  restoreLabel: string
}) {
  return (
    <div className="flex w-20 shrink-0 items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
      {canManage && active && (
        <>
          <button aria-label="Edit" onClick={onEdit} className="icon-button"><Edit3 size={12} /></button>
          <button aria-label="Archive" onClick={onArchive} className="icon-button" style={{ color: '#b45309' }}><Archive size={12} /></button>
        </>
      )}
      {canManage && !active && (
        <button aria-label={restoreLabel} onClick={onRestore} className="flex items-center gap-1 rounded px-2 py-1 text-[10px]" style={{ color: '#1e6930', border: '1px solid #c7e4ce' }}>
          <RotateCcw size={10} /> {restoreLabel}
        </button>
      )}
      {!canManage && <MoreHorizontal size={13} style={{ color: '#b0b8c8' }} />}
    </div>
  )
}

function Footer({ count }: { count: number }) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between px-4" style={{ borderTop: '1px solid #e2e6eb' }}>
      <span className="text-[10px]" style={{ color: '#8c94a6' }}>1-{count} of {count}</span>
      <div className="flex items-center gap-2">
        <span className="text-[10px]" style={{ color: '#5c6478' }}>Page 1 of 1</span>
        <button disabled className="rounded p-1.5 opacity-35" style={{ border: '1px solid #dde2ea' }}><ChevronLeft size={12} /></button>
        <button disabled className="rounded p-1.5 opacity-35" style={{ border: '1px solid #dde2ea' }}><ChevronRight size={12} /></button>
      </div>
    </div>
  )
}

function EmptyTable({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="py-16 text-center">
      <Icon size={28} className="mx-auto mb-2" style={{ color: '#c4cad4' }} />
      <p className="text-[12px] font-semibold" style={{ color: '#5c6478' }}>{title}</p>
      <p className="mt-1 text-[10px]" style={{ color: '#8c94a6' }}>Change the search or filters.</p>
    </div>
  )
}

function ModalShell({ title, subtitle, width, height, onClose, children }: { title: string; subtitle: string; width: number; height?: number; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0" style={{ backgroundColor: 'rgba(15,23,42,0.34)' }} onClick={onClose} />
      <div className="relative flex w-full flex-col overflow-hidden rounded-md bg-white shadow-2xl" style={{ maxWidth: width, height, border: '1px solid #d4d8de' }}>
        <div className="flex items-center gap-3 px-5 py-3" style={{ borderBottom: '1px solid #e2e6eb' }}>
          <div>
            <h3 className="text-[14px] font-semibold" style={{ color: '#1a2234' }}>{title}</h3>
            <p className="text-[10px]" style={{ color: '#8c94a6' }}>{subtitle}</p>
          </div>
          <div className="flex-1" />
          <button onClick={onClose} className="rounded p-1.5 hover:bg-[#edf2fb]" aria-label="Close"><X size={14} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function ModalFooter({ primaryLabel, onClose }: { primaryLabel: string; onClose: () => void }) {
  return (
    <div className="flex justify-end gap-2 px-5 py-3" style={{ borderTop: '1px solid #e2e6eb', backgroundColor: '#f7f8fa' }}>
      <button type="button" onClick={onClose} className="rounded px-3.5 py-1.5 text-[11px]" style={{ border: '1px solid #d9dee7', color: '#5c6478' }}>Cancel</button>
      <button type="submit" className="rounded px-3.5 py-1.5 text-[11px] font-semibold text-white" style={{ backgroundColor: '#1d3f73' }}>{primaryLabel}</button>
    </div>
  )
}

function ModalTab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded px-3 py-1.5 text-[11px] font-semibold" style={{ color: active ? '#1d3f73' : '#5c6478', backgroundColor: active ? '#fff' : 'transparent' }}>
      {label}
    </button>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold" style={{ color: '#5c6478' }}>{label}</span>
      {children}
    </label>
  )
}

function Picker({
  title,
  caption,
  count,
  children,
  layout = 'grid',
  searchValue,
  onSearch,
  searchPlaceholder,
}: {
  title: string
  caption: string
  count: number
  children: ReactNode
  layout?: 'grid' | 'list'
  searchValue?: string
  onSearch?: (value: string) => void
  searchPlaceholder?: string
}) {
  return (
    <div className="rounded p-3" style={{ border: '1px solid #d9dee7', backgroundColor: '#fbfcfd' }}>
      <div className="mb-2 flex items-center gap-2">
        <div>
          <p className="text-[11px] font-semibold" style={{ color: '#1a2234' }}>{title}</p>
          <p className="text-[10px]" style={{ color: '#8c94a6' }}>{caption}</p>
        </div>
        <div className="flex-1" />
        <span className="rounded-sm px-1.5 py-0.5 text-[10px]" style={{ color: '#1d3f73', backgroundColor: '#edf2fb' }}>{count} selected</span>
      </div>
      {onSearch && (
        <div className="mb-2">
          <SearchBox value={searchValue ?? ''} onChange={onSearch} placeholder={searchPlaceholder ?? 'Search...'} />
        </div>
      )}
      <div className={layout === 'grid' ? 'grid grid-cols-2 gap-2' : 'space-y-2'}>{children}</div>
    </div>
  )
}

function CheckButton({ selected, onClick, icon, label }: { selected: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-2 rounded px-2.5 py-2 text-left text-[11px]" style={{ border: `1px solid ${selected ? '#9fb5d5' : '#d9dee7'}`, backgroundColor: selected ? '#edf2fb' : '#fff', color: selected ? '#1d3f73' : '#5c6478' }}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected && <Check size={12} />}
    </button>
  )
}

function PickerEmpty({ text }: { text: string }) {
  return <div className="rounded bg-white p-4 text-center text-[11px]" style={{ color: '#8c94a6', border: '1px dashed #d9dee7' }}>{text}</div>
}

function ErrorMessage({ text }: { text: string }) {
  return <div className="rounded px-3 py-2 text-[11px]" style={{ color: '#b91c1c', backgroundColor: '#fef2f2', border: '1px solid #f0c7c1' }}>{text}</div>
}

function ConfirmArchive({ title, body, actionLabel, onCancel, onConfirm }: { title: string; body: string; actionLabel: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0" style={{ backgroundColor: 'rgba(15,23,42,.34)' }} onClick={onCancel} />
      <div className="relative w-[430px] rounded-md bg-white p-5 shadow-xl" style={{ border: '1px solid #d9dee7' }}>
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full" style={{ color: '#b45309', backgroundColor: '#fff7ed' }}><Archive size={17} /></div>
        <h3 className="text-[14px] font-semibold" style={{ color: '#1a2234' }}>{title}</h3>
        <p className="mt-2 text-[11px] leading-5" style={{ color: '#5c6478' }}>{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded px-3 py-1.5 text-[11px]" style={{ border: '1px solid #d9dee7' }}>Cancel</button>
          <button onClick={onConfirm} className="rounded px-3 py-1.5 text-[11px] font-semibold text-white" style={{ backgroundColor: '#b45309' }}>{actionLabel}</button>
        </div>
      </div>
    </div>
  )
}

function Avatar({ owner, size = 'sm' }: { owner: Owner; size?: 'xs' | 'sm' }) {
  const px = size === 'xs' ? 20 : 24
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ width: px, height: px, backgroundColor: owner.color }}>
      {owner.initials}
    </span>
  )
}

function RoleBadge({ role }: { role: Role }) {
  return (
    <span className="rounded-sm px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: BRAND.primary, backgroundColor: '#edf2fb', border: '1px solid #bdd0ef' }}>
      {role}
    </span>
  )
}

function TableStyles() {
  return <style>{`.row{display:flex;align-items:center;min-height:48px;padding:0 16px;gap:12px;border-bottom:1px solid #edf0f4}.row:hover{background-color:#f9fafb}.icon-button{padding:6px;border-radius:4px;color:#5c6478}.icon-button:hover{background:#edf2fb}`}</style>
}
