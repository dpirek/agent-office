export function connectedUsers(sockets, userStore) {
  const users = new Map();
  for (const [socket, session] of sockets) {
    if (socket.destroyed) continue;
    const user = userStore.session(session.token);
    if (!user || user.disabled || user.role === 'pending') continue;
    users.set(user.id, { id: user.id, name: user.name, avatar: user.avatar });
  }
  return [...users.values()];
}
