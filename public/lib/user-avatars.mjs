export const USER_AVATARS = [
  { id: 'initials', label: 'Your initials' },
  ...['manager', 'analyst', 'developer', 'designer', 'researcher', 'qa-tester', 'support-agent', 'deployment-engineer'].map(id => ({
    id, label: id.replaceAll('-', ' ').replace(/^./, letter => letter.toUpperCase()),
    src: `/assets/avatars/${id}.png`,
  })),
];

export function renderUserAvatar(element, user) {
  const choice = USER_AVATARS.find(item => item.id === user.avatar);
  element.replaceChildren();
  if (choice?.src) {
    const image = document.createElement('img');
    image.src = choice.src; image.alt = '';
    element.append(image);
  } else {
    element.textContent = user.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  }
}
