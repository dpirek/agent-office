export function canAccessProject(user, projectId, project) {
  return Boolean(user && projectId && (user.role === 'admin' || (user.role === 'member' && (project?.isPublic || user.publicProjectIds?.includes(projectId) || user.projectIds == null || user.projectIds.includes(projectId)))));
}

export function requireProjectAccess(user, projectId, project) {
  if (!canAccessProject(user, projectId, project)) throw Object.assign(new Error('You do not have access to this project.'), { statusCode: 403 });
}
