export function canAccessProject(user, projectId) {
  return Boolean(user && projectId && (user.role === 'admin' || (user.role === 'member' && (user.projectIds == null || user.projectIds.includes(projectId)))));
}

export function requireProjectAccess(user, projectId) {
  if (!canAccessProject(user, projectId)) throw Object.assign(new Error('You do not have access to this project.'), { statusCode: 403 });
}
